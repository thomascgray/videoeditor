# 22 — Markers (timeline bookmarks + snapping)

**Status**: In Progress

## Overview

Implement spec 22 — user-placed **markers** on the timeline for syncing/alignment. Tap **M** to drop
a marker at the playhead (works while playing — "tap to the beat"); **clips snap to markers** (and to
the playhead, t=0, and other clips' edges) when dragged, which delivers "start on the beat". Markers
render as ruler flags with full-height guide lines, are edited via a lightweight click-popover, and
never appear in the render/export.

Full spec: [SPECS/22-markers.md](../SPECS/22-markers.md).

## Task Context

- **Architectural template = camera zooms (spec 13).** `CameraZoom` is a project-level optional array
  (`Project.zooms?`) with CRUD + transient/commit reducer actions, a timeline track, and whole-project
  persistence. Markers mirror this exact shape (simpler). Grep `zoom` in `types.ts`, `useProject.ts`,
  `App.tsx`, `Timeline.tsx` to find every seam.
- **Snapping is net-new.** Nothing snaps today — the `move` handler only quantizes to 0.1s
  (`Math.round(x*10)/10` in `Timeline.tsx`). New pure helper `src/lib/snapping.ts` `snapTime`.
- **Locked decisions:** Phase 1 only (global markers); snap to markers + playhead + clip edges (Alt
  disables, 8px threshold, visible snap line); lightweight click-popover for edit (NO third selection
  type / no PropertiesPanel); name "Markers"; **M** add, **,** / **.** prev/next.
- **Free by construction:** `renderFrame` never sees markers → no export leak. `projectStorage.ts`
  serializes whole `Project` → persistence/`.brep` need no change. `markers?` optional → old projects
  load unchanged.
- **Verify:** static-checks-only (`.claude/skills/verify/SKILL.md`). Run `npx tsc -b`; do NOT run the
  dev server. Hand the user a click-through checklist.
- **Popover:** `Popover.tsx` owns a toolbar-styled trigger button, so it doesn't fit a ruler flag —
  build a small dedicated marker popover (portal + outside-click/Escape, mirroring its pattern).
- **Keydown guard:** `App.tsx` keydown early-returns when `e.target` is `<input>`/`<textarea>` — the
  marker popover's label input must be a real `<input>` so M / , / . don't fire while typing.

## Blockers/Issues

None. Two deliberate scope notes:
- **Zoom edges not snapped**: only `zoom-move` (the zoom's start) snaps; `zoom-resize-left/right`
  (which adjust `hold`, an envelope quantity, not a plain global edge) are left unsnapped. The core
  clip↔marker alignment is fully covered.
- **Per-keystroke undo for marker labels**: the popover dispatches `UPDATE_MARKER` on each keystroke,
  matching the app's existing convention (project name input, etc.). Acceptable; could debounce later.

## TODO

[X] **Types + factory** (`src/types.ts`): `Marker`, `Project.markers?`, `createMarker`, 5 actions
    (`ADD_MARKER`, `UPDATE_MARKER`, `UPDATE_MARKER_TRANSIENT`, `REMOVE_MARKER`, `CLEAR_MARKERS`)
[X] **Reducer** (`src/hooks/useProject.ts`): `UPDATE_MARKER_TRANSIENT` (mirror `UPDATE_ZOOM_TRANSIENT`) +
    `ADD/UPDATE/REMOVE_MARKER` + `CLEAR_MARKERS` in `applyAction`
[X] **App wiring** (`src/components/App.tsx`): add-at-playhead, prev/next nav, `m`/`M` + `,`/`.` keys,
    thread `markers` + handlers to `Timeline` and `TransportBar`
[X] **Ruler rendering** (`Timeline.tsx`): `MARKER_COLOR`, flags + full-height guide lines, fold marker
    times into `viewDuration`, `marker-move` DragState (transient → COMMIT_TRANSIENT)
[X] **Snapping** (`src/lib/snapping.ts`): `snapTime`/`snapClipMove`; integrated into move, playhead,
    resize, trim, and zoom-move drags; `snapLineTime` state + bright guide + Alt bypass; excludes the
    dragged item's own edges/time + hidden objects from candidates
[X] **Marker popover**: click a flag → label / color / delete (label input is real `<input>`)
[X] **Transport** (`TransportBar.tsx`): flag button to add at playhead + trash to clear all (shown when
    markerCount > 0)
[X] **Verify**: `npx tsc -b` green (exit 0)
[ ] **User browser test** — run the click-through checklist below in the running dev app

## Work Log

[2026-07-20] Implemented spec 22 markers end-to-end (Phase 1). `npx tsc -b` green.

- **Types/factory**: `Marker` type, `Project.markers?`, `createMarker`, and 5 actions
  (`ADD/UPDATE/UPDATE_TRANSIENT/REMOVE_MARKER`, `CLEAR_MARKERS`). Files: `src/types.ts`.
- **Reducer**: `UPDATE_MARKER_TRANSIENT` (mirrors `UPDATE_ZOOM_TRANSIENT`) + the CRUD/clear cases in
  `applyAction`. Files: `src/hooks/useProject.ts`.
- **Snapping**: new pure module `snapTime` + `snapClipMove` (both-edge probe), 8px threshold.
  Files: `src/lib/snapping.ts` (new).
- **Timeline**: `markers` prop; `MARKER_COLOR`/`SNAP_LINE_COLOR`/`MARKER_SWATCHES`; `marker-move`
  DragState; ruler flags (pinned) + full-height guide lines (z-55) + active snap line (z-66); folded
  marker times into `viewDuration`; snapping wired into playhead/move/resize/trim/zoom-move with an
  Alt bypass + snap-line feedback; click-vs-drag on flags; `MarkerPopover` (portal, label/color/delete).
  Files: `src/components/Timeline.tsx`.
- **App**: `handleAddMarker`/`handleStepMarker`/`handleClearMarkers`; `m`/`M` add, `,`/`.` step keys;
  threaded `markers` to Timeline and marker handlers to TransportBar. Files: `src/components/App.tsx`.
- **Transport**: flag button (add at playhead) + trash (clear all, when markerCount>0). Files:
  `src/components/TransportBar.tsx`.
