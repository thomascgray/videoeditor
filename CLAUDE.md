# Video Editor — architecture guide

A browser-based video editor: **React 19 + TypeScript + Canvas 2D + WebCodecs**, bundled with Vite, styled with Tailwind v4. No backend — everything runs client-side; assets live in IndexedDB, projects in localStorage. Output is MP4 (H.264 + AAC) muxed in-browser with `mp4-muxer`.

> Naming gotcha: `src/lib/ffmpegExport.ts` does **not** use ffmpeg.wasm — it's the live **WebCodecs + mp4-muxer** export path (with a MediaRecorder fallback). The README is stale on this.

## Working conventions

- **Verify with `npx tsc -b`** (the build is `tsc -b && vite build`). Keep it green — there is no other typecheck gate.
- **Do NOT run the dev server or browser automation.** The user always has `npm run dev` running and tests changes in the browser themselves. After a change, run static checks and hand the user a short "click X, look for Y" checklist. (See `.claude/skills/verify/SKILL.md`.)
- `src/config.ts` → `persistProject` (default **false**): when false the app boots to an empty default project and does **not** load/save localStorage. Flip to true to persist across refreshes.
- Specs live in `SPECS/`, implementation logs in `TASKS/`. Spec 12 (animation) is **done**; 09 (video perf), 13 (camera), 14 (video trim), 15 (audio) are planned; 10 (build fixes) done; 11 (audio pitch) planned.

## The data model (`src/types.ts`)

Everything on the canvas is a flat, non-destructive **`TimelineObject`** — photos, annotations, text, audio, and video are all the same shape with a type-specific `data` payload. This single decision is why most features are a layer, not a rewrite.

```ts
type TimelineObject = {
  id: string
  type: 'photo'|'arrow'|'text'|'rectangle'|'circle'|'freehand'|'audio'|'video'
  name: string
  startTime: number   // global seconds
  duration: number    // seconds visible on the timeline
  lane: number        // higher = renders on top (z-order)
  x, y, width, height: number   // NORMALIZED 0–1 (relative to canvas)
  rotation: number    // radians, about the bbox center
  animateIn: number   // "type-on"/draw-on reveal duration (0 = instant) — see Animation
  keyframes?: Keyframe[]   // whole-pose animation waypoints (spec 12)
  enter?: Transition       // On Appear animation
  exit?: Transition        // On Exit animation
  style: ObjectStyle       // color, lineWidth, opacity, font*
  data: PhotoData | ArrowData | TextData | ShapeData | FreehandData | AudioData | VideoData
}
```

- **Coordinates are normalized 0–1**, multiplied by the canvas `width`/`height` (project dims, default 1920×1080) at draw time. This is why a camera/zoom (spec 13) is just one `ctx` transform, and why hit-testing on a non-square canvas converts to pixel space (`Canvas.tsx`).
- `data` variants: `PhotoData{assetId}`, `ArrowData{points[],headSize,curvature,progressiveHead}`, `TextData{content,background?,padding?}`, `ShapeData` (empty — rect/circle), `FreehandData{strokes[][]}`, `AudioData{assetId,volume,originalDuration,waveform?}`, `VideoData{assetId,volume,originalDuration}`.
- **No trim yet**: for audio/video, shortening `duration` **speeds the clip up** (`rate = originalDuration/duration`, clamped 0.25–4). `sourceIn`/`sourceOut` trim is planned in spec 14. This is a real model gap, not a bug.
- `Project = {id,name,fps,width,height,objects[],assets[]}`. `AssetMeta = {id,type,filename,mimeType,size,duration?}`.
- Factories: `createDefaultProject()`, `createTimelineObject(type, data, options)`.

### State & undo (`src/hooks/useProject.ts`)

