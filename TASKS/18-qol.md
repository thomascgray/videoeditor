# 18-qol — editor quality-of-life batch

**Status**: In Progress

## Overview

Implement the seven-item QoL batch specified in [SPECS/18-qol.md](../SPECS/18-qol.md):

- **R1** — out-of-frame resize/rotate handles remain visible & grabbable (bleed overlay).
- **R2** — floating context toolbar always stays within the visible viewport.
- **R3** — remember the canvas size for the next new project (localStorage pref).
- **R4** — clearer active-category indicator in the LeftRail (caret/connector).
- **R5** — rounded corners for text objects (background panel only).
- **R6** — in-place (on-canvas) text editing (double-click to edit).
- **R7** — right-hand property sections start collapsed.

(Text effects were split into [SPECS/19-text-effects.md](../SPECS/19-text-effects.md) — NOT part of this task.)

## Task Context

- **Verify with `npx tsc -b`** only. Do NOT run the dev server / browser (user tests manually). Hand a
  "click X, look for Y" checklist per change.
- Spec is the source of truth for approach & touch points. Key files:
  - **R1/R2/R6:** [src/components/Canvas.tsx](../src/components/Canvas.tsx) (overlay canvas, toolbar
    anchor `useLayoutEffect` ~:1287, `handleDoubleClick` ~:1212, `clientToNorm` ~:121, overlay sizing
    effect ~:559, `drawOverlay` ~:590, overlay JSX ~:1356).
  - **R3:** new pref helper (e.g. `src/lib/canvasSizePref.ts`), `createDefaultProject` in
    [src/types.ts](../src/types.ts#L229), `useProject` init/save-effect
    [src/hooks/useProject.ts](../src/hooks/useProject.ts#L251). Mirror `useUiPrefs` pattern.
    Reuse `sanitizeDimension` from [src/lib/aspectRatios.ts](../src/lib/aspectRatios.ts).
  - **R4:** [src/components/LeftRail.tsx](../src/components/LeftRail.tsx#L45) (active-icon markup).
  - **R5:** `TextData` [src/types.ts:100](../src/types.ts#L100), `drawText`
    [src/lib/annotations.ts:293](../src/lib/annotations.ts#L293), panel Field
    [src/components/PropertiesPanel.tsx:470](../src/components/PropertiesPanel.tsx#L470).
  - **R7:** `Accordion` [src/components/PropertiesPanel.tsx:761](../src/components/PropertiesPanel.tsx#L761).
- **Resolved decisions:** R5 = background-panel corners only (no stroke border). R6 Esc = commit
  (default), new text may drop into edit mode (nice-to-have). R3 "new project" = app boot; remember full
  custom dims; pref separate from `persistProject`/undo/`.brep`.
- **Coordinate model:** object x/y/w/h normalized 0–1 × project dims. Overlay is a 2nd canvas locked to
  the render canvas; must stay transform-aligned (spec 16 viewport zoom/pan).

## Blockers/Issues

None currently.

## TODO

[X] **R7** — `Accordion` default open → closed (+ optional `defaultOpen?` prop).
[X] **R5** — rounded text corners: `TextData.cornerRadius` + `roundRect` in `drawText` + panel Field.
[X] **R3** — canvas-size persistence: pref helper (load/save, try/catch, `sanitizeDimension` on load);
    `createDefaultProject(size?)`; seed in `useProject` init; save-on-change effect.
[X] **R4** — LeftRail active-category caret/connector + grouped surface.
[X] **R6** — in-place text editing: `editingTextId` state, positioned `<textarea>`, commit-on-blur/Esc,
    suppress drag while editing, hide edited object from render. (Requires object selected first —
    matches the existing "canvas edits the selected object" model; create-into-edit deferred.)
[X] **R1** — bleed overlay: enlarge overlay backing store + CSS + `setTransform` in `drawOverlay`;
    `clientToNorm` → render-canvas rect; toolbar-anchor scale source → render-canvas rect. `BLEED` const.
[X] **R2** — toolbar clamp: visible-range calc, fits-inside above/below decision, pin-to-top, two-axis clamp.
[X] `npx tsc -b` green after each chunk; final full pass.

## Work Log

[2026-07-17] Batch 1 (R7/R5/R3/R4) implemented; `npx tsc -b` green.

- **R7:** `Accordion` now takes `defaultOpen?` (default `false`) so all property sections (and the
  ZoomEditor's) start collapsed. Files: `src/components/PropertiesPanel.tsx`.
- **R5:** added `TextData.cornerRadius?`; `drawText` background fill uses `roundRect` (clamped by
  `scaleFactor` + half box) when set, else `fillRect`; new "Corner radius" `NumberInput` field shown
  when a text background is set. Files: `src/types.ts`, `src/lib/annotations.ts`,
  `src/components/PropertiesPanel.tsx`.
- **R3:** new `src/lib/canvasSizePref.ts` (`loadCanvasSize`/`saveCanvasSize`, try/catch, sanitized on
  load); `createDefaultProject(size?)`; `useProject` seeds the fresh-boot project from the pref and
  saves it whenever `present.width/height` change (independent of `persistProject`/undo). Files:
  `src/lib/canvasSizePref.ts`, `src/types.ts`, `src/hooks/useProject.ts`.
- **R4:** active LeftRail category now shows a filled `accent-soft` surface + left accent bar + a caret
  on the rail↔pane seam (rail lifted to `z-10` so the caret bridges into the pane). Files:
  `src/components/LeftRail.tsx`.

[2026-07-17] R6 (in-place text editing) implemented; `npx tsc -b` green.

- Double-click the selected text object (Frame view, move mode) → a `<textarea>` appears over it,
  autofocused with text selected. Positioned via the toolbar-anchor mapping (render-canvas rect →
  fit-box-local px) so it tracks viewport zoom/pan; best-effort rotation. The edited object is filtered
  out of the render (`renderObjects`) so there's no double image; commit on blur / Esc / ⌘|Ctrl+Enter as
  a single `UPDATE_OBJECT` (only if content changed). `handleMouseDown` early-returns while editing;
  App's key handler already ignores textarea targets so Delete/arrows/space don't mutate the object.
  Font size is approximate (auto-size estimated from box height/lines). Files: `src/components/Canvas.tsx`.
- Note: editing requires the object be selected first (via timeline/selection), consistent with all
  other canvas interactions which operate on the selected object only. Canvas has no select-on-click
  callback today; adding select-on-double-click for any text object is a possible follow-up.

[2026-07-17] R1 (bleed overlay) + R2 (toolbar viewport clamp) implemented; `npx tsc -b` green. All 7 done.

- **R1:** added `BLEED = 0.4`. Overlay backing store enlarged to `(1+2·BLEED)×frame`; overlay element
  offset `-BLEED*100%` / grown `(1+2·BLEED)*100%` with `transform-origin` on the frame's top-left so it
  stays locked to the render canvas under viewport zoom/pan; `drawOverlay` now clears the full store and
  `setTransform`-translates the origin to the frame top-left (every existing frame-px draw unchanged).
  `clientToNorm` calls + the toolbar-anchor scale source + the tooltip rect all switched from the
  (now-enlarged) overlay rect to the render-canvas (frame) rect. Render canvas / renderer / resize math
  untouched → export unaffected. Files: `src/components/Canvas.tsx`.
- **R2:** toolbar anchor now computes the visible range from the render-area (viewport) rect in
  fit-box-local px, decides above/below by whether the bar FITS inside that range, pins to the top edge
  when neither fits (tall selection), and clamps the resolved position on both axes. Two-side model kept
  (pin reuses 'below' anchoring) so the JSX `translateY` handling is unchanged. Files:
  `src/components/Canvas.tsx`.

[2026-07-17] R6 follow-up: fix edit-field font size for auto-size text; `npx tsc -b` green.

- Auto-size text is fitted to its box (with wrapping); the edit field previously used a naive
  height/line estimate that ballooned the font on double-click. Now the field runs the renderer's exact
  `fitText` (exported from `annotations.ts`) on the live text via an offscreen measuring context, so the
  edit font matches the displayed size and refits as you type. Files: `src/lib/annotations.ts`
  (export `fitText`), `src/components/Canvas.tsx`.

## Verification checklist handed to user (browser)

R7: select any object → all right-panel sections collapsed; expanding works; zoom editor too.
R5: text obj + background on → set Corner radius → rounded panel in preview; export shows same; radius 0
    or old text = square; undo works.
R3: change aspect ratio → refresh → new project opens at that size; clear localStorage 'canvas-size' →
    back to 1920×1080.
R4: click each LeftRail category → filled surface + caret pointing into the pane; collapse hides it.
R6: select a text obj → double-click it on canvas → textarea over it, type, click away/Esc commits (one
    undo); object doesn't move/delete while typing; tracks zoom/pan.
R1: make an object bigger than the frame → all 8 handles + rotate handle visible/grabbable in the margin;
    shrink back; in-frame object unchanged; zoom out reveals more handles; export unchanged.
R2: select an object taller than the frame → toolbar stays fully on-screen (pinned at top), not cut off.
