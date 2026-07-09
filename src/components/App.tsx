import { useState, useCallback, useEffect, useRef } from 'react'
import type { InteractionMode, TimelineObjectType, TimelineObject, ArrowData, FreehandData } from '../types'
import { createTimelineObject, createCameraZoom } from '../types'
import { getRememberedStyle, getRememberedData } from '../lib/objectDefaults'
import { useProject } from '../hooks/useProject'
import { usePlayback } from '../hooks/usePlayback'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { loadAssetsFromDB } from '../lib/assetStore'
import { exportProjectBrep, importProjectBrep } from '../lib/projectStorage'
import Canvas from './Canvas'
import AnnotationTools from './AnnotationTools'
import AspectRatioSelector from './AspectRatioSelector'
import VolumeControl from './VolumeControl'
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
  const { isMuted, toggleMute, volume, setVolume } = useAudioPlayback(project.objects, playback.globalTime, playback.isPlaying)

  const [interactionMode, setInteractionMode] = useState<InteractionMode>('move')
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null)
  // Camera view (spec 13): 'frame' = author un-zoomed with a framing rectangle; 'live' = apply the
  // real transform (WYSIWYG, matches export). Pure view state — not persisted, not part of undo.
  const [cameraView, setCameraView] = useState<'frame' | 'live'>('frame')
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const projectFileRef = useRef<HTMLInputElement>(null)

  const selectedObject = project.objects.find((o) => o.id === selectedObjectId) ?? null
  const selectedZoom = project.zooms?.find((z) => z.id === selectedZoomId) ?? null

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
    if (last) {
      setSelectedObjectId(last.id)
      setSelectedZoomId(null) // object/zoom selection are mutually exclusive
    }
    // Adding/importing anything drops back to Frame view so the new object is visible + editable
    // (Live view hides the whole scene outside the zoom and disables editing).
    setCameraView('frame')
    return withLanes
  }, [project.objects, dispatch])

  const handleCreateObject = useCallback((type: TimelineObjectType) => {
    const defaultData: Record<TimelineObjectType, () => ReturnType<typeof createTimelineObject>['data']> = {
      arrow: () => ({ points: [], headSize: 20, curvature: 0, progressiveHead: true }),
      text: () => ({ content: 'Text', align: 'center', autoSize: true }),
      rectangle: () => ({} as Record<string, never>),
      circle: () => ({} as Record<string, never>),
      freehand: () => ({ strokes: [] }),
      photo: () => ({ assetId: '' }),
      audio: () => ({ assetId: '', volume: 1, originalDuration: 0 }),
      video: () => ({ assetId: '', volume: 1, originalDuration: 0 }),
    }

    // Seed new objects from the last-used settings for this type (colour, size, bold/italic,
    // text background/align, arrow head/curve, …) so they carry forward like most editors do.
    const baseData = defaultData[type]()
    const rememberedData = getRememberedData(type)
    const data = rememberedData
      ? ({ ...(baseData as object), ...rememberedData } as ReturnType<typeof createTimelineObject>['data'])
      : baseData

    const obj = createTimelineObject(type, data, {
      startTime: playback.globalTime,
      duration: 5,
      x: type === 'text' ? 0.3 : 0,
      y: type === 'text' ? 0.4 : 0,
      width: type === 'text' ? 0.4 : 1,
      height: type === 'text' ? 0.2 : 1,
      style: getRememberedStyle(type),
    })

    addObjects([obj])

    // Auto-enter draw mode for arrow/freehand, move mode for others
    if (type === 'arrow' || type === 'freehand') {
      handleSetMode('draw')
    } else {
      handleSetMode('move')
    }
  }, [playback.globalTime, addObjects, handleSetMode])

  // Create a camera zoom (spec 13) at the playhead: mirrors + Text (App.handleCreateObject).
  // Defaults from createCameraZoom; select it (clearing object selection) so its panel + framing
  // rectangle are immediately editable.
  const handleCreateZoom = useCallback(() => {
    const zoom = createCameraZoom({ startTime: playback.globalTime })
    dispatch({ type: 'ADD_ZOOM', zoom })
    setSelectedObjectId(null)
    setSelectedZoomId(zoom.id)
    setInteractionMode('move')
    setCameraView('frame') // author the new zoom un-zoomed with its framing rectangle (R8/R15)
  }, [playback.globalTime, dispatch])

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id)
    if (id) {
      setSelectedObjectId(null) // object/zoom selection are mutually exclusive
      setInteractionMode('move')
    }
  }, [])

  const toggleCameraView = useCallback(() => {
    setCameraView((v) => (v === 'frame' ? 'live' : 'frame'))
  }, [])

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
      } else if (e.key === 'v') {
        toggleCameraView()
      } else if (e.key === 'm') {
        handleSetMode('move')
      } else if (e.key === 'd' && drawEnabled) {
        handleSetMode('draw')
      } else if (e.key === 'h' || e.key === 'H') {
        // Toggle hidden on the selected object OR zoom (spec 14 R11; selection is mutually exclusive).
        if (selectedObject) {
          dispatch({ type: 'UPDATE_OBJECT', objectId: selectedObject.id, updates: { hidden: !selectedObject.hidden } })
        } else if (selectedZoom) {
          dispatch({ type: 'UPDATE_ZOOM', zoomId: selectedZoom.id, updates: { hidden: !selectedZoom.hidden } })
        }
      } else if (e.key === 's' || e.key === 'S') {
        // Slice a selected audio/video clip at the playhead (spec 14 R10). No-op unless the
        // playhead is strictly inside the clip. The left half reuses the original id, so the
        // current selection stays on it (R10.6) — no re-selection needed.
        if (selectedObject && (selectedObject.type === 'audio' || selectedObject.type === 'video')) {
          const t = playback.globalTime
          if (t > selectedObject.startTime && t < selectedObject.startTime + selectedObject.duration) {
            dispatch({ type: 'SPLIT_OBJECT', objectId: selectedObject.id, globalTime: t })
          }
        }
      } else if (e.key === 'Enter' && interactionMode === 'draw' && selectedObject?.type === 'arrow') {
        // Finish arrow drawing with Enter
        const data = selectedObject.data as ArrowData
        if (data.points.length >= 2) {
          handleFinishArrow()
        }
      } else if (e.key === 'Escape') {
        handleSetMode('move')
        setSelectedObjectId(null)
        setSelectedZoomId(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoom) {
        dispatch({ type: 'REMOVE_ZOOM', zoomId: selectedZoom.id })
        setSelectedZoomId(null)
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
  }, [playback, interactionMode, selectedObject, selectedZoom, drawEnabled, dispatch, undo, redo, handleSetMode, handleFinishArrow, toggleCameraView])

  const handleSelectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id)
    if (id) setSelectedZoomId(null) // object/zoom selection are mutually exclusive
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
          <span className="w-px h-6 bg-gray-700" />
          <AspectRatioSelector width={project.width} height={project.height} dispatch={dispatch} />
        </div>
        <div className="flex items-center gap-2">
          <AnnotationTools
            interactionMode={interactionMode}
            onSetMode={handleSetMode}
            onCreateObject={handleCreateObject}
            onAddAsset={() => setShowImport(true)}
            onCreateZoom={handleCreateZoom}
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
          <VolumeControl
            volume={volume}
            isMuted={isMuted}
            onVolume={setVolume}
            onToggleMute={toggleMute}
          />
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
          zooms={project.zooms}
          selectedZoomId={selectedZoomId}
          onSelectZoom={handleSelectZoom}
          cameraView={cameraView}
          onToggleCameraView={toggleCameraView}
        />

        <PropertiesPanel
          object={selectedObject}
          zoom={selectedZoom}
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
        zooms={project.zooms}
        selectedZoomId={selectedZoomId}
        onSelectZoom={handleSelectZoom}
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
