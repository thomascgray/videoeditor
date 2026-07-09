import type { TimelineObjectType, ObjectStyle } from '../types'

/**
 * Per-type "last used" defaults for freshly created objects.
 *
 * When the user edits an object's style (e.g. sets a drawing's colour to green) we remember it,
 * so the NEXT object of the same type is created with those settings instead of the cold factory
 * defaults. This is intentionally an in-memory, per-session store (module-level singleton) — it
 * mirrors how most editors carry the last-used pen/text settings forward. It is NOT persisted and
 * is NOT part of undo.
 *
 * `style` remembers a whitelisted subset of ObjectStyle (never opacity — that's per-object /
 * keyframable). `data` remembers only whitelisted type-specific fields (never identity payloads
 * like text content, arrow points, or asset ids).
 */

type Remembered = {
  style?: Partial<ObjectStyle>
  data?: Record<string, unknown>
}

const memory: Partial<Record<TimelineObjectType, Remembered>> = {}

// Style fields worth carrying to a new object. Opacity is deliberately excluded.
const STYLE_KEYS: (keyof ObjectStyle)[] = ['color', 'lineWidth', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle']

/** Remember the given style fields (whitelisted) as the new default for `type`. */
export function rememberObjectStyle(type: TimelineObjectType, style: Partial<ObjectStyle>): void {
  const picked: Partial<ObjectStyle> = {}
  for (const k of STYLE_KEYS) {
    if (style[k] !== undefined) (picked as Record<string, unknown>)[k] = style[k]
  }
  memory[type] = { ...memory[type], style: { ...memory[type]?.style, ...picked } }
}

/**
 * Remember type-specific data fields as the new default for `type`. Callers pass ONLY the fields
 * that are safe to carry forward (e.g. text background/align/autoSize, arrow curvature/head) —
 * never content/points/strokes/assetId.
 */
export function rememberObjectData(type: TimelineObjectType, data: Record<string, unknown>): void {
  memory[type] = { ...memory[type], data: { ...memory[type]?.data, ...data } }
}

/** The remembered style for `type`, or undefined if nothing has been edited yet. */
export function getRememberedStyle(type: TimelineObjectType): Partial<ObjectStyle> | undefined {
  return memory[type]?.style
}

/** The remembered data-field defaults for `type`, or undefined if none. */
export function getRememberedData(type: TimelineObjectType): Record<string, unknown> | undefined {
  return memory[type]?.data
}
