# 22 — Markers (timeline bookmarks + snapping)

## Overview

Add **markers** (the user asked for "bookmarks"; we ship them under the NLE-standard name
**Markers**): user-placed reference points at specific times in a project, used to **sync things up**
— e.g. drop markers on the beats of a music track, then align clips/annotations so a clip "starts on
the beat."

A marker renders on the timeline ruler as a flag with a vertical guide line down through the lanes.
You add them (including **live**, by tapping **M** during playback — "tap to the beat"), navigate
between them, and — crucially — **clips snap to them** when dragged. Snapping (clips → markers /
playhead / clip edges) is what turns a marker into an alignment tool.

Markers are an **authoring aid only**: never rendered on the canvas, never in the exported video —
guaranteed for free because `renderFrame` has no knowledge of them.

### Decisions locked (from spec review)

- **Scope: Phase 1 only** — global timeline markers + snapping. Clip-anchored markers (that move
  with a clip) + an explicit "align these two" command are a **future** follow-up, noted at the end,
  not built here.
- **Snap targets: markers + playhead + clip edges** (all via one helper; Alt disables mid-drag).
- **Edit UI: lightweight click-popover** on the flag (label / color / delete). **No** third global
  selection type — markers do not touch `PropertiesPanel`.
- **Name & keys:** UI label **"Markers"**; **M** adds at the playhead (works while playing); **,** /
  **.** step to previous / next marker.

## Requirements

**Data & lifecycle**
- **R1** A project carries an optional, additive list: `Project.markers?: Marker[]`. Absent/empty on
  existing projects (back-compat, exactly like `zooms?`).
- **R2** A `Marker` is a lightweight record `{ id, time, label?, color? }`, `time` in global seconds.
  It is **not** a `TimelineObject` (no lane/pose/data) — it mirrors the `CameraZoom` precedent of a
  non-object, project-level entity.
- **R3** Add a marker at the current playhead (`globalTime`) via (a) the **M** key and (b) a flag
  button on the transport bar. Adding while **playing** works and does **not** pause playback — this
  is the tap-to-the-beat workflow.
- **R4** Delete a marker; rename its label; change its color — each is one undo entry (mirroring zoom
  CRUD).
- **R5** Retime a marker by dragging its flag along the ruler (transient → commit = one undo per
  drag), snapping to the same targets clips snap to (R11–R12).
- **R6** Markers persist automatically: whole-project JSON to localStorage (when `persistProject`)
  and inside `.brep` export/import. **No migration or serializer change** — `projectStorage.ts`
  serializes the whole `Project`.
- **R7** Markers never appear in the rendered canvas or the exported video.

**Display & navigation**
- **R8** Each marker renders on the timeline **ruler** as an interactive flag/pennant at its
  x-position, plus a thin **full-height vertical guide line** through the lanes — a distinct color
  from the playhead, `pointer-events-none` so it never eats lane clicks (only the flag head is
  interactive). The flag `stopPropagation`s its mousedown so clicking it doesn't also start a ruler
  playhead-scrub.
- **R9** Clicking a marker flag seeks the playhead to it. Hovering shows its label (if any).
- **R10** **,** / **.** seek the playhead to the previous / next marker relative to the current
  `globalTime`.
- **R11** The timeline view width extends to include the furthest marker so a marker placed past the
  end of all content stays visible (today `viewDuration` derives only from `totalDuration`). Markers
  do **not** extend `totalDuration` or the export length.

**Snapping** (net-new — nothing snaps today)
- **R12** While dragging a **clip body** (Timeline `move`), the clip's start edge *and* end edge probe
  the snap targets; the nearest within a pixel threshold wins and the drag lands that edge exactly on
  the target. Targets: **marker times**, the **playhead** (`globalTime`), **t = 0**, and **other
  clips' start/end edges** (excluding the dragged clip's own edges).
- **R13** Snapping also applies to: dragging the **playhead** (snaps to markers + clip edges),
  dragging a clip's **resize/trim edges** (snap the moving edge — "trim to the beat"), and dragging a
  **camera-zoom** bar and its edges. All reuse one snap helper.
- **R14** Holding **Alt** during a drag disables snapping for that drag (standard escape hatch for
  nudging past a sticky point).
- **R15** When a snap is active during a drag, show a highlighted vertical snap line at the snap time;
  clear it on mouse-up.
