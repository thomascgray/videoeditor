import { useState, useCallback, useEffect, useRef } from 'react'
import type { InteractionMode, TimelineObjectType, TimelineObject, ArrowData, FreehandData } from '../types'
import { createTimelineObject, createCameraZoom } from '../types'
import { getRememberedStyle, getRememberedData } from '../lib/objectDefaults'
import { useProject } from '../hooks/useProject'
import { usePlayback } from '../hooks/usePlayback'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { useUiPrefs } from '../hooks/useUiPrefs'
import { loadAssetsFromDB, clearAllAssets } from '../lib/assetStore'
import { exportProjectBrep, importProjectBrep } from '../lib/projectStorage'
import { config } from '../config'
import Canvas from './Canvas'
import LeftRail from './LeftRail'
import AspectRatioSelector from './AspectRatioSelector'
import TransportBar from './TransportBar'
import Timeline from './Timeline'
import PropertiesPanel from './PropertiesPanel'
import ImportModal from './ImportModal'
import ExportModal from './ExportModal'
import AppearanceControls from './AppearanceControls'
import {
  IconDeviceFloppy, IconFolderOpen, IconArrowBackUp, IconArrowForwardUp,
  IconDownload, IconChevronUp,
} from '@tabler/icons-react'

// Timeline resize/collapse (spec 16 B). Ephemeral view state — not persisted, not part of undo.
const HEADER_HEIGHT = 48 // top bar (h-12)
const MIN_TIMELINE_HEIGHT = 140 // ruler + Camera track + ~1 lane + add-lane rows stay usable
const MIN_RENDER_HEIGHT = 200 // never let the timeline starve the render below this
const COLLAPSED_TIMELINE_HEIGHT = 32

const maxTimelineHeight = () =>
  Math.max(MIN_TIMELINE_HEIGHT, window.innerHeight - HEADER_HEIGHT - MIN_RENDER_HEIGHT)
const clampTimelineHeight = (h: number) =>
  Math.max(MIN_TIMELINE_HEIGHT, Math.min(maxTimelineHeight(), h))
const defaultTimelineHeight = () => clampTimelineHeight(Math.round(window.innerHeight * 0.22))

