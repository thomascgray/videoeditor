import type { InteractionMode, TimelineObjectType } from '../types'

type AnnotationToolsProps = {
  interactionMode: InteractionMode
  onSetMode: (mode: InteractionMode) => void
  onCreateObject: (type: TimelineObjectType) => void
  onAddImage: () => void
  drawEnabled: boolean
}

const creationButtons: { type: TimelineObjectType; label: string }[] = [
  { type: 'arrow', label: '+ Arrow' },
  { type: 'text', label: '+ Text' },
  // { type: 'rectangle', label: '+ Rect' },
  // { type: 'circle', label: '+ Circle' },
  { type: 'freehand', label: '+ Pen' },
]

export default function AnnotationTools({ interactionMode, onSetMode, onCreateObject, onAddImage, drawEnabled }: AnnotationToolsProps) {
  return (
    <div className="flex items-center gap-1 px-2">
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

      <span className="w-px h-6 bg-gray-700" />

      {/* Creation buttons */}
      <button
        onClick={onAddImage}
        className="px-3 py-1.5 text-sm bg-gray-800 text-gray-300 hover:bg-gray-700 rounded transition-colors cursor-pointer"
      >
        + Image
      </button>
      {creationButtons.map((btn) => (
        <button
          key={btn.type}
          onClick={() => onCreateObject(btn.type)}
          className="px-3 py-1.5 text-sm bg-gray-800 text-gray-300 hover:bg-gray-700 rounded transition-colors cursor-pointer"
        >
          {btn.label}
        </button>
      ))}
    </div>
  )
}
