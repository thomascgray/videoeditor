# 12-keyframe-easing-engine

**Status**: In Progress

## Overview

Implement the keyframe/easing engine per `SPECS/12-keyframe-easing-engine.md`: interpolate an object's `x/y/width/height/rotation/opacity` between keyframes over time along an easing curve, evaluated inside the shared `renderFrame` (so preview and export animate identically). Editing lives entirely in the right-hand `PropertiesPanel` (pose-snapshot keyframes at the playhead; no timeline dots in v1). Foundation for spec 13 (camera) and spec 15 (audio fades).

## Task Context

- **Spec**: `SPECS/12-keyframe-easing-engine.md` (all decisions resolved; Q2 pose-snapshot authoring confirmed by user).
- **No `CLAUDE.md`** in this project.
- **Data model** (`src/types.ts`): `TimelineObject` has `x/y/width/height` (0–1), `rotation` (radians), `animateIn` (seconds), `style.opacity`. Add `EasingKind`, `AnimatableProperty`, `Keyframe`, `KeyframeTracks`, and `keyframes?: KeyframeTracks`.
- **Renderer** (`src/lib/renderer.ts:21`): `renderFrame` is the single choke-point (preview `useCanvasRenderer.ts:45` + export `exportWorker.ts`). `progress` ramp at `:42-46`; `drawObject` reads `obj.x/y/width/height/rotation` + `style.opacity`. Integrate via an `evaluatePose` helper + effective-object spread — don't change `drawObject`'s signature.
- **Undo** (`src/hooks/useProject.ts`): shallow merge `{...o, ...updates}` (`:90-96`) → dispatch the whole `keyframes` object. Transient protocol `UPDATE_OBJECT_TRANSIENT`→`COMMIT_TRANSIENT` (`:38-60`) for continuous edits. `DUPLICATE_OBJECT` (`:98-111`) shallow-spreads → must deep-clone `keyframes`.
- **Playback** (`src/hooks/usePlayback.ts`): already exposes `globalTime` + `seek(t)`. `App.tsx` renders `<PropertiesPanel object={selectedObject} dispatch={dispatch} />` (~`:353`) — thread `globalTime` + `seek` in.
- **PropertiesPanel** (`src/components/PropertiesPanel.tsx`): `<Section>`/`<Field>`/`<NumberInput>` helpers exist; all edits currently via `update()`→`UPDATE_OBJECT`. Add an **Animation** section.
- **Library**: adopt Motion (motion.dev) — pure math utilities only (easing curves + samplable spring), wrapped behind `src/lib/easing.ts`. Exclude component/`animate()` layer. Verify actual API before wiring.

## Blockers/Issues

None. (npm install threw a benign `EPERM` cleanup warning on a locked esbuild.exe — install still succeeded.)

## TODO

[X] Install `motion` and verify the real easing/spring API before coding
[X] `src/lib/easing.ts` — pure `ease(kind,u)` / `lerp` / `evaluateTrack(kfs,t)` (unit-verified: 34 assertions pass)
[X] `src/types.ts` — `EasingKind`, `AnimatableProperty`, `Keyframe`, `KeyframeTracks`, `keyframes?` on `TimelineObject`
[X] `src/lib/renderer.ts` — `applyPose` + effective-object spread in `renderFrame` (composes with `animateIn` reveal)
[X] `src/hooks/useProject.ts` — deep-clone `keyframes` (+ `data`) in `DUPLICATE_OBJECT` (R10)
[X] `src/App.tsx` — pass `globalTime` + `seek` into `PropertiesPanel`
[X] `src/components/PropertiesPanel.tsx` — Animation section: +Keyframe, keyframe list (time/easing/delete), prev/next nav, live-value keyframing, templates
[X] Templates (slide/pop/fade with In/Out toggle + slide direction)
[X] Validate: `npx tsc -b` clean; `vite build` clean (motion +~11kB); easing unit tests pass
[X] Verify in-app (puppeteer + real Chrome, canvas centroid): A→B tween confirmed, easing curve confirmed (matches easeInOutCubic, not linear)
[X] No-regression check: static object centroid byte-identical across scrub (Δ=0.0000)
[ ] Export parity: not driven end-to-end (structurally guaranteed — export uses the same `renderFrame`/`applyPose`). Confirm on a real export when convenient.

