import { IconPlayerPlayFilled, IconPlayerPauseFilled, IconFlag, IconTrash } from '@tabler/icons-react'
import VolumeControl from './VolumeControl'

type TransportBarProps = {
  isPlaying: boolean
  onTogglePlayback: () => void
  globalTime: number
  totalDuration: number
  playbackSpeed: number
  onSetSpeed: (v: number) => void
  volume: number
  isMuted: boolean
  onVolume: (v: number) => void
  onToggleMute: () => void
  // Markers (spec 22): add at the playhead / clear all. markerCount gates the clear-all button.
  onAddMarker: () => void
  onClearMarkers: () => void
  markerCount: number
}

/** m:ss.s clock — mirrors the timeline ruler's format. */
function formatClock(t: number): string {
  const clamped = Math.max(0, t)
  const m = Math.floor(clamped / 60)
  const s = clamped % 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/**
 * Floating transport pill (spec 17 C): play/pause, the playhead clock, preview speed, and master
 * volume — lifted out of the top bar to float above the scrub bar. Preview speed + volume are
 * editor-only monitoring and never affect export. Space still toggles play (handled in App).
 */
export default function TransportBar({
  isPlaying, onTogglePlayback, globalTime, totalDuration,
  playbackSpeed, onSetSpeed, volume, isMuted, onVolume, onToggleMute,
  onAddMarker, onClearMarkers, markerCount,
}: TransportBarProps) {
  return (
    <div className="pointer-events-auto flex items-center gap-3 px-2.5 py-1.5 bg-surface/95 border border-border rounded-full shadow-lg backdrop-blur-sm">
      <button
        onClick={onTogglePlayback}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-accent text-accent-contrast hover:bg-accent-hover cursor-pointer transition-colors shrink-0"
      >
        {isPlaying ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
      </button>

      <span className="text-xs tabular-nums select-none whitespace-nowrap">
        <span className="text-fg">{formatClock(globalTime)}</span>
        <span className="text-subtle"> / {formatClock(totalDuration)}</span>
      </span>

      <span className="w-px h-5 bg-border shrink-0" />

      <div
        className="flex items-center gap-1.5"
        title="Preview speed — how fast Play runs in the editor. Does not affect export. Double-click to reset to 1×."
      >
        <span className="text-[10px] text-subtle select-none">Speed</span>
        <input
          type="range"
          min={0.25} max={2} step={0.25}
          value={playbackSpeed}
          onChange={(e) => onSetSpeed(Number(e.target.value))}
          onDoubleClick={() => onSetSpeed(1)}
          className="w-20 accent-accent cursor-pointer"
        />
        <span className="text-xs text-muted tabular-nums w-8 text-right">{playbackSpeed}×</span>
      </div>

      <span className="w-px h-5 bg-border shrink-0" />

      {/* Markers (spec 22): flag drops a marker at the playhead (also M); trash clears them all. */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onAddMarker}
          title="Add marker at playhead (M)"
          className="flex items-center justify-center w-7 h-7 rounded-full text-muted hover:text-fg hover:bg-surface-hover cursor-pointer transition-colors"
        >
          <IconFlag size={15} stroke={2} />
        </button>
        {markerCount > 0 && (
          <button
            onClick={onClearMarkers}
            title={`Clear all markers (${markerCount})`}
            className="flex items-center justify-center w-7 h-7 rounded-full text-muted hover:text-danger hover:bg-danger-soft cursor-pointer transition-colors"
          >
            <IconTrash size={14} stroke={2} />
          </button>
        )}
      </div>

      <span className="w-px h-5 bg-border shrink-0" />

      <VolumeControl volume={volume} isMuted={isMuted} onVolume={onVolume} onToggleMute={onToggleMute} />
    </div>
  )
}
