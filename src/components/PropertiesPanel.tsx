import type { TimelineObject, ProjectAction } from '../types'

type PropertiesPanelProps = {
  object: TimelineObject | null
  dispatch: React.Dispatch<ProjectAction>
}

export default function PropertiesPanel({ object: obj, dispatch }: PropertiesPanelProps) {
  if (!obj) {
    return (
      <div className="w-64 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto text-sm">
        <p className="text-gray-500 text-xs">No object selected</p>
      </div>
    )
  }

  const update = (updates: Partial<Omit<TimelineObject, 'id' | 'type'>>) => {
    dispatch({ type: 'UPDATE_OBJECT', objectId: obj.id, updates })
  }

  const updateStyle = (styleUpdates: Partial<TimelineObject['style']>) => {
    update({ style: { ...obj.style, ...styleUpdates } })
  }

  return (
    <div className="w-64 bg-gray-900 border-l border-gray-700 p-4 overflow-y-auto text-sm">
      {/* Name */}
      <div className="mb-4">
        <input
          type="text"
          value={obj.name}
          onChange={(e) => update({ name: e.target.value })}
          className="w-full bg-gray-800 text-white text-sm px-2 py-1 rounded border border-gray-700 focus:border-indigo-500 outline-none"
        />
        <span className="text-[10px] text-gray-500 mt-1 block capitalize">{obj.type}</span>
      </div>

      {/* Timing */}
      <Section title="Timing">
        <Field label="Start (s)">
          <NumberInput value={obj.startTime} min={0} step={0.1} onChange={(v) => update({ startTime: v })} />
        </Field>
        <Field label="Duration (s)">
          <NumberInput value={obj.duration} min={0.1} step={0.1} onChange={(v) => update({ duration: v })} />
        </Field>
        <Field label="Animate in (s)">
          <NumberInput value={obj.animateIn} min={0} step={0.1} onChange={(v) => update({ animateIn: v })} />
        </Field>
        <Field label="Lane">
          <NumberInput value={obj.lane} min={0} step={1} onChange={(v) => update({ lane: v })} />
        </Field>
      </Section>

      {/* Position */}
      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <Field label="X">
            <NumberInput value={obj.x} step={0.01} onChange={(v) => update({ x: v })} />
          </Field>
          <Field label="Y">
            <NumberInput value={obj.y} step={0.01} onChange={(v) => update({ y: v })} />
          </Field>
          <Field label="W">
            <NumberInput value={obj.width} step={0.01} min={0.01} onChange={(v) => update({ width: v })} />
          </Field>
          <Field label="H">
            <NumberInput value={obj.height} step={0.01} min={0.01} onChange={(v) => update({ height: v })} />
          </Field>
        </div>
        <Field label="Rotation">
          <NumberInput
            value={Math.round(obj.rotation * 180 / Math.PI * 10) / 10}
            step={1}
            onChange={(v) => update({ rotation: v * Math.PI / 180 })}
          />
        </Field>
      </Section>

      {/* Style (for non-photo objects) */}
      {obj.type !== 'photo' && (
        <Section title="Style">
          <Field label="Color">
            <input
              type="color"
              value={obj.style.color}
              onChange={(e) => updateStyle({ color: e.target.value })}
              className="w-8 h-6 bg-transparent border-none cursor-pointer"
            />
          </Field>
          <Field label="Opacity">
            <input
              type="range"
              min={0} max={100} step={1}
              value={Math.round(obj.style.opacity * 100)}
              onChange={(e) => updateStyle({ opacity: Number(e.target.value) / 100 })}
              className="w-full"
            />
          </Field>
          <Field label="Line width">
            <NumberInput value={obj.style.lineWidth} min={1} max={20} step={1} onChange={(v) => updateStyle({ lineWidth: v })} />
          </Field>
          {(obj.type === 'text') && (
            <Field label="Font size">
              <NumberInput value={obj.style.fontSize ?? 32} min={8} max={200} step={1} onChange={(v) => updateStyle({ fontSize: v })} />
            </Field>
          )}
        </Section>
      )}

      {/* Photo opacity */}
      {obj.type === 'photo' && (
        <Section title="Style">
          <Field label="Opacity">
            <input
              type="range"
              min={0} max={100} step={1}
              value={Math.round(obj.style.opacity * 100)}
              onChange={(e) => updateStyle({ opacity: Number(e.target.value) / 100 })}
              className="w-full"
            />
          </Field>
        </Section>
      )}

      {/* Actions */}
      <div className="mt-4 space-y-2">
        <button
          onClick={() => dispatch({ type: 'DUPLICATE_OBJECT', objectId: obj.id })}
          className="w-full px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 rounded transition-colors cursor-pointer"
        >
          Duplicate
        </button>
        <button
          onClick={() => dispatch({ type: 'REMOVE_OBJECT', objectId: obj.id })}
          className="w-full px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300 rounded transition-colors cursor-pointer"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// --- Helper components ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-gray-400 text-xs shrink-0">{label}</label>
      {children}
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 0.1,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      value={Number(value.toFixed(2))}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value)
        if (!isNaN(v)) onChange(v)
      }}
      className="w-20 bg-gray-800 text-white text-xs px-2 py-1 rounded border border-gray-700 focus:border-indigo-500 outline-none text-right"
    />
  )
}