export default function App() {
  const { project, dispatch, canUndo, canRedo, undo, redo } = useProject()
  const playback = usePlayback(project)
  const uiPrefs = useUiPrefs()

  // On startup: when persisting, restore asset blobs from IndexedDB; otherwise purge them. Without
  // this, assets accumulate across sessions (projects reset with persistProject=false, but the
  // IndexedDB blobs don't) and inflate getTotalAssetSize() past the 500 MB warning even for a tiny
  // fresh import. Purging keeps the size total (and the rail's library) scoped to the current session.
  useEffect(() => {
    if (config.persistProject) loadAssetsFromDB()
    else clearAllAssets()
  }, [])

  // Reflect the project name in the browser tab.
  useEffect(() => {
    const name = project.name.trim()
    document.title = name ? `${name} — Video Editor` : 'Video Editor'
  }, [project.name])

  // Audio/video playback sync — preview speed keeps media in step with the sped-up playhead.
  const { isMuted, toggleMute, volume, setVolume } = useAudioPlayback(project.objects, playback.globalTime, playback.isPlaying, playback.playbackSpeed)

  // Per-object drawing state (spec 17 M): non-null = actively drawing/editing that arrow/freehand's
  // points. Replaces the old global Move/Draw toggle; interactionMode is DERIVED from it below.
  const [drawingObjectId, setDrawingObjectId] = useState<string | null>(null)
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null)
  // Camera view (spec 13): 'frame' = author un-zoomed with a framing rectangle; 'live' = apply the
  // real transform (WYSIWYG, matches export). Pure view state — not persisted, not part of undo.
  const [cameraView, setCameraView] = useState<'frame' | 'live'>('frame')
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const projectFileRef = useRef<HTMLInputElement>(null)

  // Timeline resize/collapse (spec 16 B). Both are ephemeral view state (like cameraView).
  const [timelineHeight, setTimelineHeight] = useState<number>(defaultTimelineHeight)
  const [timelineCollapsed, setTimelineCollapsed] = useState(false)
  const splitterDragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const handleSplitterDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    splitterDragRef.current = { startY: e.clientY, startHeight: timelineHeight }
  }, [timelineHeight])

  // Splitter drag (B1/B2) + re-clamp on window resize (B5).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = splitterDragRef.current
      if (!d) return
      // Drag up (smaller clientY) grows the timeline; down shrinks it.
      setTimelineHeight(clampTimelineHeight(d.startHeight - (e.clientY - d.startY)))
    }
    const onUp = () => { splitterDragRef.current = null }
    const onResize = () => setTimelineHeight((h) => clampTimelineHeight(h))
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const selectedObject = project.objects.find((o) => o.id === selectedObjectId) ?? null
  const selectedZoom = project.zooms?.find((z) => z.id === selectedZoomId) ?? null

  // Draw mode only enabled when an arrow or freehand object is selected
  const drawEnabled = selectedObject != null && (selectedObject.type === 'arrow' || selectedObject.type === 'freehand')

  // interactionMode is now DERIVED (spec 17 M): "draw" only while actively drawing the selected
  // object, else "move". Canvas + PropertiesPanel still consume this as the draw-vs-move signal.
  const interactionMode: InteractionMode = drawingObjectId != null && drawingObjectId === selectedObjectId ? 'draw' : 'move'

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

  // Safety net: if we're "drawing" but that object is no longer the selected drawable (deselected,
  // a different object selected, or its type changed), stop drawing. Tightening happens on the
  // explicit finish paths + the select-away effect, so we only clear here.
  useEffect(() => {
    if (drawingObjectId && (drawingObjectId !== selectedObjectId || !drawEnabled)) {
      setDrawingObjectId(null)
    }
  }, [drawingObjectId, selectedObjectId, drawEnabled])

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

  // Re-add an already-imported asset (spec 17 L) as a new object at the playhead — no re-import,
  // reuses the existing assetId. Mirrors ImportModal's object creation (audio waveform is skipped
  // here; the timeline bar just omits the waveform until a future polish regenerates it).
  const handleAddExistingAsset = useCallback((assetId: string) => {
    const asset = project.assets.find((a) => a.id === assetId)
    if (!asset) return
    const startTime = playback.globalTime
    const dur = asset.duration ?? 5
    const name = asset.filename.replace(/\.[^.]+$/, '')
    let obj: TimelineObject
    if (asset.type === 'image') {
      obj = createTimelineObject('photo', { assetId }, { startTime, duration: 5, x: 0, y: 0, width: 1, height: 1, name })
    } else if (asset.type === 'audio') {
      obj = createTimelineObject('audio', { assetId, volume: 1, originalDuration: dur, sourceIn: 0, sourceOut: dur }, { startTime, duration: dur, name })
    } else {
      obj = createTimelineObject('video', { assetId, volume: 1, originalDuration: dur, sourceIn: 0, sourceOut: dur }, { startTime, duration: dur, x: 0, y: 0, width: 1, height: 1, name })
    }
    addObjects([obj])
  }, [project.assets, playback.globalTime, addObjects])

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

    // Text reads best white by default (over photos/video); annotations keep the factory red.
    // Last-used style still wins, so once you pick a text colour it carries forward.
    const remembered = getRememberedStyle(type)
    const style = type === 'text' ? { color: '#FFFFFF', ...remembered } : remembered

    const obj = createTimelineObject(type, data, {
      startTime: playback.globalTime,
      duration: 5,
      x: type === 'text' ? 0.3 : 0,
      y: type === 'text' ? 0.4 : 0,
      width: type === 'text' ? 0.4 : 1,
      height: type === 'text' ? 0.2 : 1,
      style,
    })

    addObjects([obj])

    // Arrow/freehand: drop straight into drawing the new object (spec 17 M). Others aren't drawn.
    setDrawingObjectId(type === 'arrow' || type === 'freehand' ? obj.id : null)
  }, [playback.globalTime, addObjects])

  // Create a camera zoom (spec 13) at the playhead: mirrors + Text (App.handleCreateObject).
  // Defaults from createCameraZoom; select it (clearing object selection) so its panel + framing
  // rectangle are immediately editable.
  const handleCreateZoom = useCallback(() => {
    const zoom = createCameraZoom({ startTime: playback.globalTime })
    dispatch({ type: 'ADD_ZOOM', zoom })
    setSelectedObjectId(null)
    setSelectedZoomId(zoom.id)
    setDrawingObjectId(null)
    setCameraView('frame') // author the new zoom un-zoomed with its framing rectangle (R8/R15)
  }, [playback.globalTime, dispatch])

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id)
    if (id) {
      setSelectedObjectId(null) // object/zoom selection are mutually exclusive
      setDrawingObjectId(null)
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
    setDrawingObjectId(null)
  }, [selectedObjectId, tightenBbox])

  // Toggle drawing/editing the selected arrow/freehand's points ("Edit points", spec 17 M). Used by
  // the properties panel now; moves to the object's floating context toolbar in spec 17 P.
  const handleToggleDrawSelected = useCallback(() => {
    if (!drawEnabled || !selectedObjectId) return
    if (drawingObjectId === selectedObjectId) {
      tightenBbox(selectedObjectId)
      setDrawingObjectId(null)
    } else {
      setDrawingObjectId(selectedObjectId)
    }
  }, [drawEnabled, selectedObjectId, drawingObjectId, tightenBbox])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === ' ') {
        e.preventDefault()
        playback.togglePlayback()
      } else if (e.key === 'v') {
        toggleCameraView()
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
        if (interactionMode === 'draw') {
          // Finishing a drawing (arrow/freehand): stop drawing but KEEP the object selected and
          // tighten its bbox — matches the other finish gestures (right-click / Enter / Done).
          handleFinishArrow()
        } else {
          setDrawingObjectId(null)
          setSelectedObjectId(null)
          setSelectedZoomId(null)
        }
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
  }, [playback, interactionMode, selectedObject, selectedZoom, drawEnabled, dispatch, undo, redo, handleFinishArrow, toggleCameraView])

  const handleSelectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id)
    if (id) setSelectedZoomId(null) // object/zoom selection are mutually exclusive
    // Selecting no longer auto-enters draw (spec 17 M) — selection means "move". Re-edit an
    // arrow/freehand's points via the panel's "Edit points". Selecting away finishes any drawing.
    setDrawingObjectId(null)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-bg text-fg">
      {/* Top Bar */}
      <header className="h-12 flex items-center justify-between px-4 bg-surface border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={project.name}
            onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
            className="bg-transparent text-fg font-semibold text-sm border-b border-transparent hover:border-border-strong focus:border-accent outline-none px-1 py-0.5"
          />
          <button
            onClick={handleExportProject}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-fg bg-surface-muted hover:bg-surface-hover rounded transition-colors cursor-pointer"
            title="Save project as .brep"
          >
            <IconDeviceFloppy size={14} stroke={2} /> Save
          </button>
          <button
            onClick={() => projectFileRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-fg bg-surface-muted hover:bg-surface-hover rounded transition-colors cursor-pointer"
            title="Load project from .brep"
          >
            <IconFolderOpen size={14} stroke={2} /> Load
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
          <span className="w-px h-6 bg-border" />
          <AspectRatioSelector width={project.width} height={project.height} dispatch={dispatch} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="flex items-center px-2 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-30 transition-colors cursor-pointer"
            title="Undo (Ctrl+Z)"
          >
            <IconArrowBackUp size={18} stroke={2} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="flex items-center px-2 py-1.5 text-sm text-muted hover:text-fg disabled:opacity-30 transition-colors cursor-pointer"
            title="Redo (Ctrl+Y)"
          >
            <IconArrowForwardUp size={18} stroke={2} />
          </button>
          <span className="w-px h-6 bg-border" />
          {/* Play / speed / volume / time moved to the floating TransportBar (spec 17 C). */}
          <AppearanceControls
            theme={uiPrefs.theme}
            accent={uiPrefs.accent}
            onToggleTheme={uiPrefs.toggleTheme}
            onSetAccent={uiPrefs.setAccent}
          />
          <span className="w-px h-6 bg-border" />
          <button
            onClick={() => setShowExport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-accent-contrast rounded font-medium transition-colors cursor-pointer"
          >
            <IconDownload size={15} stroke={2} /> Export
          </button>
        </div>
      </header>

      {/* Main Content: LeftRail + Viewport (with floating transport) + Properties */}
      <div className="flex-1 flex min-h-0">
        <LeftRail
          assets={project.assets}
          onAddMedia={() => setShowImport(true)}
          onAddAsset={handleAddExistingAsset}
          onCreateObject={handleCreateObject}
          onCreateZoom={handleCreateZoom}
        />
        <div className="relative flex flex-1 min-w-0">
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
          onToggleDraw={handleToggleDrawSelected}
        />
          {/* Floating transport pill (spec 17 C) — centered over the canvas, in the render's bottom
              gutter. The container ignores pointer events; the pill re-enables them so it never
              blocks canvas interaction. Works whether the timeline is expanded or collapsed. */}
          <div className="absolute bottom-5 inset-x-0 flex justify-center pointer-events-none z-20">
            <TransportBar
              isPlaying={playback.isPlaying}
              onTogglePlayback={playback.togglePlayback}
              globalTime={playback.globalTime}
              totalDuration={playback.totalDuration}
              playbackSpeed={playback.playbackSpeed}
              onSetSpeed={playback.setPlaybackSpeed}
              volume={volume}
              isMuted={isMuted}
              onVolume={setVolume}
              onToggleMute={toggleMute}
            />
          </div>
        </div>

        <PropertiesPanel
          object={selectedObject}
          zoom={selectedZoom}
          dispatch={dispatch}
          globalTime={playback.globalTime}
          onSeek={playback.seek}
          isDrawing={interactionMode === 'draw'}
          onToggleDraw={handleToggleDrawSelected}
        />
      </div>

      {/* Timeline (spec 16 B): bounded height, resizable via a splitter, collapsible to a slim bar. */}
      {timelineCollapsed ? (
        <div className="shrink-0 flex items-center justify-between px-3 bg-surface border-t border-border" style={{ height: COLLAPSED_TIMELINE_HEIGHT }}>
          <span className="text-xs text-muted">Timeline</span>
          <button
            onClick={() => setTimelineCollapsed(false)}
            className="px-2 py-0.5 text-xs text-muted hover:text-fg flex items-center gap-1 cursor-pointer"
            title="Expand timeline"
          >
            <IconChevronUp size={14} stroke={2} /> Expand
          </button>
        </div>
      ) : (
        <>
          {/* Drag handle — resize the render / timeline split */}
          <div
            onMouseDown={handleSplitterDown}
            className="shrink-0 h-1.5 cursor-row-resize bg-border hover:bg-accent/60 transition-colors"
            title="Drag to resize timeline"
          />
          <div className="shrink-0" style={{ height: timelineHeight }}>
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
              onCollapse={() => setTimelineCollapsed(true)}
            />
          </div>
        </>
      )}

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
