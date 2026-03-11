import type { Project } from '../types'
import { useFFmpegExport } from '../hooks/useFFmpegExport'

type ExportModalProps = {
  project: Project
  onClose: () => void
}

export default function ExportModal({ project, onClose }: ExportModalProps) {
  const { isExporting, progress, error, startExport } = useFFmpegExport()

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-96 max-w-[90vw]">
        <h2 className="text-lg font-bold text-white mb-4">Export Video</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm max-h-32 overflow-y-auto wrap-break-word">
            {error}
          </div>
        )}

        <div className="space-y-3 mb-6 text-sm text-gray-300">
          <div className="flex justify-between">
            <span>Format</span>
            <span>WebM (VP9)</span>
          </div>
          <div className="flex justify-between">
            <span>Resolution</span>
            <span>{project.width} x {project.height}</span>
          </div>
          <div className="flex justify-between">
            <span>FPS</span>
            <span>{project.fps}</span>
          </div>
          <div className="flex justify-between">
            <span>Objects</span>
            <span>{project.objects.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Total duration</span>
            <span>{project.objects.reduce((max, o) => Math.max(max, o.startTime + o.duration), 0).toFixed(1)}s</span>
          </div>
        </div>

        {isExporting && (
          <div className="mb-4">
            <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className="bg-indigo-500 h-full transition-all duration-200"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1 text-center">
              {progress < 0.95
                ? `Encoding... ${Math.round(progress * 100)}%`
                : 'Finalizing...'}
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => startExport(project)}
            disabled={isExporting || project.objects.length === 0}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded transition-colors cursor-pointer"
          >
            {isExporting ? 'Exporting...' : 'Export WebM'}
          </button>
        </div>
      </div>
    </div>
  )
}