- **R16** Snap threshold is **pixel-based** (proposed 8px) converted to seconds via `pixelsPerSecond`,
  so snapping feels the same at every time-zoom level.

**Editing UI**
- **R17** Clicking a marker flag opens a **lightweight popover** anchored to the flag with: a label
  text field, a small color choice, and a Delete action. No global `selectedMarkerId`; the popover
  owns its open/close state locally. (Escape / click-away closes it.)
- **R18** A **"Clear all markers"** action exists (bulk removal) — one undo entry. Reachable from the
  transport marker button's context (e.g. long-press / secondary control) or the popover; exact
  placement is an implementation detail.

## Technical Considerations

### New types (`src/types.ts`)

```ts
// === Markers (spec 22) ===

// A user-placed timeline marker ("bookmark"). NOT a TimelineObject — a lightweight, project-level
// reference point, mirroring how CameraZoom is a non-object entity. Authoring aid only: never
// rendered or exported. A single global-seconds scalar (no pose/lane/data).
export type Marker = {
  id: string
  time: number      // global seconds
  label?: string    // optional user label ("Beat 1", "Chorus"); default unlabeled
  color?: string    // optional accent hex; default MARKER_COLOR
}

export type Project = {
  id: string
  name: string
  fps: number
  width: number
  height: number
  objects: TimelineObject[]
  assets: AssetMeta[]
  zooms?: CameraZoom[]
  markers?: Marker[]   // spec 22; optional/additive for back-compat (mirrors `zooms?`)
}
```

Factory, mirroring `createCameraZoom`:

```ts
export function createMarker(options?: Partial<Omit<Marker, 'id'>>): Marker {
  return {
    id: crypto.randomUUID(),
    time: options?.time ?? 0,
    ...(options?.label !== undefined && { label: options.label }),
    ...(options?.color !== undefined && { color: options.color }),
  }
}
```

### Reducer actions (`src/hooks/useProject.ts`)

Mirror the zoom CRUD + transient/commit pattern exactly (one undo per discrete mutation; one undo per
drag gesture). Add to the `ProjectAction` union and `applyAction`:

```ts
| { type: 'ADD_MARKER'; marker: Marker }
| { type: 'UPDATE_MARKER'; markerId: string; updates: Partial<Omit<Marker, 'id'>> }
| { type: 'UPDATE_MARKER_TRANSIENT'; markerId: string; updates: Partial<Omit<Marker, 'id'>> }
| { type: 'REMOVE_MARKER'; markerId: string }
| { type: 'CLEAR_MARKERS' }
```

- `ADD_MARKER` → `{ ...project, markers: [...(project.markers ?? []), action.marker] }`
- `UPDATE_MARKER` → map over `markers ?? []`, merge `updates` on match.
- `REMOVE_MARKER` → filter `markers ?? []`; `CLEAR_MARKERS` → `{ ...project, markers: [] }`.
- `UPDATE_MARKER_TRANSIENT` → delegate to `UPDATE_MARKER` and set `transientSnapshot` (copy the
  existing `UPDATE_ZOOM_TRANSIENT` block verbatim); commit via the shared `COMMIT_TRANSIENT`.

No new commit action is needed — `COMMIT_TRANSIENT` is generic (snapshots the whole project).

### Snapping helper (new — `src/lib/snapping.ts`)

Snapping is **net-new**. The `move` handler today only quantizes to 0.1s (`Math.round(x*10)/10` in
`Timeline.tsx`); clips don't snap to each other or anything else.

A single pure helper, called from every drag handler in `Timeline.tsx`:

```ts
// Snap `rawTime` to the nearest candidate within `thresholdPx`, else return it unchanged.
// Threshold is in PIXELS (zoom-independent feel), converted to seconds via pps.
export function snapTime(
  rawTime: number,
  candidates: number[],       // marker times, playhead, 0, other clips' edges
  pixelsPerSecond: number,
  thresholdPx = 8,
  disabled = false,           // Alt held
): { time: number; snappedTo: number | null }
```

- **Clip move**: probe **both** edges — test `start` and `start + duration` against `candidates`,
  pick the nearest snap across the two, back out `startTime`. Exclude the dragged clip's own edges
  from `candidates`.
