# 17-ui-redesign

> **Status: READY FOR IMPLEMENTATION** — first pass 2026-07-13; all open questions resolved same day. This is a broad, cross-cutting **UI/UX redesign**: new visual language (light/grey + configurable accent), a left asset/creation rail, a **floating context toolbar** over the selected object, floating transport controls above the scrub bar, a Tabler icon system, and a rethink of the Move/Draw interaction. **Functionality parity is a hard requirement** — every capability that exists today must still exist afterward. **The data model, reducer, renderer, camera, and export path do NOT change** (this is presentation + interaction only); the one addition is a persisted **UI-prefs** blob (theme/accent) in localStorage, kept out of the project JSON and undo.
>
> **Scope: one spec/one task, built in phases** (T → I → H+C → L → M → P), each landing behind a green `tsc -b` + a manual checklist. All workstreams are in v1.
>
> **Confirmed decisions (2026-07-13):**
> - **Properties = Hybrid** (OQ-1): a floating context toolbar over the object for quick/common controls **plus** a redesigned, section-distinct **inspector panel** that holds the full property set. Audio (no canvas bbox) and all deep editors live in the inspector.
> - **Theme = light default + dark option** (OQ-2), both from one token set + a toggle; **accent = preset picker** (2–4 curated swatches); theme + accent persisted to a `UiPrefs` localStorage blob (separate from `persistProject`).
> - **Left rail = relocate + basic library** (OQ-3): move creation tools + add-media into the rail, and show imported `project.assets` as thumbnails that can be re-added without re-importing.
> - **Move/Draw = auto / per-object edit** (OQ-4): no global mode; create arrow/pen → draw immediately → auto-return to select; re-edit points via an "Edit points" affordance on that object's context toolbar.
> - **Scope = one task, all workstreams, phased order** (OQ-5): ship T→I→H+C→L→M→P, not a big-bang.
> - **Rectangle/circle stay disabled** (OQ-7): out of scope; revisit later.

## Overview

The editor works but looks and feels like a developer tool: a dark cool-grey/indigo palette, text-only buttons, a dense single-column right "Properties" panel, a global Move/Draw mode toggle that only matters for two object types, and transport controls crammed into the top bar. This spec re-skins and re-lays-out the app around a lighter, calmer, more modern design language and a **direct-manipulation** interaction model (properties float next to the thing you selected, like Canva/Figma), **without changing what the editor can do**.