### Design decisions (from user review)
- **Objects default to 0 keyframes (opt-in animation), NOT 1 initial keyframe.** Rationale: if every object always had a keyframe, every value edit — including canvas drag — would become a keyframe edit, so repositioning an object while the playhead is at t>0 would silently create motion. Opt-in (click + Keyframe to start) mirrors pro-tool "stopwatch" gating, keeps un-animated objects clean, and preserves R11 (byte-identical without keyframes).
- **Keyframe UI = per-keyframe pips** (not prev/◀◆▶/next nav): a row of little buttons, one per keyframe, click to jump; active one (playhead parked on it) highlighted. Ease dropdown + delete are contextual to the active keyframe.

### Redesign (from user review — 2026-07-08): On Appear / On Exit ≠ Keyframes
The preset-buttons-write-keyframes model was confusing and buggy (fade pinned all props → canvas drag detached box from text; presets clobbered existing keyframes). Reworked into two separate concepts:
- **On Appear / On Exit**: menu-driven entrance/exit animations (fade/slide/pop + duration), first-class `enter?`/`exit?` fields on the object. Do NOT create keyframes. Applied as a transform in `renderFrame` on top of the keyframe pose.
- **Keyframes**: the separate advanced per-property custom-motion tool (pips UI). Presets removed from it.
- **Canvas drag is now keyframe-aware** and operates on the resolved pose: overlay/hit-test/drag use `resolvePose` (box follows keyframed motion), and drag dispatches via `editPose` (cements a keyframe for keyframed props, edits static base otherwise). Fixes the box/text detachment.
- **Keyframe markers on timeline bars** (yellow diamonds) + subtle enter/exit ramp gradients.

### Keyframe model change (2026-07-08, user directive): whole-pose waypoints, button-only
User: "it's making keyframes automatically sometimes — only create keyframes when I press the button." And each keyframe should have: duration (time to animate into it, 0 = teleport), style, easing. Chose **"Full snapshot, everything morphs"** for style → keyframes are whole-pose snapshots; easing IS the "how" (no separate style axis).
- **Data model** (`src/types.ts`): `KeyframePose = Record<AnimatableProperty, number>`; `Keyframe = { time, pose, easing }`; `keyframes?: Keyframe[]` (was per-property `KeyframeTracks`). Removed `KeyframeTracks`; removed `evaluateTrack` from `easing.ts`.
- **No auto-creation**: `editPose` now updates the keyframe under the playhead (or the base pose) but NEVER creates a keyframe. Only the `+ Keyframe` button (`addKeyframeAt`) creates them.
- **Rendering** (`poseAt`): base pose @0 → keyframe poses; morphs between with the arriving keyframe's easing; holds before first / after last.
- **Panel**: Keyframes section = pips (◆1/◆2…, click to jump), and per-keyframe **Animate over (s)** (duration = gap from previous; editing shifts it + later keyframes) + **Motion** dropdown with descriptive easing labels ("Even pace throughout", "Eases to a stop (gentle)", "Bouncy — springs into place", etc.) + Delete.
- Verified end-to-end (12 checks): dragging/editing create NO keyframes; button creates them; on-keyframe drag updates (box follows text); interpolates correctly (cx 0.70→0.55→0.40); descriptive labels; timeline diamond per keyframe.

### Known limitations / follow-ups (v1)
[ ] When keyframed and NOT parked on a keyframe, editing/dragging edits the base (start) pose; if a keyframe sits at t=0 the base is shadowed so off-keyframe edits appear to do nothing. Intended workflow: drop a keyframe (button) → it's selected → drag/edit to shape it. Consider "drag off-keyframe moves the whole path" later.
[ ] Only the opacity sliders use transient/commit for one-undo-per-drag; x/y/w/h/rotation `NumberInput`s commit per keystroke (discrete — acceptable). Canvas drag already uses transient/commit.
[ ] Enter/exit intentionally do NOT move the selection box (box stays at home during the entrance) so the object is grabbable; the rendered object animates. Revisit if WYSIWYG box-follows-transition is wanted.
[ ] Transition easing uses per-kind defaults (no UI to change it yet).

## Work Log