A reducer over `{past[], present, future[], transientSnapshot}` (undo stack capped at 50). Dispatch `ProjectAction`s:
- `UPDATE_OBJECT` — shallow-merges `updates` into the object (`{...o, ...updates}`), so nested `data`/`style`/`keyframes` must be passed **whole**. Every dispatch = one undo entry.
- `UPDATE_OBJECT_TRANSIENT` → `COMMIT_TRANSIENT` — the pattern for a continuous gesture (drag): transient updates don't grow history; commit collapses the whole gesture into **one** undo entry. Used by canvas drag/resize and timeline bar drags.
- `ADD_OBJECTS`, `REMOVE_OBJECT`, `DUPLICATE_OBJECT` (deep-clones `data`+`keyframes` so copies are independent), `ADD_ASSETS`, `REMOVE_LANE`, `SET_PROJECT`, `SET_NAME`, `UNDO`/`REDO`.

## Rendering pipeline

**`renderFrame(ctx, objects, globalTime, {width,height}, imageCache, editorOptions?)` in `src/lib/renderer.ts` is the single, pure compositor shared by preview and export.** Change it once, both update.

1. Fills black background, filters objects to those visible at `globalTime`, sorts by `lane`.
2. Per object: `resolveRenderPose(obj, globalTime)` (see Animation) → computes `progress` from `animateIn` → `drawObject`.
3. `drawObject` applies rotation about the bbox center, then dispatches by type to the `draw*` fns in `src/lib/annotations.ts`. Photos/videos use `drawImageCover` (object-fit: cover, duck-typed to work in workers with `VideoFrame`/`ImageBitmap`/`HTMLVideoElement`).
4. `imageCache: Map<string, HTMLImageElement|HTMLVideoElement|ImageBitmap|VideoFrame>` — photos keyed by `assetId`, videos by **object id** (preview blits the shared `<video>` element; export decodes frames).

**Preview** (`src/hooks/useCanvasRenderer.ts`): pulls each video object's shared element from `mediaRegistry`, then calls `renderFrame` on a plain 2D context. Renders via a rAF loop while playing, or on state change while paused. **No DPR handling** — the canvas backing store is the raw project dims; CSS letterboxes it.

**Two canvases** (`src/components/Canvas.tsx`): a *render* canvas (goes through `renderFrame`) and a stacked *overlay* canvas (selection box, resize/rotate handles, arrow rubber-band) drawn in pixel space by `drawOverlay`. The overlay owns all mouse events. **The overlay is NOT part of `renderFrame`** — anything that transforms the render (camera, spec 13) must be mirrored in the overlay.

## Animation system (spec 12 — freshest, likely bug-fix target)

**Three independent concepts compose**, in this order inside `resolveRenderPose`:

```
base pose (obj.x/y/w/h/rotation + style.opacity)
  → keyframes (poseAt)          — whole-pose waypoints
  → enter/exit (applyTransitions) — On Appear / On Exit
  → [then drawObject applies `progress` for animateIn reveal]
```

All the logic lives in **`src/lib/keyframes.ts`** (shared by renderer, canvas, and panel). Easing curves are in **`src/lib/easing.ts`** (`ease(kind,u)` — polynomial eases hand-written, `easeOutBack`/`spring` from the `motion` library's utilities; `clamp01`, `lerp`).

### 1. `animateIn` — the "type-on" / draw-on reveal
A per-draw-fn *reveal fraction*, not a transform. `progress = min(1, elapsed/animateIn)` is passed to each `draw*` fn, which reveals a fraction of the finished shape: typewriter text, arrow draw-on, freehand point count, rect/circle grow+fade. `animateIn = 0` ⇒ `progress = 1` ⇒ appears **instantly** (no reveal). Editor mode shows a faint "ghost" of the full shape under the revealing part. Set via the draggable **`TypeOnBar`** in the panel's Timing section (track = the clip's lifespan, amber fill = reveal length; drag fully left = instant). The timeline object bar shows a **display-only stripe** for the same region — it is *not* draggable (edit it from the panel). Orthogonal to keyframes/transitions.

