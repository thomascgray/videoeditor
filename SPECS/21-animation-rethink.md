# 21-animation-rethink

## Overview

Rework the **motion vocabulary** of the animation system so it is legible and expressive. Three coupled changes, all riding on the spec-12 easing engine (`ease`/`lerp`) and spec-13 camera:

1. **A distinct, curated easing picker + a new `instant` curve.** The current list conflates *shape* (in/out/in-out) with *strength* (quad vs cubic), producing nine near-duplicate options that users can't tell apart. Replace the **picker** with 7 maximally-distinct presets — with a live preview of the selected curve — and add an `instant` (no-animation / hard-cut) curve so keyframes can snap between poses.

2. **Per-keyframe "animate over" lead-in.** Today the tween into a keyframe always fills the *entire* gap from the previous waypoint. Add an optional per-keyframe lead-in: the move occupies only the last *d* seconds ending at the keyframe's time; before that it **holds** the previous pose. This is what makes "a 10-second zoom that stays put, then pushes to a second spot right at the end" authorable.

3. **Snappy-by-default new keyframes.** Newly created keyframes get a short default lead-in (~0.8 s, clamped to the gap) so the out-of-box feel is *hold → move* (screen-recorder style). Legacy keyframes with no lead-in still fill the gap (bit-identical back-compat).

All three apply uniformly to **object keyframes** (`keyframes.ts`) and **camera-zoom keyframes** (`camera.ts`), and the picker also feeds enter/exit transitions and the zoom in/out ramp — one motion vocabulary everywhere.

### What exists today (grounded)

