# 20-new-text-objects — new kinds of text objects to play with

## Overview

Today there is exactly **one** text object: a flat, optionally-backgrounded block rendered by
`drawText`, revealed character-by-character via `animateIn`. Specs 18-qol R5 (rounded corners),
18-qol R6 (in-place editing) and 19 (glow/outline/gradient/pulse/wave/shimmer effects) enrich how
that one block *looks and animates*, but they don't add new **kinds** of text.

This spec is a **catalogue of new text object kinds** — richer, more playful text primitives to give
the user something fun to author with. It is deliberately exploratory: the goal of this session is to
capture the design space, the model impact of each candidate, and how each maps onto the existing
Canvas-2D pipeline, so we can pick one or two and prototype ("play around") later. It is **not** a
commitment to build all of them.

The screen-recorder / explainer positioning of the app drives the priorities: a **number counter**,
**kinetic captions**, and a **callout label with a leader line** are the three highest-value adds and
are documented in the most detail; the rest are a lighter "catalogue" tier.

### The two governing constraints (read first)

Both are inherited from `CLAUDE.md` and are non-negotiable for every candidate here:

1. **Pure function of `(object, time)` in Canvas 2D.** `renderFrame` is the single compositor shared by
   preview and export; it runs once per preview frame and once per exported frame. Every candidate must
   render deterministically from its `data` + a clip-relative time — no wall clock, no unseeded
   `Math.random()`, no WebGL. This is exactly the constraint spec 19 already satisfies, and the
   plumbing it added (a clip-relative `time` param already flows into `drawText`) is reused here.

2. **Everything is a flat `TimelineObject` with a type-specific `data` payload.** So each new "kind" is
   one of two shapes, and *choosing which* is the central design decision for every candidate:
   - **(A) a new `TimelineObjectType`** with its own `data` variant (e.g. `type: 'counter'`) — gets its
     own creation entry, its own timeline name ("Counter 1"), its own panel section, and a dedicated
     `draw*` path. More surface area; cleaner mental model; needs wiring in ~6 places (see Technical
     Considerations → "Cost of a new `type`").
   - **(B) a new optional field on `TextData`** (e.g. `TextData.reveal?`) — inherits *all* existing text
     styling, effects, wrapping, `autoSize`, in-place editing, and reveal for free; near-zero wiring;
     but it's "a text box with a mode," not its own object.

   The rule of thumb applied below: **if the content is still fundamentally authored text, use (B); if
   the content is computed or the object carries non-text geometry (an anchor point, a number range),
   use (A).**

## Requirements

The catalogue is split into a **First batch** (recommended to build first — detailed) and a
**Catalogue** (lighter treatment; pick from later). Requirement IDs are per-candidate so we can adopt
them piecemeal.

### First batch (recommended)

#### C1 — Number counter / ticker