- **Playhead / single-edge (trim, zoom-resize) drags**: probe the one moving time.
- The handler stores the active snap target in a `snapLineTime` state (→ R15 guide line) and clears
  it on mouse-up. Alt (`e.altKey`) sets `disabled`.

Candidate assembly lives in `Timeline.tsx` (it already has `pixelsPerSecond`, `objects`, `zooms`,
`globalTime`; it gains `markers` as a prop).

### Rendering (`Timeline.tsx`)

- Markers draw in the sticky **ruler** (`RULER_HEIGHT = 24`) as interactive flags, plus a full-height
  vertical line reusing the playhead's positioning (`left: timeToX(m.time)`, `pointer-events-none`,
  `MARKER_COLOR`, ~50–60% opacity so it reads as secondary to the playhead).
- Fold marker times into `viewDuration` (R11): `max(totalDuration, ...markerTimes) + padding`.
- New `DragState` variant `{ kind: 'marker-move'; markerId; startMouseX; originalTime }` for retiming
  (transient → `COMMIT_TRANSIENT`), snapping like everything else.
- New constant `MARKER_COLOR` near `ZOOM_COLOR` — a distinct accent (e.g. cyan `#06b6d4`), clearly
  different from the amber zooms, the type colors, and the playhead.

### Marker popover (R17)

A small local-state popover component anchored to the clicked flag. Reuse the existing
`Popover.tsx` if it fits; fields: label `<input>`, a few color swatches, Delete button. Dispatches
`UPDATE_MARKER` (label/color) and `REMOVE_MARKER`. **Guard the keydown handler** in `App.tsx`: it
already early-returns when `e.target` is an `<input>`/`<textarea>`, so typing a label won't trigger
M / , / . — verify the popover's input is a real `<input>` so that guard applies.

### App wiring (`src/components/App.tsx`)

- Thread `markers={project.markers}` + handlers into `Timeline` (like `zooms`).
- **Add at playhead**: `dispatch({ type: 'ADD_MARKER', marker: createMarker({ time: playback.globalTime }) })`.
- **Nav**: from `project.markers` sorted by time, find the first `> globalTime` (next) / last
  `< globalTime` (prev), then `playback.seek(...)`.
- **Keyboard** (free keys today — Space, v, h/H, s/S, Enter, Escape, Delete/Backspace, Ctrl+Z/Y):
  - `m`/`M` → add marker at playhead (works during playback).
  - `,` → previous marker; `.` → next marker.
  - Same input-focus guard as the other shortcuts.
- **Transport button** (`TransportBar.tsx`): a flag icon button that adds a marker at the playhead;
  optionally a secondary affordance for "Clear all markers" (R18).

### Things that DON'T change

- `renderer.ts` / all export paths (`ffmpegExport.ts`, `exportWorker.ts`, `videoDecoder.ts`),
  `useCanvasRenderer`, `useAudioPlayback` — markers are invisible to render/export by construction.
- `projectStorage.ts` — whole-project JSON already round-trips a new optional array.

### Edge cases

- **Marker past `totalDuration`** — allowed and shown (R11), but `usePlayback.seek` clamps to
  `totalDuration`, so `.` (next) onto such a marker parks at the end. Acceptable for MVP (documented);
  relaxing the clamp is optional.
- **Duplicate times** — two markers at the same time are allowed; they stack on the ruler. No dedupe.
- **Empty label** — a marker with no label just shows the flag; the popover can leave label blank.
- **Snapping to a hidden clip's edges** — exclude `hidden` objects from clip-edge candidates so you
  don't snap to something you can't see.

## Related Systems and Tasks

- **Camera zooms (spec 13, `SPECS/13-camera-zoom.md`, `TASKS/✅ 13-zoom.md`)** — the architectural
  template at every layer: optional project array (`zooms?`), full CRUD + transient/commit actions,
  its own timeline track, whole-project persistence. Markers are a simpler instance of the same
  shape. Grep `zoom` across `types.ts`, `useProject.ts`, `App.tsx`, `Timeline.tsx` to find the seams.
- **Video sequencing / trim (spec 14, `SPECS/14-video-sequencing.md`)** — the trim edge handles and
  `SPLIT_OBJECT` that snapping must cooperate with (R13); the reference point for the *future*
  clip-anchored markers.
- **Timeline UI (specs 16/17)** — the ruler, sticky header, `pixelsPerSecond` time-zoom, single
  scroll container the flags render into.
