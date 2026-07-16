type VolumeControlProps = {
  volume: number
  isMuted: boolean
  onVolume: (v: number) => void
  onToggleMute: () => void
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M22 9l-6 6M16 9l6 6" />
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 6a9 9 0 0 1 0 12" />
        </>
      )}
    </svg>
  )
}

/** Master preview volume: a mute toggle (speaker) + a level slider. */
export default function VolumeControl({ volume, isMuted, onVolume, onToggleMute }: VolumeControlProps) {
  const effective = isMuted ? 0 : volume
  return (
    <div className="flex items-center gap-2 px-2 py-1 bg-surface-muted rounded">
      <button
        onClick={onToggleMute}
        title={isMuted ? 'Unmute' : 'Mute'}
        className={`flex items-center cursor-pointer transition-colors ${
          isMuted ? 'text-danger hover:text-danger' : 'text-muted hover:text-fg'
        }`}
      >
        <SpeakerIcon muted={isMuted || volume === 0} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={effective}
        onChange={(e) => onVolume(Number(e.target.value))}
        title={`Volume ${Math.round(effective * 100)}%`}
        aria-label="Volume"
        className="w-20 h-1 accent-accent cursor-pointer"
      />
    </div>
  )
}
