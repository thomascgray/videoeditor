import { useState, useCallback, useEffect } from 'react'
import type { AnnotationTool } from '../types'
import { useProject } from '../hooks/useProject'
import { usePlayback } from '../hooks/usePlayback'
import Canvas from './Canvas'
import AnnotationTools from './AnnotationTools'
import Timeline from './Timeline'
import PropertiesPanel from './PropertiesPanel'
import ImportModal from './ImportModal'
import ExportModal from './ExportModal'

export default function App() {
  const { project, dispatch, canUndo, canRedo, undo, redo } = useProject()
  const playback = usePlayback(project)

  const [activeTool, setActiveTool] = useState<AnnotationTool>('select')
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const selectedObject = project.objects.find((o) => o.id === selectedObjectId) ?? null

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === ' ') {
        e.preventDefault()
        playback.togglePlayback()
      } else if (e.key === 'a') {
        setActiveTool('arrow')
      } else if (e.key === 't') {
        setActiveTool('text')
      } else if (e.key === 'r') {
        setActiveTool('rectangle')
      } else if (e.key === 'v') {
        setActiveTool('select')
      } else if (e.key === 'Escape') {
        setActiveTool('select')
        setSelectedObjectId(null)
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
  }, [playback, activeTool, selectedObject, dispatch, undo, redo])

  const handleSelectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id)
  }, [])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Top Bar */}
      <header className="h-12 flex items-center justify-between px-4 bg-gray-900 border-b border-gray-700 shrink-0">
        <input
          type="text"
          value={project.name}
          onChange={(e) => dispatch({ type: 'SET_NAME', name: e.target.value })}
          className="bg-transparent text-white font-semibold text-sm border-b border-transparent hover:border-gray-600 focus:border-indigo-500 outline-none px-1 py-0.5"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded transition-colors cursor-pointer"
          >
            Add Photo
          </button>
          <AnnotationTools activeTool={activeTool} onSelectTool={setActiveTool} />
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
          width={project.width}
          height={project.height}
        />

        {selectedObject && (
          <PropertiesPanel
            object={selectedObject}
            dispatch={dispatch}
          />
        )}
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
          dispatch={dispatch}
          onClose={() => setShowImport(false)}
          insertAtTime={playback.globalTime}
        />
      )}
      {showExport && <ExportModal project={project} onClose={() => setShowExport(false)} />}
    </div>
  )
}
