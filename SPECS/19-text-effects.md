# 19-text-effects — special & animated effects for text objects

## Overview

Text objects today render as a flat fill (optional solid background) via `drawText`. This spec adds an
opt-in **text effect** system so a text object can carry a visual preset beyond plain fill — split into
two tiers:

- **Tier 1 — static styling:** glow / neon, outline, drop shadow, gradient fill.
- **Tier 2 — animated presets:** pulse, rainbow (color-cycle), wave, shimmer.

**Fire / smoke / particle effects are explicitly out of scope** (deferred): they need a particle system
or shaders the Canvas-2D pipeline doesn't have. A future spec can add a stylized flame or a WebGL
effects layer if wanted.

Split out of the `18-qol` batch (that spec's R8) because this is a feature, not a papercut, and it has
a real architectural constraint (below). It builds on the same `TextData`/`drawText` surfaces `18-qol`
R5 (rounded corners) touches.

### The governing constraint (read first)

Per `CLAUDE.md`: `renderFrame(ctx, objects, globalTime, …)` in [renderer.ts](src/lib/renderer.ts) is a
**single pure compositor shared by preview and export**. It runs once per preview frame **and** once
per exported frame (frame-by-frame WebCodecs). Therefore **every effect must be a deterministic pure
function of `(object, time)`** rendered in **Canvas 2D**:

- ✅ allowed: `ctx.shadow*`, `strokeText`, gradients, per-glyph offsets, hue/scale/opacity driven by a
  time value.
- ❌ forbidden: reading the wall clock, unseeded `Math.random()`, WebGL/shaders, any per-frame state that
  isn't derivable from `(object, time)`.

If this holds, preview and export are pixel-identical **by construction** and animation reproduces
exactly at any fps. This is the single most important requirement (R-DET below).

## Requirements

### R-DET — Determinism (blocking, applies to every effect)
- Effects render purely from `(object, time)`; no wall-clock, no unseeded randomness, no GPU/shader
  dependency. Preview and exported MP4 must be pixel-identical, and animated effects must play in sync
  in the export at any project fps.

### R1 — Effect data model & back-compat
- R1.1 A text object may carry an optional `TextData.effect`. Absent ⇒ **rendered exactly as today**
  (no visual change, no perf change for un-effected text).
- R1.2 The effect persists in the object's `data` (part of the project JSON, `.brep`, and undo/redo).
- R1.3 One effect per text object in v1 (a single `effect?`, not a stack). Stacking is a possible
  follow-up.

### R2 — Tier 1: static styling
- R2.1 **Glow / neon** — a colored blur around the glyphs (color + blur radius; intensity may be
  multiple passes).
- R2.2 **Outline** — a stroked outline under/around the fill (color + width).
- R2.3 **Drop shadow** — offset shadow (color + dx/dy + blur).
- R2.4 **Gradient fill** — the text fill is a linear gradient (two+ stops + angle) instead of the solid
  `style.color`.
- R2.5 Each composes correctly with the existing **typewriter `animateIn` reveal**, enter/exit
  transitions, keyframes, rounded background (18-qol R5), alignment, wrapping, and `autoSize`.

### R3 — Tier 2: animated presets
- R3.1 **Pulse** — scale and/or opacity oscillates over time.
- R3.2 **Rainbow / color-cycle** — fill hue cycles over time.
- R3.3 **Wave** — per-glyph vertical (or rotational) offset that travels across the line over time.
- R3.4 **Shimmer** — a highlight/gradient band sweeps across the text over time.
- R3.5 Each animated preset is driven by a **clip-relative time** so it starts with the clip and is
  identical in preview and export. A `speed` (and where relevant `amplitude`) parameter tunes it.
- R3.6 Animated presets compose with the typewriter reveal (already-revealed glyphs animate; unrevealed
  ones stay hidden) without the layout reflowing/jumping.

### R4 — Authoring UI
- R4.1 An **effect picker** in the text section of `PropertiesPanel` (kind dropdown / preset menu,
  mirroring the enter/exit transition menu pattern), plus per-kind parameter controls that appear when
  that kind is selected.
- R4.2 "None" removes the effect (back to R1.1 rendering).
- R4.3 Editing an effect param is one undo entry (reuse the existing `updateData` "remember" helper),
  and updates live in the preview.

## Technical Considerations

### Relevant types (to add / where)

`TextData` — [src/types.ts:100-107](src/types.ts#L100-L107). Add an optional discriminated union:
```ts
// Tier 1 (static) + Tier 2 (animated) text effects. Absent = plain fill (today).
export type TextEffect =
  // Tier 1 — static
  | { kind: 'glow';     color: string; blur: number }                 // px blur (project-space, * scaleFactor)
  | { kind: 'outline';  color: string; width: number }                // px stroke width
  | { kind: 'shadow';   color: string; dx: number; dy: number; blur: number }
  | { kind: 'gradient'; from: string; to: string; angle: number }     // angle in degrees
  // Tier 2 — animated (time-driven; pure fn of clip time)
  | { kind: 'pulse';    speed: number; amount: number }               // scale/opacity oscillation
  | { kind: 'rainbow';  speed: number }                               // hue cycle
  | { kind: 'wave';     speed: number; amplitude: number }            // per-glyph vertical travel
  | { kind: 'shimmer';  speed: number; color: string }                // sweeping highlight band

export type TextData = {
  content: string
  background?: string
  padding?: number
  align?: TextAlign
  autoSize?: boolean
  cornerRadius?: number   // 18-qol R5
  effect?: TextEffect     // NEW (this spec)
}
```
No other type changes. `TextEffect` is a text-local concept (not `ObjectStyle`, which is shared across
all object types).

### Threading a time value into `drawText` (the one real plumbing cost)

`drawText` today: [annotations.ts:238-326](src/lib/annotations.ts#L238-L326), signature
`(ctx, data, style, progress, bx, by, bw, bh, scaleFactor)` — it receives the **reveal `progress`** but
**no time**. Tier 1 effects need no time (they can be applied from `data.effect` alone). **Tier 2
effects need a clip-relative time.**

- `renderFrame` already computes `const elapsed = globalTime - rawObj.startTime`
  ([renderer.ts:56](src/lib/renderer.ts#L56)) and passes `progress` down through `drawObject`
  ([renderer.ts:89-92](src/lib/renderer.ts#L89), [:135](src/lib/renderer.ts#L135)).
- Add a `time` (clip-relative seconds) param to `drawObject` and forward it to `drawText` (and only
  `drawText` needs it — other `draw*` fns can ignore/omit). Small, additive signature change; every
  other call site passes the value it already has.
- Keep animated math on `elapsed` (clip-relative) so an effect always starts with its clip and is fps-
  independent. (Global time would also be deterministic but would make identical clips animate out of
  phase — clip-relative is the right default.)

### How each effect maps to Canvas 2D (all in `drawText`, one change point)

Background fill stays where it is (now possibly a `roundRect` per 18-qol R5). The effect wraps the
**glyph** drawing (the `lines.forEach` fill loop, [annotations.ts:300-324](src/lib/annotations.ts#L300-L324)):

- **glow** → set `ctx.shadowColor = color`, `ctx.shadowBlur = blur * scaleFactor`, `shadowOffset = 0`
  before the fill (optionally fill 2–3× for intensity). Reset after.
- **outline** → `ctx.lineWidth = width*scaleFactor; ctx.strokeStyle = color; ctx.strokeText(...)` under
  each `fillText` (same substring/positions used for the reveal).
- **shadow** → `ctx.shadowColor/offsetX/offsetY/blur` (scaled) before fill.
- **gradient** → build `ctx.createLinearGradient` across the text box per the `angle`, use as
  `fillStyle` instead of `style.color`.
- **pulse** → multiply the object scale/alpha by `1 + amount*sin(2π*speed*time)`. Cleanest as a
  `ctx.translate(center)`→`ctx.scale(k)`→`translate(-center)` around the glyph loop and/or
  `globalAlpha *= …`.
- **rainbow** → `fillStyle = hsl((baseHue + speed*time*360) % 360, …)`; optionally per-glyph phase.
- **wave** → **requires per-glyph layout**: instead of one `fillText(l.text.slice(0, take))`, iterate
  characters, advancing x by `measureText`, offsetting each glyph's y by
  `amplitude*scaleFactor*sin(speed*time + i*k)`. This is the biggest change — a per-glyph draw path that
  still honors alignment + the typewriter reveal (`take`). Consider factoring a `drawLineGlyphs(...)`
  helper so justify/align/reveal logic isn't duplicated.
- **shimmer** → a moving linear-gradient highlight (transparent→color→transparent) whose offset =
  `f(time)`, drawn as the fill or as an overlay clipped to the glyphs.

`ctx.save()/restore()` already brackets `drawText`; effects must fully reset `shadow*`/`strokeStyle`
etc. so they don't leak to later objects.

### Perf

Tier 1 is a couple extra Canvas ops per text object — negligible. `shadowBlur` is the most expensive;
fine at normal counts. Per-glyph (wave) multiplies `measureText`/`fillText` calls by glyph count per
frame — still cheap for typical text, but note it in the export path (many frames). No worker/GPU work.

## Related Systems and Tasks

- **18-qol R5 (rounded text corners)** — same `TextData` + `drawText` surfaces; land order-independent
  but coordinate the `TextData` field additions if both are in flight. The background/rounded panel
  draws *before* the glyph effects.
- **Animation system (spec 12)** — effects must compose with `animateIn` reveal, enter/exit transitions,
  and keyframes (`resolveRenderPose`). The reveal `progress` and effects are orthogonal; both are
  applied inside/around the same glyph loop.
- **Export (`ffmpegExport.ts` + `renderer.ts`)** — no export-specific code changes: because effects live
  in the shared `renderFrame`/`drawText`, the WebCodecs and MediaRecorder paths get them for free. The
  `time` plumbing is the only renderer signature change.
- **Enter/Exit transition menu (`PropertiesPanel`)** — precedent UI pattern for R4's kind + params
  picker.

## Open Questions

- **OQ1 — first milestone.** Ship **Tier 1** then **Tier 2**, or both together? (18-qol decision was
  "Tier 1+2 first"; suggest implementing Tier 1 first within this spec, then Tier 2, as two commits.)
- **OQ2 — wave/per-glyph refactor.** Wave forces a per-glyph draw path in `drawText`. Acceptable to
  refactor the fill loop into a shared glyph-drawing helper (recommended), or keep wave as the only
  per-glyph path? Decide during implementation.
- **OQ3 — clip-relative vs global time** for animated effects. Defaulted to **clip-relative** (`elapsed`)
  so effects start with the clip and identical clips don't desync. Confirm.
- **OQ4 — one effect vs stack.** v1 = single `effect?`. Stacking (e.g. glow + wave) is a follow-up
  unless requested; note that Tier 1 (static) + Tier 2 (animated) not composing may feel limiting — an
  early call on whether to allow one static + one animated could be worth it.
- **OQ5 — preset params vs curated presets.** Expose raw params (color/blur/speed/…) or a few named
  presets ("Neon", "Rainbow", …) with sensible defaults, or both? Recommend curated presets with a few
  editable params.

## Acceptance Criteria

- **AC1 (R-DET):** For each effect, preview and exported MP4 are pixel-identical; animated effects play
  in sync in the export at 30 and 60 fps.
- **AC2 (R1):** A text object with no effect renders exactly as before (visual + perf no-op); adding an
  effect persists through save/`.brep`/undo/redo.
- **AC3 (Tier 1):** Glow, outline, shadow, and gradient each render correctly and compose with the
  typewriter reveal, rounded background, alignment, wrapping, and `autoSize`.
- **AC4 (Tier 2):** Pulse, rainbow, wave, and shimmer animate smoothly, start with the clip, and don't
  reflow the text; the typewriter reveal still works under them.
- **AC5 (R4):** The text panel shows an effect picker + per-kind params; "None" fully removes the effect;
  edits are single undo entries and update live.
- **AC6:** `npx tsc -b` stays green.

## Implementation Notes

- **Types:** add `TextEffect` union + `TextData.effect?` in [src/types.ts](src/types.ts).
- **Renderer plumbing:** add a clip-relative `time` param to `drawObject`
  ([renderer.ts:89](src/lib/renderer.ts#L89)) sourced from `elapsed`
  ([renderer.ts:56](src/lib/renderer.ts#L56)); forward to `drawText`
  ([renderer.ts:135](src/lib/renderer.ts#L135)).
- **Effects:** implement inside `drawText` ([annotations.ts:238](src/lib/annotations.ts#L238)), wrapping
  the glyph fill loop; consider a `drawLineGlyphs()` helper for the per-glyph (wave) path so
  align/justify/reveal logic isn't duplicated. Fully reset `ctx` effect state before `restore()`.
- **Panel:** effect picker + params in the text section of
  [PropertiesPanel.tsx](src/components/PropertiesPanel.tsx) (near the Background/Corner-radius fields),
  wired through the existing `updateData` helper; model the kind+params menu on the enter/exit
  transition UI.
- **Suggested order:** (1) types + `time` plumbing + Tier 1 static effects + panel; (2) Tier 2 animated
  presets (+ per-glyph refactor for wave). Fire/particles remain out of scope.
- Verify per `.claude/skills/verify` — static checks only (`npx tsc -b`), then hand the user a
  "click X, look for Y" checklist covering AC1–AC5. Do **not** run the dev server / browser.

## Deferred (explicitly out of scope)

- **Fire / smoke / particle effects.** Need a particle system or shaders the Canvas-2D pipeline lacks.
  A stylized flame (`f(time)` gradient + wavy mask + seeded flicker) or a WebGL effects layer is a
  separate spec if desired.
- **Effect stacking** beyond a single effect (OQ4).
