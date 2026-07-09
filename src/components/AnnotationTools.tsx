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

const CTA_CLS = 'px-3 py-1.5 text-sm bg-gray-800 text-gray-300 hover:bg-gray-700 rounded transition-colors cursor-pointer'

/** A labelled cluster of creation CTAs (Assets / Annotations / Animations). */
function Cluster({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start">
      <span className="text-[9px] uppercase tracking-wider text-gray-500 leading-none mb-0.5 pl-0.5">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

export default function AnnotationTools({ interactionMode, onSetMode, onCreateObject, onAddAsset, onCreateZoom, drawEnabled }: AnnotationToolsProps) {
  return (
    <div className="flex items-center gap-2 px-2">
      {/* Mode buttons */}
      <button
        onClick={() => onSetMode('move')}
        className={`px-3 py-1.5 text-sm rounded transition-colors cursor-pointer ${
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
        className={`px-3 py-1.5 text-sm rounded transition-colors cursor-pointer ${
          interactionMode === 'draw'
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
        } disabled:opacity-30 disabled:cursor-not-allowed`}
        title="Draw (D)"
      >
        Draw
      </button>

      <span className="w-px h-8 bg-gray-700" />

      {/* Creation clusters */}
      <Cluster label="Assets">
        <button onClick={onAddAsset} className={CTA_CLS}>+ Asset</button>
      </Cluster>

      <span className="w-px h-8 bg-gray-700" />

      <Cluster label="Annotations">
        {annotationButtons.map((btn) => (
          <button key={btn.type} onClick={() => onCreateObject(btn.type)} className={CTA_CLS}>
            {btn.label}
          </button>
        ))}
      </Cluster>

      <span className="w-px h-8 bg-gray-700" />

      <Cluster label="Animations">
        <button onClick={onCreateZoom} className={CTA_CLS} title="Add a camera zoom at the playhead">
          + Zoom
        </button>
      </Cluster>
    </div>
  )
}