- **One central easing list** — `EASINGS` + `EASING_LABELS` in [propertyControls.tsx:15-31](src/components/propertyControls.tsx#L15-L31) — feeds **four** raw `<select>` call sites:
  1. Enter/exit transitions, via `TransitionFields` ([propertyControls.tsx:150-158](src/components/propertyControls.tsx#L150-L158)) — rendered by both `PropertiesPanel` and the `ContextToolbar` "Animate" popover.
  2. Object keyframe "Motion" ([PropertiesPanel.tsx:310-318](src/components/PropertiesPanel.tsx#L310-L318)).
  3. Zoom in/out ramp "Motion" ([PropertiesPanel.tsx:680-687](src/components/PropertiesPanel.tsx#L680-L687)).
  4. Zoom keyframe "Motion" ([PropertiesPanel.tsx:738-746](src/components/PropertiesPanel.tsx#L738-L746)).
- **`EasingKind`** is a flat union of 9 curves ([types.ts:54-59](src/types.ts#L54-L59)); `ease(kind, u)` is a pure `switch` ([easing.ts:42-55](src/lib/easing.ts#L42-L55)). There is no step/snap curve.
- **Object pose interpolation** — `poseAt` ([keyframes.ts:66-91](src/lib/keyframes.ts#L66-L91)) builds `[base@0, ...keyframes]` waypoints and, for the bracketing pair `a→b`, returns `lerpPose(a, b, ease(b.easing, u))` with `u = (t-a.time)/(b.time-a.time)` — **the move always spans the whole `a→b` gap.**
- **Camera pose interpolation** — `zoomPoseAt` ([camera.ts:171-194](src/lib/camera.ts#L171-L194)) is the exact 3-component mirror (`{x,y,scale}`) with the same whole-gap behavior.
- **Keyframe creation** already exists at four insertion points that must seed the new default lead-in: `addKeyframeAt` ([keyframes.ts:215-224](src/lib/keyframes.ts#L215-L224)), the insert branch of `editPose` ([keyframes.ts:195-202](src/lib/keyframes.ts#L195-L202)), `addZoomKeyframeAt` ([camera.ts:248-257](src/lib/camera.ts#L248-L257)), and the insert branch of `editZoomPose` ([camera.ts:232-237](src/lib/camera.ts#L232-L237)).
- **Timeline diamonds & ramps** — object keyframe diamonds at `timeToX(k.time)` ([Timeline.tsx:823-858](src/components/Timeline.tsx#L823-L858)); zoom keyframe diamonds at `timeToX(zoom.transitionIn + k.time)` ([Timeline.tsx:571-603](src/components/Timeline.tsx#L571-L603)); ease ramps drawn as `linear-gradient` overlays ([Timeline.tsx:523-536](src/components/Timeline.tsx#L523-L536), [758-770](src/components/Timeline.tsx#L758-L770)) — the visual pattern to mirror for lead-in ramps.

Because all interpolation lives inside the shared `renderFrame` path (`poseAt`/`zoomPoseAt` → `resolveRenderPose`/`resolveCamera`), every change here animates identically in preview (Frame + Live view) and exported MP4 for free.

## Requirements

### Easing vocabulary

- **R1**: Add `'instant'` to `EasingKind`. `ease('instant', u)` is a step: holds `0` and snaps to `1` at arrival. Precise definition: `return u >= 1 ? 1 : 0` (see R13 for the boundary interaction with `poseAt`).
- **R2**: The **picker** presents exactly these 7 presets, in order, each with a short human label; a live preview of the *currently-selected* curve is shown beside the dropdown:

  | value | label |
  |---|---|
  | `instant` | Instant — no animation |
  | `linear` | Even — steady speed |
  | `easeInCubic` | Slow start, fast finish |
  | `easeOutCubic` | Fast start, slow finish |
  | `easeInOutCubic` | Smooth — slow at both ends *(default)* |
  | `easeOutBack` | Overshoot, then settle |
  | `spring` | Bouncy — springs in |

- **R3**: **Remove** the quad curves (`easeInQuad`, `easeOutQuad`, `easeInOutQuad`) from `EasingKind`, `ease()`, and the label/list — the app has no saved projects yet (in testing), so there's nothing to preserve them for. `EasingKind` becomes exactly the 7 presets. The one non-cosmetic reference — `defaultTransitionEasing`'s fade defaults ([keyframes.ts:120](src/lib/keyframes.ts#L120)) — moves from quad to cubic (`easeOutCubic` in / `easeInCubic` out); `tsc` catches any reference missed.
- **R4**: No legacy/unknown-easing handling is required. With quads removed and nothing persisted, every stored easing is always one of the 7 presets — the picker needs no "custom value" fallback.
- **R5**: One reusable Motion field (a native `<select>` of the 7 presets + a live preview of the selection) replaces all four raw `<select>` sites (R-single-source). The default easing constant stays `easeInOutCubic` (`DEFAULT_EASING`, [keyframes.ts:25](src/lib/keyframes.ts#L25)).

### Per-keyframe lead-in

- **R6**: `Keyframe` and `CameraKeyframe` gain an optional `leadIn?: number` (seconds). Semantics: the move *into* this keyframe occupies only the window `[time − leadIn, time]`; before `time − leadIn` the previous pose is **held**. `leadIn` is undefined ⇒ the move fills the whole gap (today's behavior, unchanged).
- **R7**: `leadIn` is clamped **non-destructively at evaluation** — the effective animation start is `max(previousWaypointTime, time − leadIn)`. A `leadIn` larger than the available gap simply fills the gap; retiming a neighbor never corrupts a stored `leadIn`.
- **R8**: The lead-in applies identically to object keyframes (`poseAt`) and camera-zoom keyframes (`zoomPoseAt`), including the synthetic `base@0` waypoint as the "previous pose" for the first keyframe — so an object/zoom holds its home pose, then animates into keyframe 1.
- **R9**: `leadIn` composes with `instant` easing: an `instant` keyframe holds the previous pose then hard-cuts at `time`, regardless of `leadIn`.

### Defaults

- **R10**: Every keyframe **created** in this session (via `+ Keyframe` or via an auto-insert during a drag/edit) is seeded `leadIn = min(DEFAULT_LEAD_IN, gapToPreviousWaypoint)` with `DEFAULT_LEAD_IN = 0.8`. This gives the snappy hold-then-move feel out of the box.
- **R11**: Keyframes with no `leadIn` (legacy / imported) keep filling the gap. Objects/zooms with **no** keyframes render pixel-identically to today.

### Editing UX

- **R12**: The active-keyframe section of both the object-keyframe and zoom-keyframe panels gains an **"Animate over"** control (seconds) that edits `leadIn`, clamped to `[0, gapToPreviousWaypoint]`. The zoom in/out **ramp** picker and the enter/exit **transition** pickers use the new easing picker but do **not** get a lead-in control (they already own their own duration fields).
- **R13**: The timeline draws a short **lead-in ramp** before each keyframe diamond (mirroring the existing ease-ramp gradients) so a hold-then-move keyframe is visually distinct from a fill-the-gap one.

### Correctness

- **R14**: `DUPLICATE_OBJECT` already deep-clones keyframes; adding a scalar `leadIn` needs no clone change, but verify copies stay independent.
- **R15**: `npx tsc -b` stays green. No new behavior for un-keyframed objects/zooms in preview or export.

## Technical Considerations

### Types (edits to `src/types.ts`)

```ts
// REPLACE (types.ts:54-59) — 'instant' added; quad curves removed (no saved data, R3).
export type EasingKind =
  | 'instant'                                          // NEW — step / hard-cut
  | 'linear'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeOutBack'
  | 'spring'

// EXTEND (types.ts:67-71)
export type Keyframe = {
  time: number         // clip-relative seconds
  pose: KeyframePose
  easing: EasingKind   // curve for the segment ARRIVING at this keyframe
  leadIn?: number      // NEW — seconds the arriving move takes, ending at `time`.
                       // Holds the previous pose before (time - leadIn). undefined = fill the gap.
}

// EXTEND (types.ts:167-171) — same field on the camera mirror
export type CameraKeyframe = {
  time: number         // hold-relative seconds
  pose: CameraState
  easing: EasingKind
  leadIn?: number      // NEW — as above
}
```

`leadIn` is a plain optional scalar → additive and backward-compatible; absent from old data means "fill the gap" (R6/R11). No change to `KeyframePose`, `CameraState`, `TimelineObject`, or `CameraZoom` shape.

### `ease()` change (`src/lib/easing.ts`)

Add one case and delete the three quad cases in the `switch` ([easing.ts:42-55](src/lib/easing.ts#L42-L55)):

```ts
case 'instant': return u >= 1 ? 1 : 0
// remove: easeInQuad / easeOutQuad / easeInOutQuad
```

Pure, deterministic, worker-safe — same guarantees as every other curve. Existing spring/back cases unchanged. `defaultTransitionEasing` ([keyframes.ts:119-122](src/lib/keyframes.ts#L119-L122)) is the only code depending on a quad; repoint its fade defaults to `easeOutCubic`/`easeInCubic`.

### Evaluation semantics — the shared lead-in formula

Both `poseAt` ([keyframes.ts:81-89](src/lib/keyframes.ts#L81-L89)) and `zoomPoseAt` ([camera.ts:184-193](src/lib/camera.ts#L184-L193)) replace the per-segment body. For the bracketing pair `a` (time `ta`) → `b` (time `tb`, `b.easing`, `b.leadIn`):

```ts
const animStart = b.leadIn == null ? ta : Math.max(ta, tb - b.leadIn)
if (t < animStart) return a.pose                       // hold the previous pose
const span = tb - animStart
const u = span > 1e-9 ? (t - animStart) / span : 1     // span 0 (leadIn≈0) ⇒ snap to b at tb
return lerp(a.pose, b.pose, ease(b.easing, u))
```

- `leadIn == null` ⇒ `animStart = ta` ⇒ **identical** to today (whole-gap tween), so un-lead-in data is bit-identical (R11).
- `leadIn >= gap` ⇒ `tb - leadIn <= ta` ⇒ clamped to `ta` ⇒ fills the gap (R7).
- `leadIn` small ⇒ holds `a.pose`, then moves over the last `leadIn` seconds arriving exactly at `tb`.
- The strict `t < animStart` (not `<=`) keeps the keyframe *time* landing on `b.pose` even when `leadIn` is ~0.
- The synthetic `base@0` waypoint (built when `kfs[0].time > KF_EPS`) is a valid `a` — its `leadIn` is never read (it's only ever a start), and keyframe 1's `leadIn` governs the base→KF1 move (R8).

### The picker component (new — `MotionPicker` in `propertyControls.tsx`)

Decision (Q3): keep a **native `<select>`** for the 7 preset labels (accessible, keyboard-native, minimal code) paired with a single **`MotionPreview`** of the *currently-selected* curve. A native `<select>` can't render a preview inside each `<option>`, so we don't try — the one preview reflects the selection instead.

- **`MotionPreview`** (small reusable subcomponent): renders `ease(kind, u)` — a dot travelling on a ~1.2 s rAF loop and/or a static curve glyph (SVG sampled 0→1). It animates **only while mounted**; because the panel re-renders at 60 Hz during playback (Gotchas), the rAF is self-contained (its own `requestAnimationFrame`, **not** driven by `globalTime`) and cheap.
- **`MotionPicker`** = `<select>` (options from the 7-preset list) + `MotionPreview` beside/under it. Props: `value: EasingKind`, `onChange`, optional `exclude?: EasingKind[]` (transitions exclude `'instant'`, Q6). No unknown-value fallback is needed — every stored easing is one of the 7 presets (R4).
- **Reuse**: replace the raw `<select>` at all four sites (transitions via `TransitionFields`; the three panel Motion dropdowns). `ContextToolbar` inherits it via `TransitionFields`.
- `MotionPreview` is **UI-only** (never touches `renderFrame`), so its rAF does not affect the deterministic export/render path.

### "Animate over" control (`PropertiesPanel.tsx`)

In the active-keyframe blocks — object ([PropertiesPanel.tsx:307-331](src/components/PropertiesPanel.tsx#L307-L331)) and zoom ([PropertiesPanel.tsx:735-753](src/components/PropertiesPanel.tsx#L735-L753)) — add, next to "Motion", an **Animate over (s)** field:

- A **range slider** (`<input type="range">`, `min 0`, `max = gapToPreviousWaypoint`, `step 0.05`) with a live readout — modeled on the transition **Duration** control ([propertyControls.tsx:159-176](src/components/propertyControls.tsx#L159-L176)), which pairs a range slider with a "0.8s of 5.0s" readout and a `LifespanBar`. (A bare number input is painful for this — per user, use a slider.) It writes `leadIn` on the active keyframe via a whole-`keyframes`-array update. A `LeadInBar` fill (styled like `TypeOnBar`, [propertyControls.tsx:339-395](src/components/propertyControls.tsx#L339-L395)) can visualize the hold-then-move slice.
- `gapToPreviousWaypoint` for keyframe *i* = `kfs[i].time − (i > 0 ? kfs[i-1].time : 0)` (object) / same over hold-relative times (zoom). A tooltip should clarify "holds the previous pose, then moves in over N s, arriving here".
- Keyframe 1 with the base as its previous waypoint: the control still works (holds the home pose, then moves in).

### Default-seed insertion points (`keyframes.ts`, `camera.ts`)

`DEFAULT_LEAD_IN = 0.8` (new export in `keyframes.ts`, reused by `camera.ts`). Seed `leadIn = min(DEFAULT_LEAD_IN, gapToPrev)` at all four creation sites:

- `addKeyframeAt` ([keyframes.ts:215-224](src/lib/keyframes.ts#L215-L224)) — new push branch (not the in-place update branch).
- `editPose` insert branch ([keyframes.ts:195-202](src/lib/keyframes.ts#L195-L202)).
- `addZoomKeyframeAt` ([camera.ts:248-257](src/lib/camera.ts#L248-L257)).
- `editZoomPose` insert branch ([camera.ts:232-237](src/lib/camera.ts#L232-L237)).

`gapToPrev` at insert time = `newTime − (nearest earlier keyframe time, else 0)`. Updating an existing keyframe (within `KF_EPS`) leaves its `leadIn` untouched.

### Timeline lead-in ramp (`Timeline.tsx`)

For each keyframe with an effective `leadIn > 0`, draw a gradient span from `timeToX(effectiveAnimStart)` to the diamond, using the keyframe's accent color at low alpha — same technique as the zoom ease-in ramp ([Timeline.tsx:523-536](src/components/Timeline.tsx#L523-L536)). Object bars use clip-relative `k.time`; zoom bars offset by `transitionIn`. Purely presentational; retiming/drag logic ([Timeline.tsx:281-320](src/components/Timeline.tsx#L281-L320)) is unchanged (dragging a diamond still edits `time`; `leadIn` is edited from the panel).

### Enter/exit transitions

`TransitionFields` ([propertyControls.tsx:100-181](src/components/propertyControls.tsx#L100-L181)) swaps its `<select>` for `MotionPicker` (with `exclude={['instant']}`, Q6). Transitions keep their own duration slider + `LifespanBar`; no `leadIn`. `applyTransitions` ([keyframes.ts:152-166](src/lib/keyframes.ts#L152-L166)) is otherwise untouched — the new presets (overshoot/bouncy/etc.) already work there via `ease()`. `defaultTransitionEasing` ([keyframes.ts:119-122](src/lib/keyframes.ts#L119-L122)) has its fade defaults repointed from quad to cubic (R3).

## Related Systems and Tasks

- **`SPECS/12-keyframe-easing-engine.md`** — the pose/keyframe engine and `ease()`/`lerp` this extends; whole-pose model and `editPose` upsert rule.
- **`SPECS/13-camera-zoom.md`** — the camera mirror (`zoomPoseAt`, hold-relative times) that gets the same lead-in + picker.
- `src/lib/easing.ts` — `ease()` (add `instant`).
- `src/lib/keyframes.ts` / `src/lib/camera.ts` — `poseAt`/`zoomPoseAt` (lead-in formula); the four keyframe-creation sites (seed default).
- `src/components/propertyControls.tsx` — `EASINGS`/`EASING_LABELS` → new preset list + `MotionPicker`; `TransitionFields`.
- `src/components/PropertiesPanel.tsx` — three Motion dropdowns + the "Animate over" field.
- `src/components/Timeline.tsx` — lead-in ramp overlay.
- `src/components/ContextToolbar.tsx` — inherits the picker via `TransitionFields`.
- **Gotcha** — the panel re-renders at 60 Hz during playback; the picker's rAF preview must run only while its popover is open.

## Open Questions

1. **Easing UI model — RESOLVED (user):** one curated distinct list of 7 presets (not shape + checkboxes).
2. **New-keyframe default — RESOLVED (user):** snappy lead-in (hold, then ~0.8 s move); legacy/imported keyframes fill the gap.
3. **Picker component — RESOLVED (user): native `<select>` + a single live preview** of the selected curve (`MotionPreview`), not a custom listbox. Simpler and keyboard-native; the 7 distinct labels carry the distinctiveness and the preview confirms the selection.
4. **Field name — RECOMMEND `leadIn`** on `Keyframe`/`CameraKeyframe`, surfaced in the UI as **"Animate over"**. Avoids collision with `obj.animateIn` (the draw-on reveal) and clip `duration`. *(Nod?)*
5. **`DEFAULT_LEAD_IN` value — RECOMMEND `0.8 s`, clamped to the gap.** *(Confirm the number.)*
6. **`instant` in enter/exit transitions — RECOMMEND excluding it** from the transition picker (an "instant transition" is just `None`), while keeping it for object/zoom keyframes and the zoom ramp (where a hard-cut zoom is genuinely useful). *(Nod?)*
7. **Lead-in editor — RESOLVED (user): a slider**, not a bare number input (painful for this). A range slider + live readout modeled on the transition Duration control, plus the timeline ramp (R13).
8. **Legacy value display — RESOLVED (user): not needed.** No saved projects (app in testing), so there's no legacy data — quads are removed outright rather than preserved (simplifies R3/R4).

## Acceptance Criteria

- The Motion picker in all four places shows the 7 distinct presets with `instant` selectable, and a live preview reflects the current selection.
- A camera zoom with `hold ≈ 10 s` and a keyframe at hold-relative 5 s can be authored so the camera **holds** the first framing until ~4.2 s, then pushes to the second framing arriving at 5 s — visible identically in Live view and exported MP4.
- Two zoom keyframes both set to **Instant** produce a hard cut between framings (no interpolation) in preview and export.
- A freshly added keyframe (object or zoom) defaults to hold-then-move (~0.8 s lead-in), and its lead-in is editable via "Animate over" and visible as a ramp on the timeline diamond.
- An object/zoom with no keyframes renders pixel-identically to today (no regressions); `npx tsc -b` is clean.
- The `EasingKind` union is exactly the 7 presets (quads removed); fade transitions still default sensibly (cubic).

## Implementation Notes

- Land in dependency order: (1) `EasingKind` = the 7 presets (add `instant`, delete quads), `ease()` `instant` case, repoint `defaultTransitionEasing` fades to cubic; (2) the shared lead-in formula in `poseAt` and `zoomPoseAt` (with the `t < animStart` / `span>0?…:1` guards); (3) `DEFAULT_LEAD_IN` seeding at the four creation sites; (4) `MotionPreview` + `MotionPicker` (native select + preview) + preset list, swapped into the four `<select>` sites; (5) the "Animate over" slider; (6) the timeline ramp.
- Keep `renderFrame`/`resolveCamera` pure — the picker's animation is UI-only.
- Verify per `.claude/skills/verify`: static checks only, then hand the user a browser checklist (the lead-in hold, the instant hard-cut, the preview dropdown, and a no-keyframe regression pass).

---
*Draft — Q1–Q3 resolved by the user. Q4–Q8 carry recommendations pending final nods / refinements. Ready for `/task 21` once Q4–Q8 are confirmed.*
