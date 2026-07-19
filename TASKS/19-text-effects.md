# 19-text-effects

**Status**: In Progress

## Overview

Add an opt-in **text effect** system so a text object can carry a visual preset beyond plain fill,
split into two tiers:

- **Tier 1 — static styling:** glow / neon, outline, drop shadow, gradient fill.
- **Tier 2 — animated presets:** pulse, rainbow (color-cycle), wave, shimmer.

Fire / smoke / particle effects are explicitly **out of scope**. Single effect per text object in v1
(no stacking). See [SPECS/19-text-effects.md](../SPECS/19-text-effects.md) for the full spec.

## Task Context

### Governing constraint (R-DET, blocking)
`renderFrame` in [src/lib/renderer.ts](../src/lib/renderer.ts) is the **single pure compositor shared by
preview and export**. Every effect MUST be a deterministic pure function of `(object, time)` in Canvas 2D.
No wall-clock, no unseeded `Math.random()`, no WebGL. Preview and export must be pixel-identical; animated
effects use **clip-relative** time (`elapsed = globalTime - startTime`) so they start with the clip and are
fps-independent.

### Key surfaces
- **Types:** `TextData` at [src/types.ts:100-109](../src/types.ts#L100-L109). Add `TextEffect` union +
  `TextData.effect?`.
- **Renderer plumbing:** `renderFrame` computes `elapsed` at [renderer.ts:56](../src/lib/renderer.ts#L56);
  `drawObject` at [renderer.ts:89](../src/lib/renderer.ts#L89) dispatches to `drawText` at
  [renderer.ts:135](../src/lib/renderer.ts#L135). Need to thread a clip-relative `time` into `drawObject`
  → `drawText` (only `drawText` uses it). `drawText`/`drawObject` have NO external callers.
- **Effects:** implement in `drawText` at [src/lib/annotations.ts:238-333](../src/lib/annotations.ts#L238-L333),
  wrapping the glyph fill loop (lines 305-331). Factor a `drawLineGlyphs()` helper for the per-glyph wave
  path so align/justify/reveal logic isn't duplicated. Fully reset `ctx.shadow*`/`strokeStyle` before
  `restore()` so effects don't leak to later objects.
- **Panel:** effect picker + params in the Text accordion of
  [src/components/PropertiesPanel.tsx:456-516](../src/components/PropertiesPanel.tsx#L456-L516). Model on the
  `TransitionFields` kind+params menu ([propertyControls.tsx:100](../src/components/propertyControls.tsx#L100)).
  Wire through the existing `updateData(dataUpdates, remember)` helper (one undo entry, live preview).

### Composition requirements
Effects must compose with: typewriter `animateIn` reveal (`progress`), enter/exit transitions, keyframes,
rounded background (18-qol R5 — draws BEFORE glyph effects), alignment, wrapping, `autoSize`.

## Decisions (open questions resolved)
- **OQ1 milestone:** implement Tier 1 then Tier 2 in this session.
- **OQ2 wave refactor:** factor a shared `drawLineGlyphs()` helper (recommended).
- **OQ3 time base:** clip-relative (`elapsed`). Confirmed.
- **OQ4 stacking:** single `effect?` in v1.
- **OQ5 params:** expose raw params with sensible per-kind defaults (matches existing `TransitionFields`
  pattern). Curated named presets deferred.

## Blockers/Issues

None currently.

## TODO

[X] R1: Add `TextEffect` union + `TextData.effect?` to src/types.ts
[X] Renderer plumbing: thread clip-relative `time` through `drawObject` → `drawText`
[X] Tier 1 static effects in drawText: glow, outline, shadow, gradient
[X] Factor per-glyph paint helper (`paintRun` + `renderLines`, shared reveal/align/justify)
[X] Tier 2 animated effects: pulse, rainbow, wave, shimmer
[X] R4: effect picker + per-kind params in PropertiesPanel Text accordion
[X] Verify `npx tsc -b` green
[ ] User browser verification against AC1–AC5 (checklist handed over)

## Work Log

[2026-07-18] Implemented the full text-effect system (Tier 1 + Tier 2) in one pass.
- **Types:** added `TextEffect` discriminated union (glow/outline/shadow/gradient/pulse/rainbow/wave/
  shimmer) + `TextEffectKind` + `TextData.effect?`. Files: [src/types.ts](../src/types.ts).
- **Renderer plumbing:** added a clip-relative `time` param to `drawObject`, sourced from the existing
  `elapsed`, forwarded to `drawText` only. Files: [src/lib/renderer.ts](../src/lib/renderer.ts).
- **Effects:** `drawText` now sets up fill/outline/shadow/wave/pulse from `data.effect` and repaints the
  glyphs via `renderLines()`/`paintRun()` (per-glyph when waving; whole-substring otherwise). All state
  is set inside the existing save scope so nothing leaks. `buildGradient`/`buildShimmer` helpers added.
  Glow uses 3 repaint passes to deepen the halo. Files: [src/lib/annotations.ts](../src/lib/annotations.ts).
- **Panel:** `EffectFields` (kind dropdown + per-kind params, "None" removes) + `DEFAULT_TEXT_EFFECT`/
  labels, modeled on `TransitionFields`; wired into the Text accordion via `updateData` (one undo entry,
  live preview). Files: [src/components/propertyControls.tsx](../src/components/propertyControls.tsx),
  [src/components/PropertiesPanel.tsx](../src/components/PropertiesPanel.tsx).
- **Export:** no changes needed — both export paths call the shared `renderFrame`, so effects (incl.
  animated, driven by clip-relative time) are pixel-identical in export by construction (R-DET).
- `npx tsc -b` green.
- Note: animated effects only move while the playhead advances (play/scrub) — a paused frame is a
  deterministic static snapshot, which is the intended R-DET behavior.