[2026-07-08] Implemented the keyframe/easing engine (spec 12).
- Added `motion@12.42.2` dependency (pure easing/spring utilities only; +~11kB gzip in main chunk).
- New `src/lib/easing.ts`: `lerp`, `clamp01`, `ease(kind,u)` (polynomial eases direct; `easeOutBack` + duration-based samplable `spring` from Motion), `evaluateTrack(kfs,t)` (bracket-and-sample, holds at ends). Verified headlessly — 34 assertions (endpoints, hold, bracketing, easing-on-outgoing-segment, back/spring overshoot).
- `src/types.ts`: `EasingKind`, `AnimatableProperty`, `Keyframe`, `KeyframeTracks`; `keyframes?` on `TimelineObject`.
- `src/lib/renderer.ts`: `applyPose(obj, elapsed)` resolves interpolated x/y/w/h/rotation + style.opacity; returns obj unchanged when no keyframes (R11). Wired into `renderFrame` loop before `drawObject` — applies to preview + export via the shared choke-point. Composes with `animateIn` reveal.
- `src/hooks/useProject.ts`: `DUPLICATE_OBJECT` now `structuredClone`s `data` + `keyframes` (R10 aliasing fix).
- `src/components/App.tsx`: passes `globalTime` + `onSeek` to `PropertiesPanel`.
- `src/components/PropertiesPanel.tsx`: new **Animation** section (prev/◆/next nav, `+ Keyframe`, per-keyframe time/easing/delete rows, In/Out preset toggle + Fade/Pop/Slide+direction). Position/rotation/opacity inputs now show the interpolated pose and cement pose-snapshot keyframes at the playhead when the object is keyframed (static edit otherwise). Opacity sliders use transient→commit.
- Files modified: `package.json`, `src/types.ts`, `src/lib/easing.ts` (new), `src/lib/renderer.ts`, `src/hooks/useProject.ts`, `src/components/App.tsx`, `src/components/PropertiesPanel.tsx`.

[2026-07-08] Verified end-to-end in a real browser (puppeteer-core + installed Chrome, headless).
- Drove the live app: created a text object (Animation section renders correctly — nav/◆, + Keyframe, keyframe rows w/ easing dropdowns, In/Out presets), authored 2 position keyframes (x 0.3→0.7 at t≈0 and t≈2), and read the render canvas's red-pixel centroid at multiple playhead times.
- Results: no-keyframe object centroid byte-identical across scrub (Δcx=0.0000 → R11 holds); keyframed centroid marched 0.500→0.700→0.900 (exactly the 0.4 x-shift); off-midpoint samples matched easeInOutCubic (t=0.5→cx 0.5254 vs linear 0.6004; t=1.5→0.8754 vs 0.8004) — the easing curve is genuinely applied through the shared `renderFrame`, so export inherits it.
- Added `.claude/skills/verify/SKILL.md` capturing the browser-driving recipe (dev server + puppeteer-core + canvas-centroid observation + ruler-seek math) for future verifications.
- Also added `puppeteer-core` as a devDependency (verification tooling).

[2026-07-08] UI revision from user review: replaced the confusing ◀◆▶ keyframe nav with **per-keyframe pip buttons** (click a pip to jump; active pip highlighted indigo) + a contextual Ease/delete editor for the keyframe under the playhead. Confirmed the layout renders via screenshot (pips 0.0s/2.0s/3.5s with 2.0s active). `tsc -b` clean.
- Files modified: `src/components/PropertiesPanel.tsx`.

[2026-07-08] Major redesign after user hit real bugs (presets clobbered keyframes; keyframed objects couldn't be dragged — box detached from text). Separated **On Appear/On Exit** transitions from **Keyframes**:
- `src/types.ts`: `Transition` type (`kind` fade/slide/pop, `duration`, `direction`, `easing`), `enter?`/`exit?` on `TimelineObject`.
- `src/lib/keyframes.ts` (new shared module): `resolvePose` (base+keyframes), `applyTransitions`/`resolveRenderPose` (enter/exit), `editPose` (per-property keyframe-aware edits), `snapshotAll`, `effVal`, `keyframeTimes`, etc. Renderer + Canvas + Panel now all import this (single source of truth).
- `src/lib/renderer.ts`: uses `resolveRenderPose` (keyframes + enter/exit) — removed local `applyPose`.
- `src/components/PropertiesPanel.tsx`: new **On Appear** / **On Exit** `TransitionSection`s; **Keyframes** section (presets removed); per-property keyframe-aware editing via `editPose`; "Animate in" relabelled "Type-on".
- `src/components/Canvas.tsx`: `selectedObject` resolved to its keyframe pose (overlay/hit-test/drag follow it); both drag dispatch paths (canvas + window) now use `editPose` → keyframe-aware, box follows text.
- `src/components/Timeline.tsx`: keyframe diamond markers + enter/exit ramp gradients on object bars.
- Verified end-to-end (puppeteer + Chrome, 12 checks pass): Fade entrance fades in and creates NO keyframes; Slide slides in from left; plain drag moves objects; **keyframed drag keeps selection box ON the text (centroids match 0.550≈0.549 / 0.648≈0.647)**; timeline shows diamond + ramp. `tsc -b` clean.
- Files modified: `src/types.ts`, `src/lib/keyframes.ts` (new), `src/lib/renderer.ts`, `src/components/PropertiesPanel.tsx`, `src/components/Canvas.tsx`, `src/components/Timeline.tsx`.
