# 05-qol-stuff — Lane Management & Interaction Simplification

**Status**: In Progress

## Overview

Implement two QoL improvements from [SPECS/05-qol-stuff.md](../SPECS/05-qol-stuff.md):
1. Replace free-form drag-to-new-lane with explicit "+"/"x" lane buttons on the timeline
2. Rename Select/Draw to Move/Draw, make timeline the only selection mechanism

## Task Context

- Spec: `SPECS/05-qol-stuff.md` has full requirements and acceptance criteria
- Key files: `src/types.ts`, `src/components/Timeline.tsx`, `src/components/Canvas.tsx`, `src/components/AnnotationTools.tsx`, `src/components/App.tsx`
- `useProject` hook in `src/hooks/useProject.ts` contains the reducer — `REMOVE_LANE` action added there
- Lane system supports negative lane numbers — adding above = `maxLane + 1`, below = `minLane - 1`
- Timeline uses `extraLanesAbove` / `extraLanesBelow` state to track explicitly added empty lanes
- Canvas no longer has `onSelectObject` prop — selection is timeline-only

## Blockers/Issues

- [FIXED] Dragging object bars up/down continuously expanded lane range because clamp bounds recalculated from moved object positions
- [FIXED] "+" CTA buttons overlapped with "x" remove buttons on first/last lanes

## TODO

- [X] **types.ts**: Rename `InteractionMode` from `'select' | 'draw'` to `'move' | 'draw'`. Add `REMOVE_LANE` action.
- [X] **useProject.ts**: Handle `REMOVE_LANE` action in reducer (move objects up, or down if topmost)
- [X] **Timeline.tsx**: Add lane gutter with "+" and "x" buttons. Clamp drag to existing lanes. Remove phantom drop zones.
- [X] **Canvas.tsx**: Remove `onSelectObject` and click-to-select. Move mode = handles only. Draw mode = same as before.
- [X] **AnnotationTools.tsx**: Rename "Select" to "Move"
- [X] **App.tsx**: Default to `'move'`, auto-switch modes on selection/creation, remove `V` shortcut, remove `onSelectObject` from Canvas props
- [X] Fix playhead to extend through full timeline height (ruler + spacers + lanes)
- [X] Make lane add/remove icons bigger (text-sm instead of text-xs/text-[10px])
- [ ] Canvas resize handles for out-of-bounds objects (deferred — requires canvas→HTML overlay refactor)
- [X] Snap timeline object dragging to nearest 0.1s
- [X] Show time range in object bar labels with bold name (e.g. **Arrow 1** [00:12.0 - 00:16.0])
- [ ] Manual testing / user review

## Work Log

[2026-03-12] Implemented all changes for lane management and interaction mode simplification

- Files modified: `src/types.ts`, `src/hooks/useProject.ts`, `src/components/Timeline.tsx`, `src/components/Canvas.tsx`, `src/components/AnnotationTools.tsx`, `src/components/App.tsx`
- `InteractionMode` renamed from `'select' | 'draw'` to `'move' | 'draw'`
- Added `REMOVE_LANE` action type and reducer handler
- Timeline: added 32px lane gutter with "+" buttons (top/bottom) and "x" remove buttons per lane; clamped drag to existing lanes; removed phantom drop zones; tracks extra empty lanes via local state
- Canvas: removed `onSelectObject` prop and all click-to-select logic; move mode only interacts with selected object handles; draw mode unchanged
- AnnotationTools: "Select" button renamed to "Move" with title "Move (M)"
- App: default mode is `'move'`; auto-switches to `'draw'` when arrow/freehand selected via timeline; `V` shortcut replaced with `M` for move; Escape switches to move mode
- TypeScript compiles clean, Vite production build succeeds

[2026-03-12] Fixed two bugs in lane management

- Files modified: `src/components/Timeline.tsx`
- Bug 1: Drag-to-new-lane — added `clampMinLane`/`clampMaxLane` to move drag state, captured at mousedown, so clamp bounds don't shift as the object moves
- Bug 2: CTA/X overlap — moved "+" buttons out of the lane track `div` into their own dedicated `LANE_HEIGHT`-tall rows above/below the lane area, with matching spacers in the scrollable timeline so everything aligns

[2026-03-12] QoL batch: playhead, icons, snapping, bar labels

- Files modified: `src/components/Timeline.tsx`
- Playhead moved from inside lanes div to outer container with `height: 100%` so it spans ruler + spacers + lanes
- Lane add (+) icons bumped to `text-sm font-bold`, remove (×) icons bumped to `text-sm`
- Move/resize-left/resize-right drag handlers now round to nearest 0.1s via `Math.round(val * 10) / 10`
- Object bar labels now show `<b>Name</b> [MM:SS.s - MM:SS.s]` with a `formatTime()` helper
- Canvas out-of-bounds handles investigated — deferred, requires canvas→HTML overlay refactor