The user's brief (verbatim intent):
1. Keep **all existing functionality** (adding assets, playback, modifying items, animation, camera zooms, export…).
2. **Light/white + grey** theme; drop the dark blue. Primarily greyscale + **1–2 accent colours**, ideally **configurable**.
3. **Add-assets** moves to a **left column/sidebar** (room to grow — more creation surfaces later).
4. **Rethink Move/Draw** — the current mode toggle is awkward.
5. **Redesign the Properties sidebar** — good bones, weak visuals; make sections (Audio, Animations, …) **distinct**.
6. **Sidebars floating**, maybe.
7. A **floating properties bar above/below the selected object** in the render window (flips side near the top edge) — "a more thorough right-click menu, but floating".
8. Set up **Tabler icons** (https://tabler.io/icons) — the app has almost none today.
9. **Play/pause/timer/speed** become a **floating menu above the main scrub bar**.

Reference: Canva's editor (left creation rail, floating context toolbar above the selection, bottom-centre transport) — liked, but "a bit busy". We take its *structure*, not its density.

## Current UI — grounded inventory (what must survive)

### Layout map (`App.tsx`)

Root `div.h-screen.flex.flex-col.bg-gray-950.text-white` ([App.tsx:372](src/components/App.tsx#L372)):

1. **Top bar** `header.h-12.bg-gray-900.border-b.border-gray-700` ([App.tsx:374](src/components/App.tsx#L374)):
   - **Left:** project-name text input ([:376](src/components/App.tsx#L376)); **Save** (`.brep` export) ([:382](src/components/App.tsx#L382)); **Load** ([:389](src/components/App.tsx#L389)); `AspectRatioSelector` ([:408](src/components/App.tsx#L408)).
   - **Right:** `AnnotationTools` (Move/Draw + Assets/Annotations/Animations clusters) ([:411](src/components/App.tsx#L411)); **Undo/Redo** ([:420](src/components/App.tsx#L420)); **Play/Pause** ([:437](src/components/App.tsx#L437)); **Speed** slider 0.25–2× ([:443](src/components/App.tsx#L443)); `VolumeControl` ([:459](src/components/App.tsx#L459)); **time readout** `t / total` ([:465](src/components/App.tsx#L465)); **Export** (opens modal) ([:468](src/components/App.tsx#L468)).
2. **Main content** `div.flex-1.flex.min-h-0` ([App.tsx:478](src/components/App.tsx#L478)): `<Canvas>` (`flex-1`) + `<PropertiesPanel>` (`w-64`, right).
3. **Timeline** — resizable via a splitter + collapsible (spec 16 B, done): splitter ([:520](src/components/App.tsx#L520)), `<Timeline>` in a height-bounded box ([:525](src/components/App.tsx#L525)); collapsed slim bar ([:507](src/components/App.tsx#L507)).
4. **Modals:** `ImportModal` ([:544](src/components/App.tsx#L544)) and `ExportModal` ([:552](src/components/App.tsx#L552)).

### Functionality inventory — the parity checklist

Everything below exists today and **must still be reachable** after the redesign (this is the non-regression contract):

- **Project:** rename; Save/Load `.brep`; aspect-ratio / custom dimensions (`AspectRatioSelector`); undo/redo (Ctrl+Z / Ctrl+Y, stack of 50).
- **Create:** add media (image/audio/video via `ImportModal`: drag-drop, browse, paste-image, size warnings, per-file preview/duration); `+ Arrow`, `+ Text`, `+ Pen` (freehand); `+ Zoom` (camera). (`rectangle`/`circle` exist in the model but their create buttons are commented out — [AnnotationTools.tsx:15-16](src/components/AnnotationTools.tsx#L15).)
- **Canvas edit (Frame view):** select; move; resize (8 handles); rotate; draw/extend arrows (click points, curvature, moving head, right-click/Enter/double-click/max-points to finish); freehand strokes; camera framing-rect move/resize; **viewport zoom/pan** (wheel-to-cursor, middle-drag pan, `− % + Fit` cluster — spec 16 C/D); Frame/Live toggle (`V`).
- **Properties (per-type):** name; **Timing** (start, duration, lane, type-on "Reveal" bar); media **Speed** + **In/Out trim**; **Position** (x/y/w/h, rotation, ignore-zoom pin); **On Appear/On Exit** transitions (kind, direction, motion easing, duration + lifespan bar); **Keyframes** (track, status, pips, +Keyframe, per-keyframe motion, delete); **Audio** (mute, volume); **Style** (color, opacity, line width, font size); **Text** (content, font, auto-size, align, bold, italic, background); **Arrow** (moving head, curvature); **Photo/Video** opacity; **Duplicate**, **Delete**.
- **Camera zoom (`ZoomEditor`):** focus x/y, zoom×, timing envelope (start / ease-in / hold / ease-out / motion), jump-to-start, keyframe pan/scale path, delete.
- **Timeline:** scrub (ruler click + playhead drag); per-clip select/move (with lane change); resize (non-media) / trim (media, with ghosts); **Slice** at playhead (`S`); **Hide** toggle (`H`, eye icon); keyframe diamonds (drag to retime); add/remove lanes; **Camera track** (zoom bars: move, resize hold, keyframe diamonds); time-zoom (Ctrl+wheel); vertical lane scroll; collapse.
- **Transport:** play/pause (Space); preview speed; master volume + mute; time readout.
- **Export:** `ExportModal` (WebCodecs→MP4, MediaRecorder fallback).
- **Keyboard:** Space, `V`, `M`, `D`, `H`, `S`, Enter (finish arrow), Esc (deselect / move mode), Delete/Backspace, Ctrl+Z/Y.

### Colour / theme audit

There is **no theme layer**. `index.css` is just `@import "tailwindcss";` + `body{margin:0}` ([index.css](src/index.css)). Colours are **hardcoded Tailwind utility classes**, repeated inline across the app:

- **~156** `gray-*` / `indigo-*` background/border/text usages across **9 component files**; **56** `indigo`/`slate`/`dark:`-ish hits across 10 files. **Zero** `@theme` blocks, `dark:` variants, `prefers-color-scheme`, or CSS custom properties.
- Surfaces: `gray-950` (root/canvas bg), `gray-900` (header/panels/timeline), `gray-800` (buttons/inputs), `gray-700` (borders), `gray-600..300` (text/dividers). Tailwind `gray` is cool-tinted → reads "dark blue-grey".
- Accent: **`indigo-600/500`** (Export, active mode, focus rings) + `accent-indigo-500` (form controls) + selection box `#4f8ef7`. This indigo/blue is the "dark blue" to remove.
- Semantic/functional colours that should **stay meaningful** (not just re-skinned): **camera amber** `#f59e0b` (Live/framing/Camera track); **playhead red** `#ef4444`; per-type timeline `TYPE_COLORS` ([Timeline.tsx:40](src/components/Timeline.tsx#L40)); **keyframe palette** `KEYFRAME_COLORS` (red, blue, green, amber, purple, pink, teal, orange — [keyframes.ts:33](src/lib/keyframes.ts#L33)), reused across panel pips, canvas selection tint, and timeline diamonds.

> **Implication:** a light theme is a **cross-cutting refactor of every component**. Doing it as raw find-replace is fragile; the clean path is a **semantic design-token layer** (CSS variables) + a few shared UI primitives, then migrate components onto tokens. See Technical Considerations.

### Icon audit

Almost no icons. Hand-rolled inline SVGs only: `SpeakerIcon` ([VolumeControl.tsx:8](src/components/VolumeControl.tsx#L8)), `EyeIcon` ([Timeline.tsx:72](src/components/Timeline.tsx#L72)), and small glyphs/carets in `AspectRatioSelector`. Everything else is **text buttons** ("Move", "Draw", "+ Arrow", "Save", "Export", `▾`, `⛶`, `◆`, `×`). A compact floating toolbar (idea #7) is basically impossible without an icon set — this is why #8 (Tabler) is a dependency of #7.

## Proposed design (for discussion)

A calm, light, **direct-manipulation** editor. Structure borrowed from Canva/Figma; density dialed down.

```
┌───────────────────────────────────────────────────────────────────────┐
│  Top bar (slim):  Logo · Project name · Aspect · │ · Undo Redo · Export │
├──────┬────────────────────────────────────────────────────┬────────────┤
│ Left │                                                     │ (optional  │
│ rail │        ┌───────────────────────────────┐            │  Inspector │
│ ─ Me │        │  ⌂ floating context toolbar   │            │  panel —   │
│   di │        │  [Aa] [◧] [▤] [★Animate▾] [⋯] │            │  see OQ-1) │
│ ─ Te │        └───────────────────────────────┘            │            │
│   xt │            ╔═══════════════════════════╗            │            │
│ ─ El │            ║   selected object          ║            │            │
│   em │            ║   (render canvas)          ║            │            │
│ ─ Zo │            ╚═══════════════════════════╝            │            │
│   om │                                                     │            │
│      │                 ◀ ❚❚ ▶   0:03 / 0:12   1×  🔊       │  ← floating│
│      │                (floating transport pill)            │  transport │
├──────┴────────────────────────────────────────────────────┴────────────┤
│  Timeline (ruler · Camera track · lanes · scrub) — unchanged behaviour   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Design language**
- **Light-first neutral palette** (near-white app chrome, white surfaces, soft grey borders, dark-grey text) driven by **semantic tokens** (`--surface`, `--surface-elevated`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-contrast`, …). One **configurable accent** (default a calm blue/indigo or teal) + reuse of the existing **amber** as the fixed "camera" semantic. (Dark mode: keep as an option via the same tokens — see OQ-2.)
- **Floating panels:** rounded cards with a soft shadow and a small gap from the window edges, over one continuous canvas backdrop.
- **Tabler icons** throughout; icon-only where a tooltip suffices, icon+label where discoverability matters.
- **Shared primitives** so styling lives in one place: `Button`/`IconButton`, `Panel`/`FloatingPanel`, `Section` (accordion-capable), `Field`, `Popover`, `Segmented`, `Slider`, `Swatch`.

**Workstreams** (each independently shippable; see Implementation Notes for order):
- **T — Theme & tokens:** CSS-variable design system, light theme, configurable accent, primitives, migrate components off hardcoded greys/indigo.
- **I — Icons:** add Tabler, replace text/adhoc glyphs with icons.
- **L — Left rail:** persistent creation/asset sidebar; subsumes `AnnotationTools` create clusters + the add-media flow (`ImportModal`).
- **P — Properties:** the **floating context toolbar** over the selection (with grouped popovers) + a redesigned, section-distinct inspector (relationship = **OQ-1**).
- **C — Transport float:** move play/pause/time/speed/volume out of the top bar into a floating pill above the scrub bar.
- **M — Move/Draw rework:** remove the global mode toggle; per-object draw/edit affordance.
- **H — Header slim-down:** what remains up top once tools + transport leave.

## Requirements

> Grouped by workstream. Items marked *(needs decision)* depend on an Open Question.

### T — Theme & design tokens
- **T1.** Introduce a **semantic token layer** as CSS custom properties (in `index.css` via Tailwind v4 `@theme` and/or `:root`), covering surfaces, borders, text tiers, accent(+contrast), and functional colours (camera-amber, playhead-red, keyframe palette). Components reference **tokens**, never raw `gray-###`/`indigo-###`.
- **T2.** Ship a **light theme** as default: near-white chrome, white elevated surfaces, soft-grey borders, dark-grey text; WCAG-AA contrast for text and controls.
- **T3.** **Configurable accent (preset picker):** the accent is a single token the user changes from a **curated set of 2–4 presets** (swap `--accent*` vars at runtime, no rebuild). Proposed presets: **Blue** (default), **Teal**, **Violet**, **Rose** — each pre-validated for AA contrast in both themes.
- **T4.** Preserve **semantic colour meaning**: camera = amber, playhead = red, per-type + keyframe palettes stay recognizable (re-tuned for light bg if needed, but not repurposed).
- **T5.** Extract **shared UI primitives** and route existing controls through them, so the palette/spacing/rounding live in one place.
- **T6.** Full **parity of every control's states** (hover/active/focus/disabled) and **keyboard focus visibility** in the new theme.
- **T7.** **Dark theme** retained behind the same tokens, selectable via a toggle. **Light is the default.** Theme + accent persist to a `UiPrefs` localStorage blob (separate from `persistProject`; not in the project JSON or undo).

### I — Icons (Tabler)
- **I1.** Add Tabler icons (`@tabler/icons-react`), imported **per-icon** (tree-shaken) — no CDN/global stylesheet.
- **I2.** Replace text-only buttons and ad-hoc glyphs (`▾ ⛶ ◆ × [ ]`, `SpeakerIcon`, `EyeIcon`, carets) with Tabler equivalents; keep **accessible labels/titles**.
- **I3.** Establish icon sizing/stroke conventions as tokens so icons read consistently at toolbar / panel / timeline scales.

### L — Left creation & asset rail
- **L1.** A **persistent left sidebar** (floating card) replacing the header's create clusters + the "+ Asset" modal-trigger, with a **vertical icon rail** of sections and a content pane. Initial sections: **Media** (add + library), **Text**, **Elements** (arrow, pen), **Zoom** (camera). (Rectangle/circle remain disabled — OQ-7.) Built to **accommodate future sections**.
- **L2.** **Media** section: add files (drag-drop, browse, paste) with the same validation/warnings as today; clicking a section item creates the corresponding object at the playhead (parity with `handleCreateObject` / `handleCreateZoom`).
- **L3.** **Basic asset library:** the Media section shows previously-imported assets (`project.assets`) as **reusable thumbnails**; clicking (or drag-to-timeline, if cheap) **re-adds** the asset as a new `TimelineObject` referencing the existing `assetId` — **no re-import, no new blob**. Thumbnails come from `getAssetUrl(assetId)` (`assetStore`); audio uses an icon/waveform placeholder. (Scoped as *basic*: list + re-add. Search/filter is a later nicety.)
- **L4.** The rail is **collapsible** to reclaim canvas width; its state is ephemeral view-state.
- **L5.** Preserve every `ImportModal` behaviour (multi-file, image/audio/video, previews, durations, size warnings, paste) — as inline rail UI and/or a retained lightweight modal.

### P — Properties: floating context toolbar + inspector
- **P1.** A **floating context toolbar** appears near the **selected object** in the render window: **above** it by default, **below** when the object is too near the top edge; horizontally centred over the object and **clamped** within the render area. Hidden when nothing is selected.
- **P2.** The toolbar holds the **highest-frequency controls for the selected type** (e.g. text: font, size, B/I, align, colour; arrow: colour, width, curvature, edit-points; photo/video: opacity, volume/mute, replace/trim), plus universal actions (duplicate, delete, arrange/lane, "**Animate**"). Deep/grouped controls open **popovers** from the toolbar (Canva's "Animate/Position/Effects open a panel" model) so the bar stays compact.
- **P3.** **Positioning tracks reality:** recompute on selection change, pose change (keyframes/drag), **viewport zoom/pan** (spec 16 C), playhead movement, aspect change, and window resize — using the same `getBoundingClientRect`-relative mapping hit-testing uses, so it stays glued to the object at any zoom. **The toolbar hides during an active object drag and during playback, and re-anchors on release / pause** (avoids jitter and occluding the drag — OQ-6 resolved).
- **P4.** **Non-canvas objects (audio)** have no bbox in the render window → **audio's properties live in the inspector panel** (the hybrid's full surface), not a canvas-anchored toolbar. (Selecting an audio clip opens the inspector focused on its Audio/Timing sections.)
- **P5.** **Camera zoom** selection shows a matching floating toolbar/popover set (focus, zoom×, timing, keyframes) consistent with `ZoomEditor`, anchored to the framing rect.
- **P6.** **Redesigned inspector (kept — hybrid):** a persistent, **floating** side panel holds the full property set with **visually distinct sections** (Timing, Position, Animations/keyframes, Transitions, Audio, Style, Text/Arrow…) — clear headers, grouping, iconography, and collapsible accordions — resolving the "sections aren't distinct" complaint. The floating toolbar is the fast path; the inspector is the depth. The toolbar's "Animate ▾", "Timing ▾", etc. popovers may reuse the same section components so the two surfaces stay consistent.
- **P7.** **Every** property currently in `PropertiesPanel` + `ZoomEditor` remains editable (parity), including the keyframe track, transition lifespan bars, and the type-on "Reveal" bar.

### C — Floating transport
- **C1.** Move **play/pause, time readout, preview speed, volume/mute** out of the top bar into a **floating pill** centred **above the scrub bar** (over the render/timeline boundary).
- **C2.** Works with the **collapsible/resizable timeline** (spec 16 B): the pill stays visible and correctly placed whether the timeline is expanded or collapsed.
- **C3.** Keep **Space = play/pause** and all current transport semantics (speed 0.25–2×, double-click speed = 1×, mute).

### M — Move/Draw rework
- **M1.** Remove the **global `Move/Draw` mode toggle** as the primary UI. Selecting/creating objects should not require the user to think about a mode for the 6 non-drawable types.
- **M2.** **Auto / per-object model (confirmed):** creating an **arrow/freehand** drops you directly into **drawing that object**; finishing (right-click/Enter/double-click/click-away/max-points) auto-returns to normal select/move. Re-editing an existing arrow/freehand's points is an **explicit per-object affordance** — an "Edit points" button in its context toolbar (P2) — not a global mode. A session-level `drawingObjectId: string | null` replaces the global toggle; the `InteractionMode` type is retired or demoted to an internal detail (audit all consumers).
- **M3.** Preserve all drawing capability (curvature, moving head, multi-stroke freehand, bbox auto-tighten on finish — [App.tsx:94-165](src/components/App.tsx#L94)) and the `M`/`D`/Enter/Esc behaviours (remapped as needed).

### H — Header slim-down
- **H1.** After tools (→ left rail) and transport (→ floating pill) move out, the top bar keeps only project-level items: name, Save/Load, aspect, undo/redo, **Export** (primary accent button). Lay it out cleanly with icons.

### Non-regression / correctness
- **N1.** **Every** item in the Functionality inventory remains reachable and behaves identically (only presentation/placement changes).
- **N2.** **No data-model / reducer / renderer / camera / export changes.** `TimelineObject`, `Project`, `CameraZoom`, `ProjectAction`, `useProject`, `renderer.ts`, `camera.ts`, `ffmpegExport.ts` are untouched by T/I/L/P/C/M/H. **The one addition** is a persisted **`UiPrefs`** blob (theme/accent) in localStorage — *not* part of the project JSON or undo. (`InteractionMode` in `types.ts` may be retired by **M**, but that is UI-interaction state, not domain data.)
- **N3.** **Export output is byte-identical** — the redesign is chrome; it never touches `renderFrame` inputs.
- **N4.** Canvas hit-testing/overlay math stays correct at any **viewport zoom/pan** (the floating toolbar uses the same rect-relative mapping and must not break or be broken by spec-16 C).
- **N5.** `npx tsc -b` stays green; no new lint errors.
- **N6.** Keyboard shortcuts and focus behaviour preserved (or deliberately, documented-ly changed for M).

## Technical Considerations

**This is presentation + interaction only.** No persistent domain types change. New types are (a) ephemeral view-state, (b) a possible persisted UI-prefs blob, (c) prop shapes for new components.

### Types touched / added

Existing, **unchanged** (referenced): `TimelineObject`, `TimelineObjectType`, `ObjectStyle`, `Project`, `AssetMeta`, `CameraZoom`, `ProjectAction`, `InteractionMode` ([types.ts](src/types.ts)). **`InteractionMode = 'move' | 'draw'`** ([types.ts:203](src/types.ts#L203)) is the one type the **M** workstream may retire or narrow — audit every consumer (`App.tsx`, `Canvas.tsx`, `AnnotationTools.tsx`).

Proposed **new** shapes (illustrative — finalise in `/task`):

```ts
// T — theme. Persisted UiPrefs blob (localStorage), separate from Project/persistProject/undo.
type AccentId = 'blue' | 'teal' | 'violet' | 'rose'      // curated preset set (T3)
type ThemeMode = 'light' | 'dark'                         // light = default
type UiPrefs = { theme: ThemeMode; accent: AccentId }

// L — left rail (ephemeral view-state, mirrors cameraView)
type RailSection = 'media' | 'text' | 'elements' | 'zoom'
type LeftRailState = { open: boolean; section: RailSection }

// M — replaces the global InteractionMode toggle (session state; not persisted)
type DrawingState = { drawingObjectId: string | null }   // non-null ⇒ actively drawing that arrow/pen

// P — floating context toolbar anchor (derived per render; not stored)
type ScreenRect = { left: number; top: number; width: number; height: number } // render-area-local px
type ToolbarPlacement = { rect: ScreenRect; side: 'above' | 'below'; visible: boolean }
```

### Theming in Tailwind v4 (grounded)
- Project is Tailwind **v4** (`@tailwindcss/vite ^4.2.1`, `@import "tailwindcss"` — [package.json](package.json), [index.css](src/index.css)). v4 is **CSS-first**: define tokens in an **`@theme`** block and/or `:root` custom properties; Tailwind generates utilities from theme vars, and arbitrary values can read `var(--…)`.
- **Approach:** define semantic tokens as CSS vars (`--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-contrast`, `--camera`, `--playhead`, `--danger`, …). Map to utilities (e.g. `--color-surface` so `bg-surface` works) where clean, and use `var()` directly elsewhere. **Accent config** = swapping the `--accent*` vars at runtime (set on `:root` / `<html>`), no rebuild. **Dark mode** = an alternate token set under `:root[data-theme="dark"]` (or `@media (prefers-color-scheme)`), toggled by stamping `data-theme`.
- **Migration reality:** ~156 hardcoded usages across 9 files must move to tokens/primitives. Best done **primitive-first** (build `Button`, `Panel`, `Section`, `Field`, inputs), then convert screens. Mechanical but broad; keep `tsc -b` green throughout.

### Floating context toolbar — positioning math (grounded, reuses spec 13/16 property)
- The selected object's on-screen box derives from its **keyframe-resolved** normalized pose (`resolvePose(obj, globalTime)` — already computed in `Canvas.tsx:567`) times the **overlay canvas rect**. `overlayCanvas.getBoundingClientRect()` already reflects the **viewport zoom/pan** transform (spec 16 C applies `transform` to both canvases; [Canvas.tsx:1258-1261](src/components/Canvas.tsx#L1258)), so mapping normalized→client stays exact at any zoom — the **same invariant** hit-testing relies on ([spec 16 D-viewport-math](SPECS/16-ui-improvements.md)). Rotated objects → use the **axis-aligned bounds** of the four rotated corners.
- The toolbar is an **HTML element in the render-area container**, a **non-transformed sibling** of the canvases (like the Frame/Live button [Canvas.tsx:1280](src/components/Canvas.tsx#L1280) and zoom cluster [:1294](src/components/Canvas.tsx#L1294)) — so it is **not** scaled by the viewport transform and **not** clipped oddly. Position it in render-area-local px; flip above/below when the object's top is within `toolbarHeight + margin` of the top; clamp horizontally.
- **Recompute triggers:** `selectedObjectId`, `globalTime` (keyframes/playback), `viewport` (scale/pan), `width/height`, window resize, drag transient updates. Cheap (a few multiplies); keep it off the 60Hz render hot path where possible, or accept it (App already re-renders at 60Hz while playing — CLAUDE.md rough edge). **Default:** hide during active object drag and during playback; re-anchor on release/pause (avoids jitter and occluding the drag).
- **Occlusion:** ensure the toolbar/popovers sit above the overlay canvas (z-order) but **do not intercept** object-editing mouse events outside their own bounds (they're separate DOM, so this is natural). Popovers must not be clipped by the render area's `overflow-hidden` ([Canvas.tsx:1248](src/components/Canvas.tsx#L1248)) — render them in a portal or a non-clipped layer if they'd exceed the canvas.
- **Audio** objects have no canvas box (P4/OQ-1).

### Left rail vs. ImportModal
- Today creation is split: header clusters (`AnnotationTools`) create annotation/zoom objects; **"+ Asset"** opens `ImportModal` for media. The rail **unifies** these. `ImportModal`'s logic (file validation, `storeAsset`, `getMediaDuration`, `generateWaveform`, size warnings, object creation at `insertAtTime`) is reusable — either inline in the rail's Media section or by keeping a trimmed modal the rail opens. `project.assets` (`AssetMeta[]`) already records imports, enabling an **asset library** (L3/OQ-3) with minimal model work (blobs are in IndexedDB via `assetStore`).

### Transport float
- Extract play/pause/time/speed/`VolumeControl` from the header into a `TransportBar` component positioned over the render/timeline boundary. `usePlayback` + `useAudioPlayback` are already hook-owned in `App.tsx`; just relocate the JSX and pass the same props. Mind the **collapsible timeline** (spec 16 B) so the pill's anchor is stable in both states.

### Move/Draw rework
- Consumers of mode today: `interactionMode` state + `handleSetMode` ([App.tsx:167](src/components/App.tsx#L167)); auto-enter draw on create/select ([:247](src/components/App.tsx#L247), [:362](src/components/App.tsx#L362)); revert-to-move when draw invalid ([:176](src/components/App.tsx#L176)); bbox-tighten on leaving draw ([:159](src/components/App.tsx#L159)); Canvas branches on `interactionMode` heavily; `AnnotationTools` Move/Draw buttons. The rework centralises "am I drawing this object?" as a **per-object/session state** rather than a global mode, but must preserve the tighten-on-finish and all finish gestures. Likely keeps an internal drawing flag; **retiring the `InteractionMode` type is optional** and should be weighed against churn.

### Icons
- `@tabler/icons-react` (peer: React 19 — compatible). Import per-icon (`import { IconPlayerPlay } from '@tabler/icons-react'`) for tree-shaking under Vite. No global CSS. Size via `size`/`stroke` props or a wrapper primitive.

## Related Systems and Tasks
- **CLAUDE.md** — Rendering pipeline (two-canvas render+overlay; overlay is separate & non-transformed-sibling pattern), Camera (Frame/Live, `cameraView`), Playback/audio hooks, Gotchas (60Hz re-render; no DPR).
- **Spec 16** (`SPECS/16-ui-improvements.md`, done) — established the resizable/collapsible timeline (**C** must respect it), the editor **viewport zoom/pan** transform (**P** positioning must compose with it), and the `getBoundingClientRect`-relative invariant (**P** reuses it). The corner-control styling (Frame/Live + zoom cluster) is the model for floating canvas controls.
- **Spec 13** (`SPECS/13-camera-zoom.md`, done) — Frame/Live, framing rect, `ZoomEditor`; camera-amber semantic; the "overlay avoids inverse transform" property.
- **Spec 14** (`SPECS/14-video-sequencing.md`) — trim/slice/hide UI on clips that the redesign must preserve.
- **Files in play:** `App.tsx` (layout, header, mode retire, rail/transport wiring), `Canvas.tsx` (floating toolbar host + positioning; no render/hit-test math change), `PropertiesPanel.tsx` (→ toolbar + popovers + redesigned inspector), `AnnotationTools.tsx` (→ left rail; likely replaced), `ImportModal.tsx` (→ rail Media), `Timeline.tsx` (transport neighbour; token/icon reskin), `VolumeControl.tsx`/`AspectRatioSelector.tsx`/`ExportModal.tsx` (token/icon reskin), `index.css` (tokens), **new**: `LeftRail`, `ContextToolbar`, `TransportBar`, UI primitives, a `useUiPrefs`/theme hook. **No** `src/lib/*` domain files, `useProject`, or export files change.

## Open Questions

**Resolved 2026-07-13:**
- ~~**OQ-1 — Floating toolbar ↔ inspector.**~~ **RESOLVED: Hybrid** — floating toolbar (quick) + redesigned section-distinct inspector (depth). Audio + deep editors live in the inspector (P4/P6).
- ~~**OQ-2 — Theme scope & accent.**~~ **RESOLVED: light default + dark option** from one token set + toggle; **accent = preset picker** (Blue/Teal/Violet/Rose, AA-checked); theme+accent persisted to a `UiPrefs` localStorage blob, separate from `persistProject` (T2/T3/T7).
- ~~**OQ-3 — Left rail asset library.**~~ **RESOLVED: relocate + basic library** — move creation + add-media into the rail, plus a re-addable thumbnail list of `project.assets` (no re-import). Search/filter deferred (L1–L3).
- ~~**OQ-4 — Move/Draw model.**~~ **RESOLVED: auto / per-object** — no global mode; draw-on-create → auto-return to select; re-edit via per-object "Edit points" (M1–M3). `InteractionMode` retired/demoted.
- ~~**OQ-6 — Toolbar during drag/playback.**~~ **RESOLVED: hide + re-anchor** on release/pause (P3).

**Resolved 2026-07-13 (cont.):**
- ~~**OQ-5 — Phasing & v1 scope.**~~ **RESOLVED: one task, all workstreams in v1, built in the phased order** T → I → H+C → L → M → P (not big-bang), each behind green `tsc -b` + a manual checklist. Recommend a feature branch.
- ~~**OQ-7 — Re-enable rectangle/circle?**~~ **RESOLVED: no** — leave them disabled; revisit in a future spec. Elements = arrow + pen only.

**Deferred to `/task` (non-blocking):**
1. **OQ-8 — Toolbar/inspector content split.** The exact per-type split (what sits on the floating bar vs. behind popovers vs. inspector-only) will be proposed during implementation of workstream **P**. No strong constraints given; propose sensible defaults (e.g. colour/opacity one-click on the bar; keyframe track + transitions in the inspector).

## Acceptance Criteria
- The app presents a **light/grey** theme (default) with a **dark toggle** and a **preset accent picker**, driven by **semantic tokens**; theme+accent persist via `UiPrefs`; no component reads a raw `gray-###`/`indigo-###` for chrome (T1–T7). `npx tsc -b` green (N5).
- **Tabler icons** are used across toolbars/panels/timeline with accessible labels; no CDN/global-CSS icon loading (I1–I3).
- A **left rail** provides all creation + add-media capability the header/modal did, collapsible, extensible (L1–L5).
- A **floating context toolbar** anchors to the selected object (flips above/below near the top; clamped; correct at any viewport zoom/pan), exposes the type's common controls, and opens popovers for deep controls — with **every** current property still editable somewhere (P1–P7, N1).
- **Play/pause/time/speed/volume** float above the scrub bar and work with the collapsible timeline; Space still toggles play (C1–C3).
- The **Move/Draw** global toggle is gone; drawing arrows/freehand and re-editing their points works via the new model; all finish gestures + bbox-tighten preserved (M1–M3).
- **No data-model/reducer/renderer/camera/export change; export output byte-identical; all shortcuts and canvas interactions intact at any zoom** (N1–N6).

## Implementation Notes *(provisional)*
- **Build order (one task, phased — confirmed OQ-5; each phase behind green `tsc -b` + a manual checklist):** **T** (tokens + primitives + light theme) → **I** (Tabler) → **H + C** (slim header, float transport) → **L** (left rail + basic library, fold in `ImportModal`) → **M** (retire mode) → **P** (floating context toolbar + popovers + inspector redesign — do last; highest interaction risk, depends on tokens/icons/primitives). Recommend a feature branch off `master`.
- **Primitive-first** for T: land `Button`/`IconButton`/`Panel`/`Section`/`Field`/`Popover`/inputs on tokens, then migrate screens onto them to avoid 156 scattered edits twice.
- **Reuse** the spec-16 corner-control pattern for floating canvas chrome; reuse the `getBoundingClientRect`-relative mapping for the toolbar anchor (no new hit-test math); keep new view-state **ephemeral** like `cameraView` (except the optional `UiPrefs`).
- **Watch:** popover clipping vs. render-area `overflow-hidden`; toolbar occlusion of handles; toolbar recompute cost at 60Hz; audio-object properties placement; not regressing spec-14 trim/slice/hide chrome or spec-16 zoom/pan; keeping camera-amber / playhead-red / keyframe palette meaningful on a light background.
- **Verify (project policy — static checks only, then a click-through checklist):** `npx tsc -b` green; then user-side per workstream (theme contrast pass; every create path from the rail; select each object type → toolbar anchors + flips + every property reachable; transport at expanded/collapsed timeline; draw + re-edit an arrow; export diff unchanged at 200% viewport zoom).

---
*This specification is ready for implementation. Use `/task 17-ui-redesign` to begin development — build the workstreams in order (T → I → H+C → L → M → P), keeping `npx tsc -b` green at each step.*
