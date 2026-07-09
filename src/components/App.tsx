import { useState, useCallback, useEffect, useRef } from 'react'
import type { InteractionMode, TimelineObjectType, TimelineObject, ArrowData, FreehandData } from '../types'
import { createTimelineObject } from '../types'
import { useProject } from '../hooks/useProject'
import { usePlayback } from '../hooks/usePlayback'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { loadAssetsFromDB } from '../lib/assetStore'
import { exportProjectBrep, importProjectBrep } from '../lib/projectStorage'
import Canvas from './Canvas'
import AnnotationTools from './AnnotationTools'
import Timeline from './Timeline'
import PropertiesPanel from './PropertiesPanel'
import ImportModal from './ImportModal'
import ExportModal from './ExportModal'

export default function App() {
  const { project, dispatch, canUndo, canRedo, undo, redo } = useProject()
  const playback = usePlayback(project)

  // Load asset blobs from IndexedDB on startup
  useEffect(() => { loadAssetsFromDB() }, [])

  // Audio/video playback sync
  const { isMuted, toggleMute } = useAudioPlayback(project.objects, playback.globalTime, playback.isPlaying)

  const [interactionMode, setInteractionMode] = useState<InteractionMode>('move')
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const projectFileRef = useRef<HTMLInputElement>(null)

  const selectedObject = project.objects.find((o) => o.id === selectedObjectId) ?? null

  // Draw mode only enabled when an arrow or freehand object is selected
  const drawEnabled = selectedObject != null && (selectedObject.type === 'arrow' || selectedObject.type === 'freehand')

  // Tighten bounding box for drawable objects (arrow/freehand)
  const tightenBbox = useCallback((objId: string) => {
    const obj = project.objects.find((o) => o.id === objId)
    if (!obj) return
    if (obj.type !== 'arrow' && obj.type !== 'freehand') return

    // Collect all points (arrows use points, freehand uses strokes)
    const allPoints = obj.type === 'arrow'
      ? (obj.data as ArrowData).points
      : (obj.data as FreehandData).strokes.flat()
    if (allPoints.length < 2) return

    const PADDING = 0.05 // 5% padding in normalized object-local space

    // Find extents of points (in object-local 0–1)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of allPoints) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }

    // Add padding
    const rangeX = maxX - minX || 0.01
    const rangeY = maxY - minY || 0.01
    const padX = rangeX * PADDING
    const padY = rangeY * PADDING
    minX -= padX
    minY -= padY
    maxX += padX
    maxY += padY

    // Compute new bbox in canvas-normalized coords
    const newX = obj.x + minX * obj.width
    const newY = obj.y + minY * obj.height
    const newW = (maxX - minX) * obj.width
    const newH = (maxY - minY) * obj.height

    const renorm = (p: { x: number; y: number }) => ({
      x: (p.x - minX) / (maxX - minX),
      y: (p.y - minY) / (maxY - minY),
    })

    // Renormalize points to the new bbox
    const newData: ArrowData | FreehandData = obj.type === 'arrow'
      ? { ...(obj.data as ArrowData), points: (obj.data as ArrowData).points.map(renorm) }
      : { strokes: (obj.data as FreehandData).strokes.map((s) => s.map(renorm)) }

    dispatch({
      type: 'UPDATE_OBJECT',
      objectId: obj.id,
      updates: {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
        data: newData,
      },
    })
  }, [project.objects, dispatch])

  // Track previous selected object so we can tighten its bbox when selection changes
  const prevSelectedIdRef = useRef<string | null>(null)

  // Tighten bbox whenever selection moves away from a drawable object
  useEffect(() => {
    const prevId = prevSelectedIdRef.current
    if (prevId && prevId !== selectedObjectId) {
      tightenBbox(prevId)
    }
    prevSelectedIdRef.current = selectedObjectId
  }, [selectedObjectId, tightenBbox])

  const handleSetMode = useCallback((mode: InteractionMode) => {
    // Tighten bbox when leaving draw mode
    if (interactionMode === 'draw' && mode === 'move' && selectedObjectId) {
      tightenBbox(selectedObjectId)
    }
    setInteractionMode(mode)
  }, [interactionMode, selectedObjectId, tightenBbox])

  // If draw mode is active but no longer valid, switch back to move
  useEffect(() => {
    if (interactionMode === 'draw' && !drawEnabled) {
      setInteractionMode('move')
    }
  }, [interactionMode, drawEnabled])

  const handleExportProject = useCallback(async () => {
    await exportProjectBrep(project)
  }, [project])

  const handleImportProject = useCallback(async (file: File) => {
    try {
      const imported = await importProjectBrep(file)
      dispatch({ type: 'SET_PROJECT', project: imported })
    } catch (e) {
      console.error('Failed to import project:', e)
      alert('Failed to import project file.')
    }
  }, [dispatch])

  // Central helper: assigns each object to a new lane above all existing objects,
  // dispatches, and selects the newly-added object (the last one when adding several)
  // so freshly added assets and annotations become the active selection consistently.
  const addObjects = useCallback((objects: TimelineObject[]) => {
    const maxLane = project.objects.reduce((max, o) => Math.max(max, o.lane), -1)
    const withLanes = objects.map((obj, i) => ({ ...obj, lane: maxLane + 1 + i }))
    dispatch({ type: 'ADD_OBJECTS', objects: withLanes })
    const last = withLanes[withLanes.length - 1]
    if (last) setSelectedObjectId(last.id)
    return withLanes
  }, [project.objects, dispatch])

  const handleCreateObject = useCallback((type: TimelineObjectType) => {
    const defaultData: Record<TimelineObjectType, () => ReturnType<typeof createTimelineObject>['data']> = {
      arrow: () => ({ points: [], headSize: 20, curvature: 0, progressiveHead: true }),
      text: () => ({ content: 'Text' }),
      rectangle: () => ({} as Record<string, never>),
      circle: () => ({} as Record<string, never>),
      freehand: () => ({ strokes: [] }),
      photo: () => ({ assetId: '' }),
      audio: () => ({ assetId: '', volume: 1, originalDuration: 0 }),
      video: () => ({ assetId: '', volume: 1, originalDuration: 0 }),
    }

    const obj = createTimelineObject(type, defaultData[type](), {
      startTime: playback.globalTime,
      duration: 5,
      x: type === 'text' ? 0.3 : 0,
      y: type === 'text' ? 0.4 : 0,
      width: type === 'text' ? 0.4 : 1,
      height: type === 'text' ? 0.2 : 1,
    })

    addObjects([obj])

    // Auto-enter draw mode for arrow/freehand, move mode for others
    if (type === 'arrow' || type === 'freehand') {
      handleSetMode('draw')
    } else {
      handleSetMode('move')
    }
  }, [playback.globalTime, addObjects, handleSetMode])

  // Finish arrow drawing: tighten bbox + switch to move mode
  const handleFinishArrow = useCallback(() => {
    if (selectedObjectId) {
      tightenBbox(selectedObjectId)
    }
    handleSetMode('move')
  }, [selectedObjectId, tightenBbox, handleSetMode])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === ' ') {
        e.preventDefault()
        playback.togglePlayback()
      } else if (e.key === 'm') {
        handleSetMode('move')
      } else if (e.key === 'd' && drawEnabled) {
        handleSetMode('draw')
      } else if (e.key === 'Enter' && interactionMode === 'draw' && selectedObject?.type === 'arrow') {
        // Finish arrow drawing with Enter
        const data = selectedObject.data as ArrowData
        if (data.points.length >= 2) {
          handleFinishArrow()
        }
      } else if (e.key === 'Escape') {
        handleSetMode('move')
        setSelectedObjectId(null)
      } else if (e.key === 'Backspace' && interactionMode === 'draw' && selectedObject?.type === 'arrow') {
        // Remove last arrow point
        e.preventDefault()
        const data = selectedObject.data as ArrowData
        if (data.points.length > 0) {
          dispatch({
            type: 'UPDATE_OBJECT',
            objectId: selectedObject.id,
            updates: { data: { ...data, points: data.points.slice(0, -1) } },
          })
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObject) {
        dispatch({ type: 'REMOVE_OBJECT', objectId: selectedObject.id })
        setSelectedObjectId(null)
      } else if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        undo()
      } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [playback, interactionMode, selectedObject, drawEnabled, dispatch, undo, redo, handleSetMode, handleFinishArrow])

  const handleSelectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id)
    // Auto-switch mode based on selected object type
    if (id) {
      const obj = project.objects.find((o) => o.id === id)
      if (obj && (obj.type === 'arrow' || obj.type === 'freehand')) {
        setInteractionMode('draw')
      } else {
        setInteractionMode('move')
      }
    }
  }, [project.objects])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Top Bar */}
      <header className="h-12 flex items-center justify-between px-4 bg-gray-900 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={project.name}
            onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
            className="bg-transparent text-white font-semibold text-sm border-b border-transparent hover:border-gray-600 focus:border-indigo-500 outline-none px-1 py-0.5"
          />
          <button
            onClick={handleExportProject}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors cursor-pointer"
            title="Save project as .brep"
          >
            Save
          </button>
          <button
            onClick={() => projectFileRef.current?.click()}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded transition-colors cursor-pointer"
            title="Load project from .brep"
          >
            Load
          </button>
          <input
            ref={projectFileRef}
            type="file"
            accept=".brep"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImportProject(file)
              e.target.value = ''
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <AnnotationTools
            interactionMode={interactionMode}
            onSetMode={handleSetMode}
            onCreateObject={handleCreateObject}
            onAddAsset={() => setShowImport(true)}
            drawEnabled={drawEnabled}
          />
          <span className="w-px h-6 bg-gray-700" />
          <button
            onClick={undo}
            disabled={!canUndo}
            className="px-2 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-2 py-1.5 text-sm text-gray-400 hover:text-white disabled:opacity-30 transition-colors cursor-pointer"
            title="Redo (Ctrl+Y)"
          >
            Redo
          </button>
          <span className="w-px h-6 bg-gray-700" />
          <button
            onClick={playback.togglePlayback}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded transition-colors cursor-pointer"
          >
            {playback.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={toggleMute}
            className={`px-2 py-1.5 text-sm rounded transition-colors cursor-pointer ${
              isMuted ? 'bg-red-900/50 text-red-300 hover:bg-red-800/50' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? 'Muted' : 'Sound'}
          </button>
          <span className="text-xs text-gray-400 tabular-nums min-w-16 text-right">
            {playback.globalTime.toFixed(1)}s / {playback.totalDuration.toFixed(1)}s
          </span>
          <button
            onClick={() => setShowExport(true)}
            className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded font-medium transition-colors cursor-pointer"
          >
            Export
          </button>
        </div>
      </header>

      {/* Main Content: Viewport + Properties */}
      <div className="flex-1 flex min-h-0">
        <Canvas
          objects={project.objects}
          globalTime={playback.globalTime}
          isPlaying={playback.isPlaying}
          width={project.width}
          height={project.height}
          selectedObjectId={selectedObjectId}
          interactionMode={interactionMode}
          dispatch={dispatch}
          onFinishArrow={handleFinishArrow}
        />

        <PropertiesPanel
          object={selectedObject}
          dispatch={dispatch}
          globalTime={playback.globalTime}
          onSeek={playback.seek}
        />
      </div>

      {/* Timeline */}
      <Timeline
        objects={project.objects}
        globalTime={playback.globalTime}
        totalDuration={playback.totalDuration}
        selectedObjectId={selectedObjectId}
        onSelectObject={handleSelectObject}
        onSeek={playback.seek}
        dispatch={dispatch}
      />

      {/* Modals */}
      {showImport && (
        <ImportModal
          onImport={addObjects}
          onClose={() => setShowImport(false)}
          insertAtTime={playback.globalTime}
          onAssetsAdded={(assets) => dispatch({ type: 'ADD_ASSETS', assets })}
        />
      )}
      {showExport && <ExportModal project={project} onClose={() => setShowExport(false)} />}
    </div>
  )
}