- C1.1 A text object that displays a **number that animates from `from` to `to`** over a window (the
  clip's `animateIn` reveal by default), formatted for display: `0 → 1,234`, `$0 → $4.2M`,
  `0% → 98%`.
- C1.2 Formatting options: **plain / integer / currency / percent**, fixed `decimals`, optional
  `prefix`/`suffix`, and thousands grouping. The formatter must be **deterministic** (same value ⇒ same
  string in preview and export — see OQ2 on locale).
- C1.3 The count is driven by a **clip-relative progress** shaped by an easing curve (reuse `EasingKind`),
  so it eases in/settles rather than counting linearly, and it is **fps-independent** (same value at the
  same clip time at 30 or 60 fps).
- C1.4 The counter reuses all existing text styling — font, color, alignment, `autoSize` to fit the box,
  background/rounded panel, and (ideally) the spec-19 effects — so it can be a big glowing gradient
  number, not a plain one.
- C1.5 Back-compat: adding this must not change how any existing text object renders.

#### C2 — Kinetic captions (word / line reveal)

- C2.1 A text object gains a **reveal granularity**: reveal by **character** (today's typewriter,
  default), by **word**, or by **line** — so captions can pop in word-by-word (CapCut / subtitle style)
  instead of letter-by-letter.
- C2.2 An optional **per-unit entrance style** for each revealed unit (word/line): e.g. a quick
  **wipe** (current behavior), **pop** (scale-up), or **rise** (slide up + fade). Each unit's animation
  is a pure function of the reveal progress + that unit's index, so it stays deterministic and does not
  reflow the layout (units occupy their final positions; only opacity/scale/offset animate).
- C2.3 Composes with everything else text already does — wrapping, alignment (including justify),
  `autoSize`, background, effects (spec 19), enter/exit transitions, and keyframes.
- C2.4 Back-compat: default granularity = character with the current wipe reveal ⇒ **byte-identical** to
  today for existing objects.
- C2.5 **Overlaps with C6 (list reveal)** — "reveal by line" is the same mechanism as a staggered list.
  Decide whether list reveal is just `reveal: 'line'` or a separate thing (OQ3).

#### C3 — Callout label with leader line

- C3.1 A text label **tethered to an anchor point** elsewhere on the frame by a line/arrow — "click
  *this* button →". The label is a normal text box; the **anchor** is a separate normalized point; a
  connector (straight or curved, optional arrowhead) is drawn from the label to the anchor.
- C3.2 Both the **label box** and the **anchor point** are independently draggable on the canvas.
- C3.3 The connector reuses the existing arrow geometry (bezier curvature + arrowhead) so it looks
  consistent with the arrow tool and can draw-on with `animateIn`.
- C3.4 The label reuses `drawText` (styling, background/rounded panel, effects, wrapping).
- C3.5 This is the one candidate that is unambiguously a **new `type`** (it carries non-text geometry —
  the anchor point — that no `TextData` field models cleanly).

### Catalogue (pick from later; lighter treatment)

#### C4 — Speech / chat bubble

- C4.1 Text in a **rounded bubble with a directional tail** (a small triangle pointing from a chosen
  side/corner). Optionally animate in like an incoming chat message (pop + settle).
- C4.2 Builds directly on 18-qol R5 (rounded background) + a tail triangle + a `tail` direction field.
  Strong candidate for **(B) a `TextData` field** since the content is still authored text.

#### C5 — Curved / path text

- C5.1 Glyphs laid out **along an arc or curve** instead of straight lines (decorative; fun to drag).
- C5.2 Reuses the per-glyph `paintRun` path (spec 19's wave) for placement and the arrow's bezier
  helpers (`quadBezierAt` / `quadBezierAngleAt`) for position + tangent rotation of each glyph.
- C5.3 Interaction with `autoSize`/wrapping is limited — curved text is single-line by nature (note in
  OQ4). Likely **(B) a `TextData` field** (`path?`), gated to single-line.

#### C6 — List / step reveal

- C6.1 A multi-line list whose **items appear one at a time along the timeline** (or on the reveal),
  optionally with bullets/numbering. Explainer bread-and-butter ("3 reasons…").
- C6.2 Mechanically identical to C2's "reveal by line"; the only extra is bullet/number prefixes. See
  OQ3 — this may collapse into C2.

#### C7 — Terminal / code block

- C7.1 Monospace text with a **blinking caret** (pure fn of time), line-by-line reveal, optional
  fake-window chrome (title bar + dots). On-brand for a dev-facing screen recorder.
- C7.2 The blink is `floor(time * rate) % 2`; the caret is drawn after the last revealed glyph. Reuses
  reveal + `paintRun`. Mostly **(B)** (a `TextData` variant: mono + caret), with chrome as an optional
  background treatment.

#### C8 — Live timecode / clock

- C8.1 Text that **renders the playhead time** (or a running clock / countdown / elapsed timer) formatted
  as `mm:ss` / `hh:mm:ss` / frames. Content is computed from clip-relative time ⇒ pure fn.
- C8.2 Content is computed, not authored ⇒ leans **(A) a small new type** (or a `TextData.clock?` mode,
  like the counter question). Cheap either way.

#### C9 — Sticker / badge

- C9.1 Short text on a **pill or starburst background** ("NEW", "SALE", "-50%") — a background-shape
  preset over text. Mostly a preset of C4/rounded-background work; lowest priority.

## Technical Considerations

### Cost of a new `type` (the wiring checklist for shape (A))

Grepping the `TimelineObjectType` union shows a new `type` touches these sites (verified against the
current tree):

- `TimelineObjectType` union — [types.ts:3](src/types.ts#L3) — add the literal.
- New `*Data` type + add it to the `TimelineObject['data']` union — [types.ts:39](src/types.ts#L39).
- `createTimelineObject`'s `animateIn` default line references specific types — [types.ts:310](src/types.ts#L310).
- `handleCreateObject`'s `defaultData` record is **`Record<TimelineObjectType, …>`** so it *must* gain
  an entry or it won't compile — [App.tsx:249-258](src/components/App.tsx#L249-L258); plus the text-only
  position/style special-casing at [App.tsx:271-286](src/components/App.tsx#L271-L286).
- Creation entry in the `LeftRail` — [LeftRail.tsx:88-92](src/components/LeftRail.tsx#L88-L92).
- Render dispatch `switch (obj.type)` — [renderer.ts:122-161](src/lib/renderer.ts#L122-L161) — add a case.
- The `draw*` fn itself in `annotations.ts`.
- `PropertiesPanel` gets a `obj.type === '<new>'` section — [PropertiesPanel.tsx:457](src/components/PropertiesPanel.tsx#L457) is the pattern.
- Canvas hit-testing / selection generally works off the normalized bbox, so most interaction is free;
  candidates with extra handles (C3's anchor point) add overlay + drag work in `Canvas.tsx`.

By contrast, shape (B) — a new optional `TextData` field — needs only: the field on `TextData`, a branch
inside `drawText`, and a control in the existing text panel section. **This asymmetry is why the
per-candidate (A)/(B) call matters.**

### Existing machinery each candidate reuses (all already in the tree)

- **Clip-relative `time`** already flows `renderFrame → drawObject → drawText`
  ([renderer.ts:56](src/lib/renderer.ts#L56) → [:96](src/lib/renderer.ts#L96) →
  [:136](src/lib/renderer.ts#L136); `drawText` param at [annotations.ts:248](src/lib/annotations.ts#L248)).
  Counters (C1), captions (C2), terminal blink (C7), clock (C8) all consume this — **no new plumbing**,
  spec 19 already paid that cost.
- **Reveal `progress`** (`min(1, elapsed/animateIn)`) is computed at [renderer.ts:57-59](src/lib/renderer.ts#L57-L59)
  and passed to every `draw*`. C1 can drive the counter value from `progress`; C2/C6/C7 drive granular
  reveal from it.
- **Per-glyph `paintRun` helper** — [annotations.ts:381-396](src/lib/annotations.ts#L381-L396) — added for
  spec-19 wave; already iterates characters advancing by `measureText`. C2 (per-word/line offsets), C5
  (curved placement), C7 (caret positioning) all extend this path. Consider factoring a shared
  `drawLineGlyphs()` as spec 19 OQ2 anticipated, so reveal/align/justify logic isn't duplicated.
- **Quadratic bezier helpers** — `quadBezierAt` / `quadBezierAngleAt` /
  `segmentControlPoint` — [annotations.ts:3-60](src/lib/annotations.ts#L3-L60) — power the arrow tool; C3
  (leader line) and C5 (path text) reuse them directly.
- **Rounded background panel** — [annotations.ts:294-304](src/lib/annotations.ts#L294-L304) (18-qol R5) —
  C4 (bubble) and C9 (badge) build on it.
- **Easing engine** (`EasingKind`, `ease`, `lerp`) in `src/lib/easing.ts` — C1's count curve; any
  per-unit ease in C2.
- **`updateData(patch, remember)`** panel helper — [PropertiesPanel.tsx:442](src/components/PropertiesPanel.tsx#L442)
  style calls — wires new fields to one-undo-entry edits + last-used defaults, for both (A) and (B).

### Types to add (per candidate)

**C1 — counter.** The open question is (A) new type vs (B) `TextData` field (OQ1). Sketch for **(A)**:
```ts
// New TimelineObjectType 'counter'. Renders a formatted, animating number; delegates glyph layout to
// the shared text machinery (format number → string → drawText layout), so it inherits font/align/
// background/effects. The count value is a pure fn of clip-relative progress.
export type CounterData = {
  from: number
  to: number
  format?: 'plain' | 'integer' | 'currency' | 'percent'  // default 'plain'
  decimals?: number         // fixed decimal places; default 0 (integer/percent) or 1 (currency M/K)
  prefix?: string           // e.g. '$'  (or use format:'currency')
  suffix?: string           // e.g. ' users'
  grouping?: boolean        // thousands separators; default true
  compact?: boolean         // 1_200_000 -> "1.2M"; default false
  easing?: EasingKind       // curve applied to from->to over the reveal window; default 'easeOutCubic'
  // The count runs over the object's animateIn window (reuse of the reveal timer) — or a dedicated
  // span if we decide counters shouldn't hijack animateIn (OQ1b).
}
```
For **(B)** the same fields live under `TextData.counter?: CounterSpec` and, when present, override the
rendered content with the computed number (ignoring `data.content` and the char reveal).

**C2 — kinetic captions (field on `TextData`).**
```ts
export type TextRevealMode = 'char' | 'word' | 'line'      // default 'char' (today)
export type TextRevealStyle = 'wipe' | 'pop' | 'rise'      // default 'wipe' (today)
// added to TextData:
//   reveal?: TextRevealMode
//   revealStyle?: TextRevealStyle
```
Absent ⇒ `'char'`/`'wipe'` ⇒ current behavior exactly (C2.4).

**C3 — callout (new type `callout`).**
```ts
export type CalloutData = {
  content: string                 // the label text (reuse drawText)
  background?: string; padding?: number; align?: TextAlign; cornerRadius?: number  // label panel
  anchor: { x: number; y: number } // normalized 0–1 target point the leader aims at
  curvature?: number              // reuse ArrowData semantics (-1..1)
  arrowhead?: boolean; headSize?: number
  // NB: could instead compose TextData + a leader sub-object; resolve in OQ5.
}
```
The label box is the object's normalized bbox; `anchor` is a second draggable point drawn on the
overlay (new interaction in `Canvas.tsx`).

**C4/C5/C7/C9 — `TextData` fields (sketches).**
```ts
// C4 speech bubble
tail?: { side: 'top'|'right'|'bottom'|'left'; position: number /* 0–1 along that side */; size: number }
// C5 curved text (single-line)
path?: { curvature: number /* -1..1, reuse arrow bend */ }   // gated: ignored when content wraps
// C7 terminal
mono?: { caret: boolean; caretRate?: number; chrome?: boolean }   // or fold into reveal:'line' + style
```

**C8 — clock.** Either a tiny new type `clock` with `ClockData { mode: 'elapsed'|'countdown'|'wall';
format: 'mm:ss'|'hh:mm:ss'|'frames'; from?: number }`, or `TextData.clock?` mirroring the counter
decision (OQ1). Content computed from clip-relative time (and, for `frames`, `project.fps`).

### Determinism notes (R-DET, per constraint 1)

- **C1/C8 formatting:** `Number.prototype.toLocaleString` can vary by runtime locale, which would make
  preview and export diverge on a different machine (not the same machine, but still a smell). Prefer a
  **manual formatter** (fixed decimals + inserted separators) or pass an explicit `locale`. Resolve in
  OQ2.
- **C7 caret blink / C2 per-unit timing:** derive purely from clip-relative `time` and unit index; never
  from wall clock. The existing spec-19 effects already establish this pattern.
- All candidates render inside the existing `ctx.save()/restore()` bracket in `drawObject` /
  `drawText`; any new `shadow*`/`strokeStyle`/transform must be reset before restore so it doesn't leak
  to later objects (same discipline spec 19 follows).

## Related Systems and Tasks

- **Spec 19 (text effects)** — *already implemented in the working tree* (`TextEffect` union +
  `time`-into-`drawText` plumbing + per-glyph `paintRun`). This spec is its natural sequel and reuses
  that plumbing wholesale; every animated candidate here is "another pure-fn-of-time effect, but on the
  content/layout instead of the paint."
- **Spec 18-qol R5 (rounded corners)** — C4/C9 build on the rounded background panel.
- **Spec 18-qol R6 (in-place text editing)** — any candidate that stays shape (B) inherits double-click
  editing for free; new types (C1/C3/C8) would need their own decision on whether double-click edits
  their text (probably yes for the label text; deferrable).
- **Spec 12 (animation/keyframes)** — every candidate must compose with `resolveRenderPose` (keyframes +
  enter/exit); since they all render through the same `drawObject`, this is automatic for pose, and the
  per-candidate reveal/time logic layers on top exactly as spec 19's effects do.
- **Spec 13 (camera)** — new types are affected by the camera transform for free (normalized coords);
  C3's anchor point is normalized so it tracks the zoom too. `ignoreCamera` still applies per-object.
- **Arrow tool** (`ArrowData`, `drawArrow`, bezier helpers) — C3 and C5's geometry source.
- Creation flow: `LeftRail` → `onCreateObject(type)` → `App.handleCreateObject`
  ([App.tsx:248](src/components/App.tsx#L248)) → `addObjects`. Panel: `PropertiesPanel`
  per-`obj.type` sections.

## Open Questions

- **OQ1 — counter (C1) & clock (C8): new `type` or `TextData` field?** New type = own creation button,
  timeline identity ("Counter 1"), own panel — nicer UX, ~6 wiring sites. `TextData` field = inherits
  all text styling/effects/editing for free, but "a text box in counter mode." **Recommendation: new
  `type: 'counter'` whose `draw*` delegates glyph layout to a shared text-layout helper** (identity +
  reuse). Confirm.
  - **OQ1b:** does the counter reuse `animateIn` as its count duration, or carry its own span? Reusing
    `animateIn` is elegant (the reveal *is* the count) but means you can't have a counter that also
    typewriter-reveals. Recommendation: reuse `animateIn` for v1.
- **OQ2 — number/time formatting & locale determinism.** Manual formatter vs `toLocaleString` with an
  explicit locale. Recommendation: manual formatter for full determinism + no surprise locale.
- **OQ3 — does list reveal (C6) collapse into captions (C2)?** "Reveal by line" + optional bullets may
  fully cover C6. Recommendation: ship C2 first; treat C6 as `reveal:'line'` + a `bullets?` flag, not a
  separate object.
- **OQ4 — curved text (C5) vs wrapping/autoSize.** Curved text is single-line; how do we present that
  (disable wrap when `path` set, or clamp to one line)? Decide at build time.
- **OQ5 — callout (C3) shape.** Dedicated `CalloutData`, or `TextData` + a `leader?` sub-object so a
  callout is "a text box that grew a pointer"? The latter reuses more but muddies `TextData`.
  Recommendation: dedicated `CalloutData` (it carries real extra geometry).
- **OQ6 — how many, and which, do we actually build?** This spec is a menu. Recommendation for the first
  prototype pass: **C1 (counter)** as the flagship, then **C2 (kinetic captions)** as the
  biggest-bang-for-lines, then **C3 (callout)** if we want a new interactive type. The catalogue tier
  (C4–C9) waits.
- **OQ7 — do new types drop into in-place edit on create** (like text, 18-qol R6 OQ10)? Deferrable.

## Acceptance Criteria

These are per-candidate; only the candidates we actually pick (OQ6) need to pass. Overarching:

- **AC-DET:** For every candidate built, preview and exported MP4 are **pixel-identical**, and any
  time-driven behavior (count, blink, per-unit reveal) plays in sync in the export at 30 and 60 fps.
- **AC-COMPAT:** Existing text objects render byte-identically after these changes; a project saved
  before this spec loads and looks the same.
- **AC-C1 (if built):** A counter object counts `from→to` over its window with the chosen format
  (plain/currency/percent, decimals, prefix/suffix, grouping), eases per its curve, inherits text
  styling + effects, and is undoable per edit.
- **AC-C2 (if built):** A text object set to word/line reveal pops its units in on the timeline without
  reflowing; char/wipe default is unchanged; composes with wrap/align/justify/effects.
- **AC-C3 (if built):** A callout renders a label tethered to a draggable anchor by a (optionally curved,
  optionally arrowheaded) leader; both label and anchor drag independently; the leader can draw-on.
- **AC-CATALOGUE:** Each catalogue item, if built, meets its C#-listed behavior and AC-DET/AC-COMPAT.
- **AC-BUILD:** `npx tsc -b` stays green.

## Implementation Notes

- **Sequence.** Land the (A)/(B) decision per chosen candidate first (OQ1/OQ5), then implement in the
  order C1 → C2 → C3, each as its own commit. Catalogue items are independent and additive.
- **Factor the shared glyph helper early.** Several candidates (C2 per-unit, C5 curved, C7 caret, and
  C1's number layout) want the reveal/align/justify logic that currently lives inline in `drawText`'s
  `renderLines`/`paintRun` ([annotations.ts:379-433](src/lib/annotations.ts#L379-L433)). Extracting a
  `drawLineGlyphs()` (anticipated by spec 19 OQ2) before adding the second candidate avoids duplicating
  that logic three times.
- **C1 counter touch points (shape A):** `types.ts` (union + `CounterData` + `animateIn` default +
  `defaultData` record entry is REQUIRED by the `Record<TimelineObjectType,…>` type at
  [App.tsx:249](src/components/App.tsx#L249)); `LeftRail` creation entry; `renderer.ts` switch case →
  new `drawCounter` in `annotations.ts` that formats then reuses the text layout; `PropertiesPanel`
  counter section; a manual deterministic formatter helper (OQ2).
- **C2 captions touch points (shape B):** `TextData.reveal?`/`revealStyle?` in `types.ts`; a branch in
  `drawText`'s reveal loop keyed on granularity (compute per-unit progress + offset/scale/alpha);
  panel controls in the existing text section; **no renderer/type-dispatch changes**.
- **C3 callout touch points (shape A + interaction):** everything in the new-type checklist **plus**
  `Canvas.tsx` overlay + drag for the second (anchor) handle — this is the only candidate with new
  canvas interaction, so budget for it.
- **Verify per `.claude/skills/verify`** — static checks only (`npx tsc -b`), then hand the user a
  "click X, look for Y" checklist for whichever candidates get built. Do **not** run the dev server /
  browser.

---
*Exploratory catalogue spec — a menu of candidates, not a build-all commitment. Resolve OQ6 (which to
build) with the user, then use `/task 20-new-text-objects` to implement the chosen subset.*