### 2. Enter / exit transitions — "On Appear" / "On Exit"
Menu-driven entrance/exit: `Transition = {kind: 'none'|'fade'|'slide'|'pop', duration, direction?, easing?}` on `obj.enter`/`obj.exit`. Applied by `applyTransitions` as a transform near the clip's start (`enter`) or end (`exit`): fade multiplies opacity, slide offsets x/y from off-screen, pop scales from the center. **They do NOT create keyframes** and don't pin position — so an object with only an entrance stays freely draggable. Edited in the **On Appear** / **On Exit** panel sections: kind, a **Motion** easing dropdown (`easing`; falls back to `defaultTransitionEasing(kind, phase)` when unset — the fn is exported for the panel), and a duration **slider whose track spans the whole clip lifespan** (`max = obj.duration`) with a `LifespanBar` showing the slice filled from the start (enter) / end (exit).

### 3. Keyframes — whole-pose waypoints (`Keyframe = {time, pose, easing}`)
- `KeyframePose = Record<AnimatableProperty, number>` where `AnimatableProperty = x|y|width|height|rotation|opacity`. Each keyframe is a **full pose snapshot**; anything that differs between keyframes tweens (a "morph"). There is no per-keyframe "style" — the easing IS the how.
- `time` is clip-relative seconds (when the pose is reached). `easing` shapes the segment **arriving** at that keyframe.
- **`poseAt(obj, t)`**: builds waypoints `[base@0, ...keyframes]` (a keyframe at ~0 replaces the base), finds the bracketing pair, interpolates each property with the arriving keyframe's easing; holds before first / after last.
- **`addKeyframeAt(obj, t)`** (the `+ Keyframe` button) captures the current rendered pose at the playhead (inserted sorted; updates in place if one's already at that time). This is how you start animating an un-keyframed object.
- **`editPose(obj, overrides, t)`** — the edit primitive shared by panel inputs AND canvas drag. It always lands on something concrete so you never edit a phantom mid-animation pose: **on** a keyframe → update it; at the **start** (`t ≤ KF_EPS`) → move the base/home pose (no keyframe); **anywhere else on a keyframed object → CREATE a keyframe** at the playhead capturing the current pose + edits (so the object passes through where you put it). Un-keyframed objects always edit their base pose and never spawn keyframes.
- UI (`PropertiesPanel` "Keyframes" section): a **KeyframeTrack** (mini timeline of colored diamonds + live playhead) and a **KeyframeStatus** line ("On keyframe 2" / "Between keyframe 2 and 3"), colored pips `◆ 1 ◆ 2 …` (per-index color via `keyframeColor`, click to jump), `+ Keyframe`, and for the keyframe under the playhead a **Motion** dropdown (descriptive easing labels; shapes the segment *arriving* at this keyframe) + Delete. Keyframes are **retimed by dragging their diamond on the timeline bar** (clamped between neighbors), not via a panel field.

### Keyframe color accent
`keyframeColor(i)` (in `keyframes.ts`, palette `KEYFRAME_COLORS`: red, blue, green, …) gives each keyframe index a stable color used **everywhere** — the panel pips + ring + banner, the timeline diamonds, and the canvas selection box/handles. When the playhead is parked on a keyframe (`activeKeyframeIndex`), the whole selection overlay + panel switch to that color, making "you are editing keyframe N" unmistakable.

### Canvas interaction with animation
`Canvas.tsx` derives `selectedObject = resolvePose(raw, globalTime)` — the **keyframe-resolved** pose (NOT enter/exit, so the object stays grabbable at home during an entrance). So the overlay/hit-test/drag all follow keyframed motion, and both drag dispatch paths (the canvas handler and the window-level one for dragging outside the canvas) go through `editPose`, which upserts per the rule above — on a keyframe it reshapes that keyframe (box follows text), at the start it moves the home pose, and in between it drops a new keyframe. Because the created keyframe sits at the playhead, the box turns that keyframe's color mid-drag.

## Playback, audio, media (`src/hooks/`)

- **`usePlayback`** — owns `globalTime` (state, advanced by rAF while playing), `isPlaying`, `totalDuration`, `play/pause/togglePlayback/seek`.
- **`useAudioPlayback`** — one `HTMLVideoElement`/`HTMLAudioElement` per audio/video object; syncs `currentTime` to `globalTime`, sets `playbackRate = originalDuration/duration` (0.25–4), applies `volume`, handles mute. Preview audio preserves pitch (media element default); export does not (spec 11). Registers video elements in `mediaRegistry` so the canvas can blit them.
- **`mediaRegistry.ts`** — module-level `Map<objectId, HTMLVideoElement>`; written by `useAudioPlayback`, read by `useCanvasRenderer`. One decoded element per video object.
- **`assetStore.ts`** — asset blobs in IndexedDB; `getAssetUrl/getAssetBlob`, `getMediaDuration`, `generateWaveform` (200 mono max-peaks, audio only today; video has no waveform field yet). Size warnings (`SIZE_WARN_*`).

## Export (`src/lib/ffmpegExport.ts` + worker files)

Tiered: **WebCodecs `VideoEncoder` + `mp4-muxer`** (primary, main thread) → **MediaRecorder → WebM** (non-WebCodecs browsers). Per frame it calls `renderFrame` onto a canvas, wraps it in a `VideoFrame`, encodes. Audio is pre-mixed on the main thread via `OfflineAudioContext` (sums **all** audio + video sources — confirmed multi-track), AAC-encoded. `videoDecoder.ts` (WebCodecs `VideoDecoder`) sources video frames; it handles a non-zero starting CTS. `exportWorker.ts`/`exportWorkerTypes.ts` are a **partly-dead** worker pipeline being resurrected in spec 09 (export currently runs on the main thread → UI freezes during export). `ExportModal.tsx` + `useFFmpegExport.ts` drive the UI.

## File map

| Area | Files |
|---|---|
| Types / factories | `src/types.ts` |
| Reducer / undo | `src/hooks/useProject.ts` |
| Playback | `src/hooks/usePlayback.ts`, `useAudioPlayback.ts`, `useCanvasRenderer.ts` |
| Compositor | `src/lib/renderer.ts` (shared preview+export) |
| Animation core | `src/lib/keyframes.ts` (poses/keyframes/transitions), `src/lib/easing.ts` |
| Drawing | `src/lib/annotations.ts` (arrow/text/shape/freehand + bezier math) |
| Media/assets | `src/lib/assetStore.ts`, `mediaRegistry.ts` |
| Persistence | `src/lib/projectStorage.ts` (localStorage + `.brep` zip export/import) |
| Export | `src/lib/ffmpegExport.ts`, `videoDecoder.ts`, `exportWorker.ts`, `exportWorkerTypes.ts` |
| UI | `App.tsx`, `Canvas.tsx` (viewport+overlay), `Timeline.tsx`, `PropertiesPanel.tsx`, `AnnotationTools.tsx`, `ImportModal.tsx`, `ExportModal.tsx` |

## Gotchas / current rough edges

- **60Hz re-render**: `globalTime` is React state, so playback re-renders `App`→`Canvas`→`Timeline`→`PropertiesPanel` every frame. Fine for now; spec 09 A3 addresses it for video-heavy projects.
- **No DPR handling**; canvas backing store = raw project dims.
- **Trim = speed** for audio/video (see data model). Spec 14 fixes it.
- **Export runs on the main thread** → UI freezes during export; not cancellable. Spec 09 B4/B8.
- **Overlay must mirror render transforms** — the selection overlay is a separate canvas; a camera (spec 13) needs the inverse transform for hit-testing while zoomed.
- **Editing a keyframed object auto-creates keyframes** (via `editPose`, off a keyframe and past the start) — this is intentional, *not* the old button-only model. And because keyframes are **whole-pose**, an auto-created one also freezes size/rotation/opacity at their interpolated values at that instant, not just the property you touched. Un-keyframed objects are unaffected (they only ever edit their base pose).
