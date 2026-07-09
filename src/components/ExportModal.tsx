import { useMemo, useState } from 'react'
import type { Project } from '../types'
import { useFFmpegExport } from '../hooks/useFFmpegExport'
import {
  COMPRESSION_PRESETS,
  DEFAULT_COMPRESSION,
  defaultShortEdge,
  resolutionOptions,
  estimateExportBytes,
  totalDurationOf,
  formatBytes,
  type CompressionPreset,
} from '../lib/exportSettings'

type ExportModalProps = {
  project: Project
  onClose: () => void
}

export default function ExportModal({ project, onClose }: ExportModalProps) {
  const { isExporting, progress, error, startExport, cancelExport } = useFFmpegExport()

  const resolutions = useMemo(() => resolutionOptions(project), [project])
  const [shortEdge, setShortEdge] = useState(() => defaultShortEdge(project))
  const [compression, setCompression] = useState<CompressionPreset>(DEFAULT_COMPRESSION)

  const settings = { shortEdge, compression }
  const selectedRes = resolutions.find((r) => r.shortEdge === shortEdge) ?? resolutions[0]
  const selectedComp = COMPRESSION_PRESETS.find((c) => c.id === compression)!
  const estBytes = estimateExportBytes(project, settings)
  const duration = totalDurationOf(project)

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-[34rem] max-w-[92vw]">
        <h2 className="text-lg font-bold text-white mb-4">Export Video</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm max-h-32 overflow-y-auto wrap-break-word">
            {error}
          </div>
        )}

        {/* Static facts */}
        <div className="grid grid-cols-3 gap-3 mb-5 text-sm">
          <Fact label="Format" value="MP4 · H.264" />
          <Fact label="FPS" value={String(project.fps)} />
          <Fact label="Duration" value={`${duration.toFixed(1)}s`} />
        </div>

        {/* Resolution */}
        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm font-medium text-gray-200">Resolution</span>
            <span className="text-xs text-gray-500">
              {selectedRes.width} × {selectedRes.height}px
            </span>
          </div>
          <div className="flex gap-2">
            {resolutions.map((r) => (
              <ChipButton
                key={r.shortEdge}
                selected={r.shortEdge === shortEdge}
                onClick={() => setShortEdge(r.shortEdge)}
                disabled={isExporting}
              >
                {r.label}
                {r.native && <span className="ml-1 text-[10px] opacity-60">Full</span>}
              </ChipButton>
            ))}
          </div>
        </div>

        {/* Compression */}
        <div className="mb-5">
          <span className="text-sm font-medium text-gray-200">Compression</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {COMPRESSION_PRESETS.map((c) => (
              <ChipButton
                key={c.id}
                selected={c.id === compression}
                onClick={() => setCompression(c.id)}
                disabled={isExporting}
              >
                {c.label}
              </ChipButton>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2 leading-relaxed">{selectedComp.blurb}</p>
          <p className="text-xs text-gray-500 mt-1">Quality does not affect export speed.</p>
        </div>

        {/* Estimated size */}
        <div className="flex items-baseline justify-between mb-5 px-3 py-2 bg-gray-900/50 rounded border border-gray-700">
          <span className="text-sm text-gray-300">Estimated size</span>
          <span className="text-sm font-semibold text-white">≈ {formatBytes(estBytes)}</span>
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
            onClick={isExporting ? cancelExport : onClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors cursor-pointer"
          >
            {isExporting ? 'Cancel export' : 'Close'}
          </button>
          <button
            onClick={() => startExport(project, settings)}
            disabled={isExporting || project.objects.length === 0}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded transition-colors cursor-pointer"
          >
            {isExporting ? 'Exporting...' : 'Export MP4'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-900/40 rounded px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm text-gray-200 mt-0.5">{value}</div>
    </div>
  )
}

function ChipButton({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 rounded text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
        selected
          ? 'bg-indigo-600/30 text-white ring-2 ring-indigo-500'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600 ring-2 ring-transparent'
      }`}
    >
      {children}
    </button>
  )
}
