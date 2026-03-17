# 05 — QoL Improvements: Lane Management & Interaction Simplification

## Overview

Two UX improvements to make the editor less confusing and more direct:

1. **Lane management** — Replace free-form drag-to-new-lane behavior with explicit "+" and "-" buttons on the timeline. Users can only drag objects to existing lanes. New lanes are created/removed via dedicated controls.
2. **Rename and simplify interaction modes** — Replace "Select" / "Draw" with "Move" / "Draw". Selection happens exclusively by clicking object bars in the timeline (never by clicking on the canvas). "Move" mode lets you reposition/resize/rotate the currently-selected object on the canvas. "Draw" mode is auto-activated for arrow/freehand objects. The canvas never selects objects — timeline clicks are the only selection mechanism.

## Requirements

### R1: Lane Management

1. **Add lane buttons**: On the left-hand side of the timeline UI, show two "+" buttons:
   - One at the very top of the lanes area to add a new lane above all existing lanes
   - One at the very bottom to add a new lane below all existing lanes
2. **Remove lane buttons**: Each lane (except when there is only one lane) gets a small "x" / remove button on its left side
3. **Lane removal with objects**: When a lane is removed and it has objects on it, those objects move to the nearest lane **above**. If the removed lane is the topmost lane, objects move to the nearest lane below instead.
4. **Constrained dragging**: Object bars can only be dragged horizontally (time) and vertically to **existing** lanes. No more creating new lanes by dragging beyond current bounds. The "new lane" drop zones (top/bottom blue dashed areas during drag) are removed.
5. **Lane numbering/identity**: Lanes are identified by their integer index. Adding a lane on top increments `maxLane + 1`; adding below decrements `minLane - 1`. The system already supports negative lane numbers.

### R2: Rename Interaction Modes & Timeline-Only Selection

1. **Rename `InteractionMode`**: Change from `'select' | 'draw'` to `'move' | 'draw'`.
2. **Rename UI buttons**: Replace "Select" button with "Move" in `AnnotationTools.tsx`. Keep "Draw" button.
3. **Selection only via timeline**: The only way to select an object is by clicking its bar in the Timeline component. Clicking on the canvas **never** selects objects — it either moves/resizes (in Move mode) or draws (in Draw mode), depending on the active mode and selected object.
4. **Move mode**: When active, canvas interactions on the selected object allow move, resize, and rotate via handles — this works for **all** object types including arrow/freehand. Clicking empty canvas space does nothing (no deselect).
5. **Draw mode**: When active and an arrow/freehand object is selected, clicking/dragging on the canvas adds points/strokes. Draw mode is only enabled when a drawable object (arrow/freehand) is selected, same as current behavior.
6. **Auto-mode switching**: When a new arrow/freehand object is created, automatically switch to Draw mode. When a non-drawable object is selected via timeline, automatically switch to Move mode.
7. **Keyboard shortcut changes**: Remove `V` shortcut. Rename `D` shortcut behavior if needed. `Escape` still deselects.

## Technical Considerations

### Key Types Involved