- **`src/hooks/usePlayback.ts`** — `seek` / `globalTime` / `totalDuration` (note the `seek` clamp
  above).

## Open Questions

_All major decisions resolved in review (see "Decisions locked"). Remaining minor items, with
recommended defaults — flag if you disagree, else they stand:_

- **OQ1 (minor)** — "Clear all markers" placement (R18): transport secondary control vs a context menu.
  *Default:* a small "clear" affordance surfaced from the transport marker button. Cosmetic; settle
  during implementation.
- **OQ2 (minor)** — Marker color palette: reuse the keyframe palette (`KEYFRAME_COLORS`) or a fixed
  single `MARKER_COLOR` with a couple of alternates? *Default:* single `MARKER_COLOR` + 3–4 swatches
  in the popover.
- **OQ3 (minor)** — `seek` clamp vs markers past the end (Edge cases). *Default:* keep the clamp;
  don't over-engineer for markers placed beyond content.

## Acceptance Criteria

1. Pressing **M** (playing or paused) drops a marker at the playhead; it appears as a ruler flag with
   a full-height guide line and does **not** pause playback.
2. Dragging a clip so its start (or end) edge nears a marker, the playhead, t=0, or another clip's
   edge **snaps** it exactly onto that time; a snap guide line shows the lock; holding **Alt**
   disables snapping for that drag.
3. Scrubbing the playhead snaps it to nearby markers / clip edges.
4. Clicking a flag seeks to it; **,** / **.** step to previous / next marker.
5. A marker can be retimed by dragging its flag (one undo entry), and relabeled / recolored / deleted
   from its click-popover; **Ctrl+Z** reverses each.
6. "Clear all markers" removes them in one undoable step.
7. Markers round-trip through `.brep` export/import and (with `persistProject`) a page refresh; an
   **old** project with no `markers` field loads unchanged.
8. **Exported video contains no marker visuals**; `npx tsc -b` is green.
9. The timeline view extends to reveal a marker placed just past the last clip.

## Implementation Notes

Suggested order (each step keeps `npx tsc -b` green):
1. **Types + factory** — `Marker`, `Project.markers?`, `createMarker` in `src/types.ts`.
2. **Reducer** — the five actions in `ProjectAction` + `applyAction`, copying the `*_ZOOM` /
   `*_ZOOM_TRANSIENT` blocks in `useProject.ts`. Verify undo/redo + `CLEAR_MARKERS`.
3. **App wiring** — add-at-playhead, `,`/`.` nav, `m`/`M` and nav keys in the keydown effect, pass
   `markers` + handlers to `Timeline`.
4. **Ruler rendering** — flags + guide lines + `MARKER_COLOR`; fold marker times into `viewDuration`
   (R11); add the `marker-move` `DragState` (transient → `COMMIT_TRANSIENT`).
5. **Snapping** — `src/lib/snapping.ts` `snapTime` helper; integrate into `move` first, then
   playhead / trim / zoom drags; add the `snapLineTime` state + guide-line render + Alt bypass;
   exclude the dragged object's own edges and `hidden` objects from candidates.
6. **Popover** — flag click-popover (label / color / delete), reusing `Popover.tsx` if it fits.
7. **Transport** — flag button in `TransportBar.tsx` (+ optional "clear all").

Patterns to follow: the `CameraZoom` code paths are the closest mirror at every layer. Keep
`renderFrame` untouched. Verification is static-checks-only per project convention
(`.claude/skills/verify/SKILL.md`): after changes run `npx tsc -b` and hand the user a
"click X, look for Y" browser checklist.

## Future extension — clip-anchored markers (not in this spec)

A later spec can add markers that **belong to a clip** (`Marker.objectId?` + a clip-relative time),
so "the downbeat is 0:12 into the music" stays true when the clip moves/trims, plus an explicit
**"align these two"** command. Phase 1's `Marker` type reserves room for an optional `objectId`, and
snapping already generalizes to any candidate time — so this is purely additive. Deferred because the
derived-time bookkeeping through trim/rate/split (spec 14) and the extra UI are materially more work,
and global markers + snapping already deliver the headline "start on the beat" use case.

---
*This specification is ready for implementation. Use `/task 22` (or `/task 22-markers`) to begin
development.*
