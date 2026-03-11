import type { AnnotationTool } from '../types'

type AnnotationToolsProps = {
  activeTool: AnnotationTool
  onSelectTool: (tool: AnnotationTool) => void
}

const tools: { id: AnnotationTool; label: string; shortcut: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'rectangle', label: 'Rect', shortcut: 'R' },
  { id: 'circle', label: 'Circle', shortcut: 'C' },
  { id: 'freehand', label: 'Pen', shortcut: 'P' },
]

export default function AnnotationTools({ activeTool, onSelectTool }: AnnotationToolsProps) {
  return (
    <div className="flex items-center gap-1 px-2">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => onSelectTool(tool.id)}
          className={`px-3 py-1.5 text-sm rounded transition-colors cursor-pointer ${
            activeTool === tool.id
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
          title={`${tool.label} (${tool.shortcut})`}
        >
          {tool.label}
        </button>
      ))}
    </div>
  )
}