**`InteractionMode`** ([types.ts:74](src/types.ts#L74)) — **rename values**:
```typescript
// Before:
export type InteractionMode = 'select' | 'draw'
// After:
export type InteractionMode = 'move' | 'draw'
```

**`TimelineObject`** ([types.ts:5-28](src/types.ts#L5-L28)) — unchanged, `lane: number` already supports arbitrary integers:
```typescript
export type TimelineObject = {
  // ...
  lane: number  // higher = renders on top (foreground)
  // ...
}
```

**`ProjectAction`** ([types.ts:78-88](src/types.ts#L78-L88)) — may want a new `REMOVE_LANE` action for bulk-moving objects on lane removal.

**`DragState` in Timeline** ([Timeline.tsx:31-37](src/components/Timeline.tsx#L31-L37)) — the `move` variant needs lane clamping logic to prevent dragging beyond existing lane bounds.

**`CanvasProps`** ([Canvas.tsx:45-54](src/components/Canvas.tsx#L45-L54)) — `interactionMode` prop stays, but now uses `'move' | 'draw'` values. Key change: remove all click-to-select logic from canvas `handleMouseDown`.

### Files to Modify

| File | Changes |
|------|---------|
| [types.ts](src/types.ts) | Rename `InteractionMode` values to `'move' \| 'draw'`. Add `REMOVE_LANE` action. |
| [Timeline.tsx](src/components/Timeline.tsx) | Add lane control gutter (~32px) on left side with "+" and "x" buttons. Clamp vertical drag to existing lanes. Remove phantom drop-zone lanes. |
| [Canvas.tsx](src/components/Canvas.tsx) | Remove click-to-select behavior (no `onSelectObject` calls from canvas). In `'move'` mode, show handles and allow move/resize/rotate for selected object. In `'draw'` mode, draw as before. Clicking empty space does nothing. |
| [AnnotationTools.tsx](src/components/AnnotationTools.tsx) | Rename "Select" button to "Move". Keep "Draw" button and creation buttons. |
| [App.tsx](src/components/App.tsx) | Update `interactionMode` default to `'move'`. Update `handleSetMode` references. Auto-switch to `'move'` when non-drawable object selected via timeline. Auto-switch to `'draw'` when arrow/freehand created. Keep `tightenBbox` logic. |

### Architectural Notes

- The lane "+" buttons should be part of a new left-side gutter in the Timeline, rendered as a fixed-width column that doesn't scroll horizontally with the timeline content.
- Lane remove should dispatch an action that reassigns affected objects. A `REMOVE_LANE` action type keeps the logic in the reducer where it belongs.
- Lane removal preference: move objects to nearest lane above; if removing the topmost lane, move to nearest below.
- The canvas no longer needs `onSelectObject` — that callback can be removed from `CanvasProps` entirely.
- Clamp the `move` drag's target lane: `Math.max(minLane, Math.min(maxLane, targetLane))`

## Related Systems and Tasks

- [Project spec](warhammer-battle-report-editor-spec.md) — original project specification
- Previous tasks built the current timeline, canvas, and interaction mode system

## Open Questions

All resolved.

## Acceptance Criteria

- [ ] Timeline has "+" buttons at top and bottom of the lanes area to add new lanes
- [ ] Each lane (when more than 1 lane exists) has a remove button on the left gutter
- [ ] Removing a lane moves its objects to the nearest lane above (or below if topmost)
- [ ] Dragging a timeline object bar vertically only moves it between existing lanes (no phantom new lanes)
- [ ] "Select" button is renamed to "Move" in the toolbar
- [ ] "Draw" button remains, enabled only when arrow/freehand is selected
- [ ] Clicking an object bar in the timeline is the **only** way to select an object
- [ ] Canvas never selects objects — no click-to-select behavior
- [ ] In Move mode, canvas handles (move/resize/rotate) work for any selected object type
- [ ] In Draw mode with arrow/freehand selected, canvas adds points/strokes
- [ ] Auto-switch to Draw mode when creating arrow/freehand
- [ ] Auto-switch to Move mode when selecting a non-drawable object via timeline
- [ ] `Escape` still deselects the current object
- [ ] Lane gutter is ~32px wide, always visible, aligned with lane rows

## Implementation Notes

### Lane Management (Timeline.tsx)
- Add a left-side gutter `<div>` with fixed width (~32px) that doesn't scroll horizontally
- Use flexbox: gutter (fixed) + scrollable timeline area
- The gutter renders: "+" button at top, per-lane "x" buttons aligned with lane rows, "+" button at bottom
- On "+top": dispatch to add empty lane at `maxLane + 1`
- On "+bottom": dispatch to add empty lane at `minLane - 1`
- On "x": dispatch `REMOVE_LANE` with the lane number — reducer moves objects up (or down if topmost) and collapses
- Clamp `move` drag: `Math.max(minLane, Math.min(maxLane, targetLane))` — no more `isDraggingMove` extra lane logic

### Canvas Changes
- Remove `onSelectObject` from props entirely
- In `handleMouseDown`: no more hit-testing visible objects for selection
- `'move'` mode: only interact with the already-selected object's handles (move body, resize corners, rotate handle)
- `'draw'` mode: same as current draw behavior
- Clicking empty space: do nothing (no deselect — deselect happens via Escape or timeline)

### App.tsx Cleanup
- Change default `interactionMode` from `'select'` to `'move'`
- In `handleSelectObject`: if newly selected object is arrow/freehand, switch to `'draw'`; otherwise switch to `'move'`
- Keep `tightenBbox` logic on deselection — still needed
- Remove `V` keyboard shortcut; keep or remap `D`

---
*This specification is ready for implementation. Use `/task 05-qol-stuff` to begin development.*
