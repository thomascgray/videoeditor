# 17-ui-redesign

**Status**: Complete — **all workstreams shipped: T · I · H · C · L · M · P (P1–P3 + P5) + interim tweaks. Parity verified; `tsc -b` + `vite build` green. User-signed-off 2026-07-16.**

## Overview

A broad, phased UI/UX redesign of the video editor: a light/grey visual language with a configurable accent, a left asset/creation rail, a floating context toolbar over the selected object, floating transport controls above the scrub bar, a Tabler icon system, and a rethink of the Move/Draw interaction. **Functionality parity is a hard requirement** — everything the editor does today must still work. **No data-model / reducer / renderer / camera / export changes**; the only addition is a persisted `UiPrefs` (theme/accent) localStorage blob.

Full design + rationale: **[SPECS/17-ui-redesign.md](../SPECS/17-ui-redesign.md)** (source of truth — read it before working any workstream).

## ⏭️ RESUME HERE — next session

**Progress: T · I · H · C · L · M are DONE, `tsc -b` green. Only workstream P remains, then a final parity/verify pass.** Read this section + the TODO/Work Log below; the spec has the deeper rationale.

### How to work (verify policy)
- **Static checks only: `npx tsc -b` must stay green. Do NOT run the dev server or browser automation.** The user runs `npm run dev` and tests in-browser — hand them a "click X → look for Y" checklist per change and checkpoint at natural milestones (not every edit).
- **tsc does NOT check CSS.** To confirm token/Tailwind classes actually compile, run `npx vite build` and grep `dist/assets/*.css` for the class name (this caught the `@theme` bug). **Never put `*/` inside a CSS comment** (it closes the comment early and silently drops the whole `@theme` block).

