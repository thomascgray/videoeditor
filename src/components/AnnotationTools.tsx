import type { InteractionMode, TimelineObjectType } from '../types'

type AnnotationToolsProps = {
  interactionMode: InteractionMode
  onSetMode: (mode: InteractionMode) => void
  onCreateObject: (type: TimelineObjectType) => void
  onAddAsset: () => void
  onCreateZoom: () => void
  drawEnabled: boolean
}

const annotationButtons: { type: TimelineObjectType; label: string }[] = [
  { type: 'arrow', label: '+ Arrow' },
  { type: 'text', label: '+ Text' },
  // { type: 'rectangle', label: '+ Rect' },
  // { type: 'circle', label: '+ Circle' },
  { type: 'freehand', label: '+ Pen' },
]

const CTA_CLS = 'px-2.5 py-1 text-xs whitespace-nowrap shrink-0 bg-gray-800 text-gray-300 hover:bg-gray-700 rounded transition-colors cursor-pointer'

/** A labelled cluster of creation CTAs (Assets / Annotations / Animations). */
function Cluster({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 px-1.5 shrink-0">
      <span className="text-[9px] uppercase tracking-wider text-gray-500 leading-none whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  )
}

export default function AnnotationTools({ interactionMode, onSetMode, onCreateObject, onAddAsset, onCreateZoom, drawEnabled }: AnnotationToolsProps) {
  return (
    <div className="flex items-center gap-2 px-2 shrink-0">
      {/* Mode buttons */}
      <button
        onClick={() => onSetMode('move')}
        className={`px-3 py-1.5 text-sm rounded transition-colors cursor-pointer shrink-0 ${
          interactionMode === 'move'
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
        }`}
        title="Move (M)"
      >
        Move
      </button>
      <button
        onClick={() => onSetMode('draw')}
        disabled={!drawEnabled}
        className={`px-3 py-1.5 text-sm rounded transition-colors cursor-pointer shrink-0 ${
          interactionMode === 'draw'
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
        } disabled:opacity-30 disabled:cursor-not-allowed`}
        title="Draw (D)"
      >
        Draw
      </button>

      <span className="w-px h-8 bg-gray-700 shrink-0" />

      {/* Creation clusters */}
      <Cluster label="Assets">
        <button onClick={onAddAsset} className={CTA_CLS}>+ Asset</button>
      </Cluster>

      <span className="w-px h-8 bg-gray-700 shrink-0" />

      <Cluster label="Annotations">
        {annotationButtons.map((btn) => (
          <button key={btn.type} onClick={() => onCreateObject(btn.type)} className={CTA_CLS}>
            {btn.label}
          </button>
        ))}
      </Cluster>

      <span className="w-px h-8 bg-gray-700 shrink-0" />

      <Cluster label="Animations">
        <button onClick={onCreateZoom} className={CTA_CLS} title="Add a camera zoom at the playhead">
          + Zoom
        </button>
      </Cluster>
    </div>
  )
}