### Current architecture (after T–M)
- **Design tokens** — `src/index.css` via `@theme inline`: `bg-bg`, `bg-surface`, `bg-surface-muted`, `bg-surface-hover`, `border-border`, `border-border-strong`, `text-fg`, `text-muted`, `text-subtle`, `bg-accent`, `bg-accent-hover`, `text-accent-contrast`, `bg-accent-soft`, `text-accent`, `bg-camera`/`text-camera`, `bg-playhead`, `bg-danger`/`bg-danger-soft`/`text-danger`. Light default; dark = `:root[data-theme="dark"]`; accent = `:root[data-accent="…"]`. Opacity modifiers work (`bg-accent/60`). Range/checkbox auto-themed by a base `accent-color` rule (use `accent-accent` or omit).
- **Theme/accent** — `useUiPrefs` hook (persists `ui-prefs` in localStorage, stamps `data-theme`/`data-accent`) + `AppearanceControls` in the header.
- **Icons** — `@tabler/icons-react`, per-icon imports, `size` 14–20, `stroke={2}` (1.8 for larger), colour via `text-*` (currentColor). No shared `Button`/`Panel`/`Popover` primitives extracted yet (P is a good time — mirror `AspectRatioSelector`'s popover pattern).
- **App layout** (`App.tsx` main row) — `flex-1 flex min-h-0` → **`<LeftRail>`** (shrink-0) · **`<div className="relative flex flex-1 min-w-0">`** wrapping `<Canvas>` + floating **`<TransportBar>`** (`absolute bottom-5 inset-x-0 … pointer-events-none z-20`; pill sets `pointer-events-auto`) · **`<PropertiesPanel>`** (w-64). Slim header: name · Save/Load · aspect · undo/redo · `<AppearanceControls>` · Export. Render area has a `pb-20` bottom gutter for the pill; default timeline height = `innerHeight * 0.22`. Panels are flush (`border-r`/`border-l`) — making them *floating cards* is optional polish the user would like.
- **Selection/mode** (`App.tsx`) — `selectedObjectId` + `selectedZoomId` (mutually exclusive); `drawingObjectId` (`null` = not drawing). **`interactionMode` is DERIVED**: `drawingObjectId===selectedObjectId ? 'draw' : 'move'`, passed to Canvas (its draw/move code is unchanged) + to PropertiesPanel as `isDrawing`. `handleToggleDrawSelected` = the "Edit points" toggle (tightens bbox on finish). No global Move/Draw UI.
- **Canvas** (`Canvas.tsx`) — render+overlay canvases inside a viewport-transform layer; **fit box** = `ref={fitBoxRef} className="relative max-w-full max-h-full"` (~L1249). **The Frame/Live toggle (~L1280) + zoom cluster (~L1294) are NON-transformed siblings inside the fit box** — the pattern the ContextToolbar must follow. `overlayCanvasRef`; `selectedObject = resolvePose(raw, globalTime)`; `clientToNorm` uses `getBoundingClientRect` (reflects viewport zoom/pan). Canvas already gets `dispatch`, `selectedObjectId`, `globalTime`, `width`/`height`, `zooms`, `interactionMode`.
- **Inspector** (`PropertiesPanel.tsx`) — w-64 `bg-surface border-l`; sections via `<Section>`/`<Field>`/`<NumberInput>`; `ZoomEditor` for zooms; new **Points** section holds "Edit points" (`isDrawing`/`onToggleDraw`). Reuse these section components for P popovers.

### Remaining: P — floating context toolbar + redesigned inspector (hybrid, spec OQ-1). Build in stages; checkpoint after P1.

- **P1 — anchoring (do first, validate before adding controls).** New `ContextToolbar` **hosted inside `Canvas.tsx`** as a non-transformed sibling in the fit-box `relative` div (same layer as the Frame/Live button → not scaled by viewport transform, clipped by the render area's `overflow-hidden`; use a portal only if popovers need to exceed it). Screen box = `resolvePose(obj, globalTime)` normalized bbox × `overlayCanvasRef.getBoundingClientRect()` (viewport-aware, same invariant as hit-testing); for rotation use the **axis-aligned bounds of the 4 rotated corners**. Center it above the box; **flip below** when the box top is within ~(toolbarH+margin) of the render-area top; **clamp** horizontally. **Hide** while `dragState != null` and while `isPlaying`; re-anchor on release/pause (OQ-6). **Audio → no toolbar** (props stay in the inspector, P4). Recompute on selection / `globalTime` / viewport / width,height / resize. Ship a minimal bar first (duplicate · delete · "Edit points" for arrow/pen) to prove anchor/flip/track-at-zoom.
- **P2 — per-type controls + popovers.** text → font, size, B/I, align, colour; arrow → colour, width, curvature, moving-head, **Edit points** (move `onToggleDraw` onto the toolbar); photo/video → opacity, volume/mute; universal → duplicate/delete/lane. Deep/grouped → **popovers** (build a `Popover` mirroring `AspectRatioSelector`; **extract `Section`/`Field`/`NumberInput`/`TransitionSection`/keyframe UI from PropertiesPanel into a shared module** so popovers + inspector share them). "Animate" = enter/exit + keyframes; "Timing" = start/duration/speed/trim. Split detail = OQ-8 (colour/opacity one-click on the bar; keyframes/transitions in popovers/inspector).
- **P3 — inspector redesign.** Make `PropertiesPanel` sections **visually distinct** (the original "sections aren't distinct" complaint): iconed headers, collapsible accordions, better grouping/dividers/spacing. Keep it as the depth surface + audio's home.
- **Non-regression:** every current property still editable somewhere; export byte-identical; all canvas gestures work at any viewport zoom; `tsc -b` green.

### After P
Final parity/verify pass (walk the "functionality inventory" in the spec), then ask the user to mark the task ✅ / rename the file with a ✅ prefix.

## Task Context

- **Verify policy** (`.claude/skills/verify`): static checks only — `npx tsc -b` must stay green. **Do NOT run the dev server or browser automation.** The user runs `npm run dev` and tests in the browser; hand them a short "click X, look for Y" checklist after each change.
- **Build order (one task, phased):** **T** (tokens + light theme) → **I** (Tabler icons) → **H+C** (slim header + floating transport) → **L** (left rail + basic library) → **M** (auto draw model) → **P** (floating context toolbar + redesigned inspector). Keep `tsc -b` green at each step.
- **Confirmed decisions (spec OQ-1..7):** hybrid properties (floating toolbar + kept, redesigned inspector); light default + dark toggle + preset accents (Blue/Teal/Violet/Rose) persisted to `UiPrefs`; left rail = relocate creation/add-media + basic re-addable asset library; auto per-object draw (no global mode; "Edit points" affordance); **rectangle/circle stay disabled**.
- **Theme approach (T):** semantic CSS-variable tokens in `src/index.css`, wired to Tailwind v4 utilities via `@theme inline`. Runtime theme = `[data-theme="dark"]` on `<html>`; accent = `[data-accent="..."]`. Native range/checkbox themed globally via an `accent-color` base rule (kills scattered `accent-indigo-500`).
- **Token map (apply consistently):** `bg-gray-950`→`bg-bg`; `bg-gray-900`→`bg-surface`; `bg-gray-800`→`bg-surface-muted`; `hover:bg-gray-700`→`hover:bg-surface-hover`; `bg-gray-700`(dividers)→`bg-border`; `border-gray-700/800`→`border-border`; `border-gray-600`→`border-border-strong`; `text-gray-300/400`→`text-muted`; `text-gray-500/600`→`text-subtle`; `text-white`→`text-fg` **except** on saturated/colored fills (Export, active states, timeline bars) → `text-accent-contrast` or keep white; `focus:border-indigo-500`→`focus:border-accent`; `bg-indigo-600`→`bg-accent`, `hover:bg-indigo-500`→`hover:bg-accent-hover`; `text-indigo-*`→`text-accent`; `bg-indigo-*/10-20`→`bg-accent-soft`; `accent-indigo-500`→`accent-accent`; red delete → `bg-danger-soft text-danger`; amber camera semantics → `bg-camera`/`text-camera`.
- **Semantics to preserve (do NOT repurpose):** camera-amber (`--camera`), playhead-red (`--playhead`), per-type timeline `TYPE_COLORS` ([Timeline.tsx:40](../src/components/Timeline.tsx#L40)), keyframe palette `KEYFRAME_COLORS` ([keyframes.ts:33](../src/lib/keyframes.ts#L33)).
- **Working tree caveat:** several `src/*` files carry uncommitted spec-14 WIP (video-sequencing). Build on the current working-tree state; don't revert it. Recommend a feature branch off `master` at first commit.
- **Files in play:** `index.css` (tokens); components `App`, `AnnotationTools`, `VolumeControl`, `AspectRatioSelector`, `PropertiesPanel`, `Canvas`, `Timeline`, `ImportModal`, `ExportModal`; new (later phases) `LeftRail`, `ContextToolbar`, `TransportBar`, `useUiPrefs`, UI primitives. **No** `src/lib/*` domain files, `useProject`, or export files change.

## Blockers/Issues

- **[RESOLVED 2026-07-14] "500 MB" warning on every import (pre-existing).** `getTotalAssetSize()` sums the whole in-memory blob cache, which `loadAssetsFromDB()` fills from IndexedDB on startup. With `persistProject:false` the project resets each refresh but the IndexedDB blobs persist forever (never cleaned), so the cache accumulated every asset ever imported across sessions → the total blew past 500 MB even for a tiny fresh import. Fix (`App.tsx` startup effect): when `!config.persistProject`, `clearAllAssets()` on startup instead of loading them — keeps the size total + the rail library scoped to the current session. (First refresh purges the accumulated junk.)
- **[RESOLVED 2026-07-14] Modal backdrop let the timeline show through.** The timeline's pinned ruler/gutter/Camera-track use `z-[60]`/`z-[70]` to float above the scrolling lanes, but the Timeline root created no stacking context, so those z-values leaked into the root context and painted **above** the modals' `z-50` backdrop. Fix: added `isolate` (`isolation: isolate`) to the Timeline root to contain its internal z-indices, and raised both modals to `z-100`. (General lesson: components with high internal z-indices should `isolate` so they don't compete with app-level overlays.)
- **[RESOLVED 2026-07-13] Token utilities silently not generating.** A comment in `index.css` contained `gray-*/indigo-*`; the `*/` closed the CSS comment early, corrupting the `@theme` block so Tailwind dropped **every** token utility (`bg-accent`, `bg-surface`, etc.). App still looked "light" only because unstyled elements showed the body background through. **Gotcha for this task:** never put `*/` inside `index.css` comments. **`tsc -b` does NOT check CSS** — verify token utilities compiled via `npx vite build` then grep `dist/assets/*.css` for the class names (that's how this was caught).

## Final parity audit (2026-07-16)

Static side complete: **clean `tsc -b --force` + `vite build` both green**; no dangling refs (`AnnotationTools` deleted; `VolumeControl` still used by `TransportBar`). Inventory walk vs [SPECS/17-ui-redesign.md](../SPECS/17-ui-redesign.md) §"Functionality inventory":

- **Project** (rename, Save/Load, aspect, undo/redo) — header, unchanged ✓
- **Create** (media import + library, +Text, +Arrow, +Pen, +Zoom) — all in `LeftRail`; rectangle/circle correctly absent ✓
- **Canvas edit** (select/move/resize/rotate, draw/extend arrow, freehand, camera framing-rect, viewport zoom/pan, Frame/Live V) — `Canvas`, untouched by P ✓
- **Properties** — every field reachable in the **inspector** (P3 preserved all); the **toolbar** is an additive fast-path for text/arrow/freehand/photo/video; audio → inspector only (P4) ✓
- **Camera zoom** (focus/zoom×/timing/jump/keyframes/delete) — inspector `ZoomEditor` + on-canvas framing rect ✓
- **Timeline** (scrub/select/move/trim/Slice S/Hide H/keyframe diamonds/lanes/Camera track/time-zoom/collapse) — untouched by P ✓
- **Transport** (Space play, speed, volume/mute, time) — floating `TransportBar` ✓
- **Export** — `ExportModal`, untouched ✓

**Deliberate deviations (documented, user-approved):**
- **`M`/`D` shortcuts removed** — the global Move/Draw mode was retired in workstream M (auto per-object draw). All other shortcuts intact (Space, V, H, S, Enter, Esc, Del/Backspace, Ctrl+Z/Y).
- **Export not byte-identical for text** — the redesign *chrome* never touches `renderFrame`, BUT the two user-requested text tweaks do change text rendering (background now fills the full box; new text defaults to instant reveal). Preview and export stay WYSIWYG-consistent (same `renderFrame`); only text-with-background / new-text-defaults differ from the pre-redesign look, by request.

**P5 (floating toolbar for camera zooms) — built 2026-07-16** (was flagged as deferred; user asked for it). `ZoomContextToolbar` in `ContextToolbar.tsx`: **Zoom ▾** (Focus X/Y + Zoom×, keyframe-aware via `editZoomPose`) · **Timing ▾** (start/ease-in/hold/ease-out/motion) · **Delete** (removes + clears selection). Canvas's anchoring effect was generalized to compute bounds from **either** the object bbox **or** the selected zoom's framing rect (`cameraFrameRect(zoomTargetPoseAt(...))`, + clearance for the scale/keyframe label tab it draws above); same flip/clamp/measure/hide-during-drag-playback-live path. No new Canvas props (reused `selectedZoom`/`onSelectZoom`/`dispatch`/`globalTime`). Keyframes stay in the inspector + on-canvas reframe (same OQ-8 depth split as objects). Minor known nit: editing focus/scale in the popover moves the framing rect (and thus the toolbar) while the portalled popover stays at its open position — acceptable; canvas drag is the primary focus/scale gesture. `tsc -b` + `vite build` green.
- Fix (same day): the Zoom popover's Focus X/Y inputs overlapped — the `w-52` popover was too narrow for two `w-20` `NumberInput`s plus the long "Focus X/Y" labels. Widened to `w-60` and used short **X**/**Y** labels under a "Focus" heading (matches the inspector's compact 2-col layout); Timing popover widened to `w-60` for consistency.

## TODO

- [ ] **T — Theme & tokens**
  - [X] `index.css`: semantic token layer (light default + dark overrides + 4 accent presets) + base styles
  - [X] Migrate `App.tsx` shell + header to tokens
  - [X] Migrate header sub-components: `AnnotationTools`, `VolumeControl`, `AspectRatioSelector`
  - [X] ~~CHECKPOINT~~ user verified token wiring + palette (light + blue) in browser ✓
  - [X] Migrate `PropertiesPanel` (+ `ZoomEditor`)
  - [X] Migrate `Canvas` (render-area bg, corner controls; kept dark tooltip + amber/keyframe semantics)
  - [X] Migrate `Timeline` (chrome + Camera-track fill + lane striping to light; kept `TYPE_COLORS`/keyframe/amber/playhead)
  - [X] Migrate `ImportModal`, `ExportModal`
  - [X] `tsc -b` green; `vite build` clean; no stray `gray-*`/`indigo-*` in chrome (only deliberate semantic colors remain)
  - [ ] (Deferred) extract shared primitives `Button`/`IconButton`/`Panel`/`Section`/`Field`/`Popover` — most useful when building new UI in H/L/P
  - [ ] **← CHECKPOINT: user verifies full light theme across all surfaces**
- [ ] **I — Tabler icons**
  - [X] Add `@tabler/icons-react` (`^3.44.0`); convention = per-icon imports, `size` 14–18, `stroke={2}`, color via `text-*` (inherits `currentColor`)
  - [X] Header actions (Save/Load/Undo/Redo/Play/Export) + toolbar (Move/Draw/Asset/Arrow/Text/Pen/Zoom) icons
  - [X] Timeline glyphs (collapse chevron, add/remove-lane, camera → `IconViewfinder`, hide eye → `IconEye/EyeOff` replacing the hand-rolled SVG)
  - [X] Canvas corner controls (Frame/Live → `IconViewfinder`/`IconPlayerPlay`, zoom cluster − + → `IconMinus`/`IconPlus`)
  - [X] Modal close/remove (×) buttons → `IconX`
  - [ ] (Fold in later) transport + tool CTAs get their icons carried into the C/L components
  - Note: tiny inline `⛶` glyphs inside colored timeline bar-labels + canvas amount tab left as text (fine on saturated bars)
- [ ] **H+C — Slim header + floating transport**
  - [X] Extract `TransportBar` (play/pause, time, speed, volume/mute) → floating pill above the scrub bar; Space still toggles play (handler stays in App); centered over the canvas via `right-64` inset; `pointer-events-none` container so it never blocks canvas clicks; works expanded/collapsed
  - [X] Removed transport from the header (+ pruned now-unused `IconPlayerPlay/PauseFilled` + `VolumeControl` imports from App)
  - [X] Header: theme toggle + accent picker (`AppearanceControls` + `useUiPrefs` hook — stamps `data-theme`/`data-accent`, persists to a `ui-prefs` localStorage blob)
  - [X] Header tidied — after C (transport out) + L (creation → rail), it's now: name · Save/Load · aspect · Move/Draw · undo/redo · appearance · Export
- [X] **L — Left rail + basic library**
  - [X] `LeftRail` (Media / Text / Elements / Zoom) — vertical icon rail + content pane, collapsible; ephemeral view-state
  - [X] Media "Add media" opens the retained `ImportModal` (keeps drag/browse/paste + validation/warnings + previews)
  - [X] Basic re-addable library — `project.assets` as thumbnails (`getAssetUrl`; audio → music icon); click re-adds a new object reusing the `assetId` (no re-import) via `App.handleAddExistingAsset`
  - [X] Stripped creation clusters from `AnnotationTools` (now just Move/Draw); restructured the main row → `LeftRail | (Canvas + floating transport) | PropertiesPanel`; transport now centered over the canvas exactly (wrapper div, `inset-x-0`)
- [X] **M — Auto draw model**
  - [X] Replaced global `interactionMode` state with per-object `drawingObjectId`; `interactionMode` is now a DERIVED value (`drawingObjectId === selectedObjectId ? 'draw' : 'move'`) passed to Canvas/PropertiesPanel — Canvas's draw/move logic untouched (lowest-risk). Removed the global Move/Draw toggle + deleted `AnnotationTools.tsx`. Dropped the `m`/`d` shortcuts.
  - [X] Create arrow/pen → auto-enters drawing that object; finish (right-click/Enter/double-click/max-points/Esc/select-away) → auto-returns to select. "Edit points" / "Done editing points" button in the PropertiesPanel **Points** section (`onToggleDraw`) — will move to the floating context toolbar in **P**. bbox auto-tighten preserved on all finish paths (no double-tighten).
- [X] **P — Floating properties**
  - [X] **P1** `ContextToolbar` anchored to selection (flip above/below, clamp, viewport-zoom-aware, hide during drag/playback/live/draw). Minimal bar (edit-points · duplicate · delete) — user-verified ✓
  - [X] **P2** Per-type toolbar controls + popovers (spec OQ-8). Extracted shared `propertyControls.tsx`; built portalled `Popover`. User-verified ✓
  - [X] **P3** Section-distinct inspector: iconed collapsible accordion cards. **← CHECKPOINT: user verifies inspector**
- [X] **Final parity + verify pass** — inventory audited (see "Final parity audit" above); clean `tsc -b --force` + `vite build`; deliberate deviations documented. Awaiting user smoke-test → mark ✅.

## Work Log

[2026-07-13] Created task doc from spec 17 (all design forks resolved). Starting workstream **T** (theme tokens).

[2026-07-13] T (foundation + shell): added the semantic token layer + light/dark themes + 4 accent presets, and migrated the whole top bar + app frame onto tokens. `tsc -b` green.

- Files modified: `src/index.css` (new `@theme inline` token map, light defaults, `[data-theme="dark"]` overrides, `[data-accent]` presets, base body + form-control `accent-color`), `src/components/App.tsx` (root, header, name input, Save/Load, dividers, undo/redo, play/pause, speed, time, Export, collapsed-timeline bar, splitter), `src/components/AnnotationTools.tsx`, `src/components/VolumeControl.tsx`, `src/components/AspectRatioSelector.tsx`.
- Remaining T files (still on stock dark palette until migrated — expected): `PropertiesPanel`, `Canvas`, `Timeline`, `ImportModal`, `ExportModal`.
- Note: theme = `document.documentElement.dataset.theme` ('dark' or unset=light); accent = `dataset.accent` ('teal'|'violet'|'rose'|unset=blue). Interactive toggle/picker lands in workstream H.

[2026-07-13] Fixed the token-layer bug (comment `*/` had killed all `@theme inline` utilities — see Blockers) and confirmed via `vite build` + grep that `bg-accent`/`bg-surface-hover`/`text-accent-contrast`/etc. now compile. Bumped light `--surface-hover` (#e7e9ee→#e0e4ea) and `--surface-muted` (#f2f3f5→#eef0f3) so button hover states read clearly.

- Files modified: `src/index.css`.

[2026-07-13] Completed the workstream-T token sweep across the remaining components. Only deliberate semantic colors remain (camera-amber, playhead-red, dim modal backdrops, dark canvas tooltip, light type-badges in the import modal, white/black text on saturated timeline bars). Converted the Timeline Camera-track fill (`#111827`→`var(--surface-muted)` + amber wash) and lane striping (`rgba(255,255,255,.02)`→`rgba(0,0,0,.03)`) to light-theme values. `tsc -b` green; `vite build` clean (no CSS warnings); grep-confirmed `bg-camera`/`bg-playhead`/`bg-danger-soft`/`border-border-strong` etc. compile.

- Files modified: `src/components/PropertiesPanel.tsx`, `src/components/Canvas.tsx`, `src/components/Timeline.tsx`, `src/components/ImportModal.tsx`, `src/components/ExportModal.tsx`.
- **T is functionally done.** Deferred within T: shared UI primitives (opportunistic; will land alongside new UI in H/L/P). Next workstream: **I** (Tabler icons).

[2026-07-14] I (start): installed `@tabler/icons-react ^3.44.0`; established icon conventions; icon-ified the top bar — header actions (Save `IconDeviceFloppy`, Load `IconFolderOpen`, Undo/Redo `IconArrowBackUp/ForwardUp`, Play/Pause `IconPlayerPlay/PauseFilled`, Export `IconDownload`) and the toolbar (Move `IconPointer`, Draw `IconPencil`, Asset `IconPhotoPlus`, Arrow `IconArrowUpRight`, Text `IconTypography`, Pen `IconScribble`, Zoom `IconZoomScan`). `tsc -b` green (also validates the icon names exist).

- Files modified: `src/components/AnnotationTools.tsx` (rewritten with icons), `src/components/App.tsx` (header actions + import).
- Pending I: timeline glyphs, canvas corner controls, modal close buttons.

[2026-07-14] I (complete): icon-ified the remaining durable surfaces — Timeline (collapse `IconChevronDown`, add-lane `IconPlus`, remove-lane `IconX`, camera `IconViewfinder`, hide `IconEye/IconEyeOff` replacing the hand-rolled `EyeIcon` SVG), App collapsed-bar expand (`IconChevronUp`), Canvas corners (Frame/Live `IconViewfinder`/`IconPlayerPlay`, zoom cluster `IconMinus`/`IconPlus`), ImportModal close + per-item remove (`IconX`). `tsc -b` green. **I is done** except transport + tool-CTA icons, which carry into the new C/L components. Next workstream: **H+C** (slim header + floating transport pill).

- Files modified: `src/components/Timeline.tsx`, `src/components/App.tsx`, `src/components/Canvas.tsx`, `src/components/ImportModal.tsx`.

[2026-07-14] Fixed modal-backdrop z-index bug (timeline showing through the dim overlay): `isolate` on the Timeline root + modals raised to `z-100`. `tsc -b` green.

- Files modified: `src/components/Timeline.tsx`, `src/components/ImportModal.tsx`, `src/components/ExportModal.tsx`.

[2026-07-14] C (floating transport): built `TransportBar` (play/pause pill, m:ss.s clock, preview-speed slider, volume) and floated it above the scrub bar, centered over the canvas (`absolute bottom-4 left-0 right-64`, `pointer-events-none` container + `pointer-events-auto` pill). Removed play/speed/volume/time from the header and pruned the now-unused imports. Space→play still handled in App's keydown. `tsc -b` green. Remaining H: theme/accent controls in the header.

- Files added: `src/components/TransportBar.tsx`. Files modified: `src/components/App.tsx`.

[2026-07-14] C polish (Canva-like breathing room, per user): added a bottom gutter to the render area (`pb-20`) so the transport pill floats in the gap *below* the frame instead of over it, and reduced the default timeline height (`window.innerHeight * 0.35 → 0.22`) to give the render room. `tsc -b` green.

- Files modified: `src/components/Canvas.tsx` (render-area `pb-20`), `src/components/App.tsx` (`defaultTimelineHeight` fraction).

[2026-07-14] H (theme/accent controls): added `useUiPrefs` (persist theme+accent to `ui-prefs` localStorage, stamp `data-theme`/`data-accent` on `<html>`) + `AppearanceControls` (4 accent swatches + light/dark toggle) in the header. `tsc -b` green.

- Files added: `src/hooks/useUiPrefs.ts`, `src/components/AppearanceControls.tsx`. Files modified: `src/components/App.tsx`.

[2026-07-14] L (left rail + basic library): built `LeftRail` (Media/Text/Elements/Zoom icon rail + collapsible content pane; Media = "Add media" → import modal + a re-addable thumbnail library of `project.assets`). Added `App.handleAddExistingAsset` (re-add by `assetId`, no re-import). Slimmed `AnnotationTools` to Move/Draw only and restructured the main content row to `LeftRail | (Canvas + floating transport wrapper) | PropertiesPanel` — the transport pill now centers exactly over the canvas. `tsc -b` green. **H + L done.** Next: **M** (auto/per-object draw model), then **P** (floating context toolbar + inspector redesign).

- Files added: `src/components/LeftRail.tsx`. Files modified: `src/components/App.tsx`, `src/components/AnnotationTools.tsx`.

[2026-07-14] Fixed the pre-existing "500 MB" false-warning (orphaned assets accumulating across sessions) — see Blockers. `App.tsx` startup effect now purges assets when not persisting. `tsc -b` green.

- Files modified: `src/components/App.tsx`.

[2026-07-14] M (auto/per-object draw model): App now holds `drawingObjectId` instead of an `interactionMode` toggle; `interactionMode` is derived and still fed to Canvas (its draw/move code is unchanged). Create arrow/pen → auto-draw; all finish gestures + bbox-tighten preserved; select-away/Escape finish drawing. Added a Points section with an "Edit points"/"Done" button to `PropertiesPanel` (`isDrawing`/`onToggleDraw`). Removed the header Move/Draw toggle and deleted the now-dead `AnnotationTools.tsx`. `tsc -b` green. **M done.** Only **P** (floating context toolbar + inspector redesign) remains.

- Files modified: `src/components/App.tsx`, `src/components/PropertiesPanel.tsx`. Files deleted: `src/components/AnnotationTools.tsx`.

[2026-07-14] **P1** (floating context toolbar — anchoring): new `ContextToolbar` component (minimal bar: edit-points · duplicate · delete) **hosted inside `Canvas.tsx`** as a non-transformed sibling in the fit-box `relative` div (same layer as the Frame/Live button). Anchoring math: axis-aligned bounds of the object's 4 (rotated) corners in project px → client px via `overlayCanvasRef.getBoundingClientRect()` (already reflects the viewport transform) → fit-box-local px. Centered with `translateX(-50%)`; lifted with `translateY(-100%)` when placed **above**; **flips below** when the box top is within `barH+margin` of the frame top; **clamps** horizontally within the fit box. Size measured from a `toolbarRef` in a `useLayoutEffect` (pre-paint, no flash; `visibility:hidden` until measured). Recompute keyed on pose primitives (not object identity, to avoid a self-trigger loop) + `viewport` scale/pan + `width`/`height` + a `ResizeObserver`-driven `layoutTick` (panel/timeline/window resize). **Hidden** while nothing visual is selected, audio-selected (P4 → inspector), `isPlaying`, Live view, `dragState != null`, or `interactionMode === 'draw'`. Wired `onToggleDraw={handleToggleDrawSelected}` into Canvas so "Edit points" routes to the existing per-object draw toggle (inspector Points button + finish gestures still exit draw in P1). `tsc -b` green (also validates `IconCopy`/`IconTrash`/`IconVector`). **P1 done — awaiting user checkpoint.**

- Files added: `src/components/ContextToolbar.tsx`. Files modified: `src/components/Canvas.tsx` (imports + `onToggleDraw` prop + placement state/effect + toolbar host in the fit box), `src/components/App.tsx` (pass `onToggleDraw` to Canvas).
- Follow-up (same day): the bar was covering the **rotation handle** (juts ~30px above top-center). Fixed by anchoring against the whole selection-overlay bounds — the 4 rotated corners **plus the rotation-handle tip** (`ccx, by − ROTATION_HANDLE_DISTANCE − 8`, rotates with the object) — padded by `HANDLE_SIZE/2` for the resize squares, so the toolbar clears all chrome. **User-verified ✓.**

[2026-07-16] **P2** (per-type toolbar controls + popovers). Two parts:
- **P2a — shared components + Popover.** Extracted the inspector's reusable UI into **`src/components/propertyControls.tsx`** (`Section`, `Field`, `NumberInput`, `TransitionSection`, `TypeOnBar`, `LifespanBar`, `KeyframeTrack`, `ZoomKeyframeTrack`, `KeyframeStatus`, + `EASINGS`/`EASING_LABELS`/`SELECT_CLS`) — verbatim, so the inspector is byte-for-byte the same (parity). `PropertiesPanel.tsx` now imports them (dropped its local copies + now-unused imports; truncated at end of `ZoomEditor`). New **`src/components/Popover.tsx`** primitive: mirrors `AspectRatioSelector`'s open/outside-click/Escape, but **portals its panel to `document.body`** with viewport-clamped `fixed` coords (flip above when no room below) so popovers are never clipped by the render area's `overflow-hidden`. Escape `stopPropagation`s so it closes only the popover (App's window-level Escape would otherwise deselect — document bubble fires before window).
- **P2b — per-type `ContextToolbar`.** Inline high-frequency controls + portalled popovers reusing the shared components. **text:** colour swatch · Bold · Italic · Alignment popover · Font popover (family/auto-size/size/background). **arrow:** colour · moving-head toggle · Style popover (line width + curvature) · Edit points. **freehand:** colour · Style popover (line width) · Edit points. **photo:** Opacity popover. **video:** Opacity + Volume/mute popovers. **All visual:** Animate popover (On Appear/On Exit via `TransitionSection`) · Duplicate · Delete. Opacity is keyframe-aware (transient→commit, same path as the inspector). Keyframes/timing/position deliberately stay in the inspector (OQ-8 split). Canvas now passes `globalTime` to the toolbar. `tsc -b` green; `vite build` clean; grepped `dist/*.css` to confirm `z-80`/`bg-accent-soft`/`bg-danger-soft`/`surface-hover`/`border-border-strong` all compiled. **P2 done — awaiting user checkpoint.**

- Files added: `src/components/propertyControls.tsx`, `src/components/Popover.tsx`. Files modified: `src/components/ContextToolbar.tsx` (full per-type build-out), `src/components/PropertiesPanel.tsx` (import shared components; remove local copies), `src/components/Canvas.tsx` (pass `globalTime` to toolbar).
- Note for P3: the inspector still shows the SAME transitions in its On Appear/On Exit sections as the toolbar's Animate popover (shared `TransitionSection`, same data → they stay in sync). P3 will restyle the inspector sections (iconed headers/accordions) without changing behaviour.

[2026-07-16] Three small UX fixes requested during P2 checkpoint (minor deviations from the spec's "no renderer/model changes" — user-approved, orthogonal to the redesign):
1. **Text background fills the whole object box.** `drawText` ([annotations.ts](../src/lib/annotations.ts)) was drawing a snug rect hugging the glyphs; now it fills the object's full bbox (`bx,by,bw,bh`) so it reads as a solid panel behind the text regardless of length/alignment. (Removed the now-dead `minStart/maxEnd` measuring.)
2. **Text `animateIn` (Reveal) defaults to 0.** `createTimelineObject` ([types.ts:290](../src/types.ts#L290)) — added `text` to the instant-default list (was `1s` type-on, which read as confusing). Photo/audio/video already defaulted to 0; arrow/pen keep their draw-on reveal.
3. **Freehand drawing gets a cursor hint.** `Canvas.tsx` `tooltipText` now returns `'Drag to draw · press Esc to finish'` for freehand in draw mode (previously arrow-only), so "how do I stop?" is answered near the cursor, not just on the panel. Also added "· Esc to finish" to the arrow hints (Esc tightens the bbox via the select-away effect, verified).

- Files modified: `src/lib/annotations.ts`, `src/types.ts`, `src/components/Canvas.tsx`. `tsc -b` green.

[2026-07-16] Two more text tweaks from the same checkpoint:
4. **New text defaults to white.** `handleCreateObject` ([App.tsx](../src/components/App.tsx)) passes `style.color: '#FFFFFF'` for `type === 'text'` (last-used colour still wins via the spread). Annotations keep the factory red.
5. **Text background control moved inline.** In `ContextToolbar` `TextControls`, the background is now an inline highlight-toggle (`IconHighlight`) + colour swatch immediately after the text-colour swatch (with a divider), instead of being buried in the Font popover. Removed the Background field from the Font popover. The inspector's own Background field is unchanged (depth surface / parity).

- Files modified: `src/components/App.tsx`, `src/components/ContextToolbar.tsx`. `tsc -b` green.

[2026-07-16] **P3** (inspector redesign — section-distinct). Replaced the flat `Section` (small uppercase label) with an inspector-only **`Accordion`**: a bordered, subtly-tinted card (`bg-surface-muted/40`) with an **iconed header** (title→icon map: Timing=clock, Position=arrows-move, Points=vector, On Appear=login, On Exit=logout, Keyframes=diamond, Audio=volume, Style=palette, Text=typography, Arrow=arrow-up-right, Focus=focus-centered), a bold title, and a **chevron toggle** (collapsible; default open — nothing hidden). Applied to all 12 object-inspector sections + the 3 `ZoomEditor` sections via two `replace_all`s (`<Section title`→`<Accordion title`, `</Section>`→`</Accordion>`). Decoupled `TransitionSection` into **`TransitionFields`** (content-only, exported) + a thin `Section`-wrapping `TransitionSection` — so the inspector wraps the fields in an `Accordion` while the toolbar's Animate popover keeps its plain compact `Section`. Behaviour is unchanged (parity): every field, the keyframe track/pips/active-color ring + banner, the type-on Reveal bar, and all zoom controls are identical — only the section chrome changed. `tsc -b` green; `vite build` clean (CSS 34.60→34.93 kB, the new accordion utilities). **P (all of P1–P3) done — awaiting user checkpoint, then the final parity pass.**

- Files modified: `src/components/PropertiesPanel.tsx` (Accordion + icon map; Section→Accordion; TransitionFields), `src/components/propertyControls.tsx` (split `TransitionFields` out of `TransitionSection`).

[2026-07-16] Fix (from P checkpoint): **Esc while drawing now keeps the object selected.** The keydown `Escape` branch previously always cleared selection; now when `interactionMode === 'draw'` it calls `handleFinishArrow()` (tighten bbox + clear `drawingObjectId`, selection retained) so finishing a drawing with Esc leaves it selected + the context toolbar anchored — matching right-click/Enter/Done. Esc when not drawing still deselects. `tsc -b` green. Files modified: `src/components/App.tsx`.
- P1 notes for P2: while `interactionMode === 'draw'` the toolbar hides, so its "Edit points" button is enter-only in P1 (exit via the inspector's "Done editing points" or a finish gesture). P2 should keep the bar visible during point-editing with a "Done" state and fold the Points control fully onto the bar. Popovers will need a portal if they exceed the render area's `overflow-hidden` (fit box itself doesn't clip).

[2026-07-16] **Task complete — user signed off.** Full spec-17 UI redesign shipped: semantic light/dark token theme + accent presets (T), Tabler icons (I), slim header + floating transport pill (H+C), left creation/asset rail (L), auto per-object draw model (M), floating context toolbar + portalled popovers + section-distinct accordion inspector (P1–P3), and a floating toolbar for camera zooms (P5). Plus interim user tweaks (text bg fills the box, white/instant text defaults, freehand cursor hint, inline text-bg control, Esc-keeps-selection). Parity verified against the spec inventory; `tsc -b --force` + `vite build` green throughout. Deliberate deviations (all documented + approved): `M`/`D` shortcuts retired with the global mode; text rendering intentionally changed by the two requested tweaks. Status → Complete; file renamed with ✅ prefix.

## New files (this task)
`src/hooks/useUiPrefs.ts`, `src/components/AppearanceControls.tsx`, `src/components/TransportBar.tsx`, `src/components/LeftRail.tsx`, `src/components/ContextToolbar.tsx` (object + zoom toolbars), `src/components/Popover.tsx`, `src/components/propertyControls.tsx` (shared inspector/​popover controls). Deleted: `src/components/AnnotationTools.tsx`.

## Post-completion tweak (2026-07-16)
Accent is now a **fixed brand red `#e74c3c`** (was a Blue/Teal/Violet/Rose preset picker). `--accent-hover` derives darker via `color-mix(in srgb, var(--accent) 85%, #000)` and `--accent-soft` stays the 14% tint, so all accent shades come off the one red. **Removed the accent picker** — `AppearanceControls` is now just the light/dark toggle; `useUiPrefs` persists only `theme` (drops `accent`/`AccentId`/`ACCENTS`/`setAccent` and clears any legacy `data-accent`); the `[data-accent]` preset rules are gone from `index.css`. `tsc -b` + `vite build` green; grepped `dist/*.css` to confirm `e74c3c` compiled and no `data-accent` rules remain. Files: `src/index.css`, `src/hooks/useUiPrefs.ts`, `src/components/AppearanceControls.tsx`, `src/components/App.tsx`.
