// === Timeline Object Types ===

export type TimelineObjectType = 'photo' | 'arrow' | 'text' | 'rectangle' | 'circle' | 'freehand' | 'audio' | 'video'

export type TimelineObject = {
  id: string
  type: TimelineObjectType
  name: string
  startTime: number       // global seconds
  duration: number        // seconds visible
  lane: number            // higher = renders on top (foreground)

  // Canvas positioning (normalised 0–1)
  x: number
  y: number
  width: number
  height: number
  rotation: number        // radians, rotation around center of bounding box

  // Animation
  animateIn: number       // seconds for draw-on animation (0 = instant)
  keyframes?: Keyframe[]  // optional whole-pose animation waypoints; created only via the button
  enter?: Transition      // entrance animation (fade/slide/pop) played as the object appears
  exit?: Transition       // exit animation played as the object disappears

  // Visual style
  style: ObjectStyle

  // Non-destructive visibility (spec 14 R11). When true, the object stays in the
  // project/timeline but is skipped in every render/audio/export path. Default false.
  hidden?: boolean

  // When true, the object renders at its normalized position over the FULL frame and is NOT
  // affected by the camera/zoom transform — a "pinned" overlay that stays put at any zoom.
  // Handled per-object inside renderFrame; default false.
  ignoreCamera?: boolean

  // Type-specific payload
  data: PhotoData | ArrowData | TextData | ShapeData | FreehandData | AudioData | VideoData
}

export type ObjectStyle = {
  color: string
  lineWidth: number
  opacity: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  fontStyle?: string   // 'normal' | 'italic'
}

// === Animation / Keyframes ===

export type EasingKind =
  | 'linear'
  | 'easeInQuad'  | 'easeOutQuad'  | 'easeInOutQuad'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeOutBack'
  | 'spring'

// Object properties that can be keyframed. `opacity` maps to style.opacity; the rest are top-level.
export type AnimatableProperty = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity'

// A full pose snapshot — every keyframe captures all of these; anything that changed tweens.
export type KeyframePose = Record<AnimatableProperty, number>

export type Keyframe = {
  time: number         // clip-relative seconds (relative to startTime) when this pose is reached
  pose: KeyframePose   // full snapshot of the object's pose at this keyframe
  easing: EasingKind   // curve for the segment ARRIVING at this keyframe (from the previous one)
}

// === Enter / Exit transitions ===
// Menu-driven entrance/exit animations, distinct from keyframes: they animate the object
// as it appears (near startTime) or disappears (near endTime), and do NOT create keyframes.

export type TransitionKind = 'none' | 'fade' | 'slide' | 'pop'
export type SlideDirection = 'left' | 'right' | 'top' | 'bottom'

export type Transition = {
  kind: TransitionKind
  duration: number          // seconds
  direction?: SlideDirection // slide only
  easing?: EasingKind        // optional; a kind-specific default is used when omitted
}

export type PhotoData = {
  assetId: string         // reference to asset in asset store
}

export type ArrowData = {
  points: { x: number; y: number }[]  // 0–1 relative to object's bounding box
  headSize: number
  curvature: number  // -1 to 1. 0 = straight, positive = curve right, negative = curve left
  progressiveHead: boolean  // when true, arrowhead follows the animated tip; when false, only shows at end
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify'

export type TextData = {
  content: string
  background?: string
  padding?: number
  align?: TextAlign     // horizontal alignment of wrapped lines; default 'center'
  autoSize?: boolean    // when true (default), font size is auto-fit to fill the box; when
                        // false, style.fontSize is used verbatim (lines still wrap to width)
}

export type ShapeData = Record<string, never>

export type FreehandData = {
  strokes: { x: number; y: number }[][]  // array of strokes, each stroke is points 0–1 relative to bbox
}

export type AudioData = {
  assetId: string           // reference to asset in asset store
  volume: number            // 0–1
  muted?: boolean           // when true, this clip's audio is silenced in preview AND export
  originalDuration: number  // seconds — the source file's actual duration
  waveform?: number[]       // ~200 peak values for visualization
  sourceIn?: number         // trim: source seconds where playback begins; default 0 (spec 14)
  sourceOut?: number        // trim: source seconds where playback ends; default originalDuration
}

export type VideoData = {
  assetId: string           // reference to asset in asset store
  volume: number            // 0–1
  muted?: boolean           // when true, the video's audio track is silenced (preview + export); video still shows
  originalDuration: number  // seconds — the source file's actual duration
  sourceIn?: number         // trim: source seconds where playback begins; default 0 (spec 14)
  sourceOut?: number        // trim: source seconds where playback ends; default originalDuration
}

// === Camera (spec 13) ===

// The resolved camera pose at an instant (what renderFrame consumes).
export type CameraState = {
  x: number      // normalized 0–1 focal point, held at canvas center
  y: number      // normalized 0–1
  scale: number  // >= 1 (1 = full frame, 2 = 2x punch-in)
}

// A camera pose waypoint WITHIN a zoom — lets one zoom pan/scale through several poses over its
// hold, instead of holding a single static pose. `time` is relative to the zoom's HOLD-segment
// start (startTime + transitionIn), so the ease-in/ease-out ramps stay pure. The zoom's own
// x/y/scale is the t=0 waypoint (its "home" pose). Mirrors the object Keyframe model.
export type CameraKeyframe = {
  time: number         // seconds relative to hold start; when this pose is reached
  pose: CameraState    // { x, y, scale }
  easing: EasingKind   // curve for the segment ARRIVING at this keyframe (from the previous one)
}

// One authored "zoom" — a punch-in envelope. resolveCamera compiles a list of these
// into a CameraState at each global time. Reuses spec-12 EasingKind.
export type CameraZoom = {
  id: string
  x: number              // focal point (normalized 0–1) — the home/base pose, reached at hold start
  y: number
  scale: number          // >= 1, the "amount"
  startTime: number      // global seconds — when the ease-in begins
  transitionIn: number   // seconds to ease from the CURRENT camera pose into this target
  hold: number           // seconds held (or, when keyframed, the window the pose path plays over)
  transitionOut: number  // seconds to ease back to full frame IF no next zoom takes over first
  easing: EasingKind     // spec-12 curve applied to both in and out ramps
  keyframes?: CameraKeyframe[] // optional pose path over the hold; created only via "+ Keyframe"
  hidden?: boolean       // spec 14 R11: filtered out of resolveCamera when true; default false
}
// Chaining (A->B) is expressed by TIMING: if zoom B's startTime lands while zoom A is still
// active (holding, or mid ease-out), B's transitionIn eases from A's current pose straight to B's
// target — the camera never returns to full frame between them. Leave a gap and the camera pulls
// back to full frame (via A's transitionOut) before B begins.

export const IDENTITY_CAMERA: CameraState = { x: 0.5, y: 0.5, scale: 1 }

// === Assets ===

export type AssetType = 'image' | 'audio' | 'video'

export type AssetMeta = {
  id: string
  type: AssetType
  filename: string
  mimeType: string
  size: number              // bytes
  duration?: number         // seconds, for audio/video
}

// === Project ===

export type Project = {
  id: string
  name: string
  fps: number
  width: number
  height: number
  objects: TimelineObject[]
  assets: AssetMeta[]
  zooms?: CameraZoom[]      // camera punch-ins (spec 13); optional/additive for back-compat
}

// === Interaction Modes ===

export type InteractionMode = 'move' | 'draw'

// === Actions ===

export type ProjectAction =
  | { type: 'SET_PROJECT'; project: Project }
  | { type: 'SET_NAME'; name: string }
  | { type: 'SET_DIMENSIONS'; width: number; height: number }
  | { type: 'ADD_OBJECTS'; objects: TimelineObject[] }
  | { type: 'REMOVE_OBJECT'; objectId: string }
  | { type: 'UPDATE_OBJECT'; objectId: string; updates: Partial<Omit<TimelineObject, 'id' | 'type'>> }
  | { type: 'UPDATE_OBJECT_TRANSIENT'; objectId: string; updates: Partial<Omit<TimelineObject, 'id' | 'type'>> }
  | { type: 'COMMIT_TRANSIENT' }
  | { type: 'DUPLICATE_OBJECT'; objectId: string }
  | { type: 'SPLIT_OBJECT'; objectId: string; globalTime: number }  // spec 14 R10: atomic slice-at-playhead (one undo entry)
  | { type: 'REMOVE_LANE'; lane: number }
  | { type: 'ADD_ASSETS'; assets: AssetMeta[] }
  | { type: 'ADD_ZOOM'; zoom: CameraZoom }
  | { type: 'UPDATE_ZOOM'; zoomId: string; updates: Partial<Omit<CameraZoom, 'id'>> }
  | { type: 'UPDATE_ZOOM_TRANSIENT'; zoomId: string; updates: Partial<Omit<CameraZoom, 'id'>> }
  | { type: 'REMOVE_ZOOM'; zoomId: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }

// === Factory Functions ===

export function createDefaultProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled Project',
    fps: 30,
    width: 1920,
    height: 1080,
    objects: [],
    assets: [],
  }
}

// Default parameters for a freshly-created zoom (spec 13 Open Q1 recommendations).
export function createCameraZoom(options?: Partial<Omit<CameraZoom, 'id'>>): CameraZoom {
  return {
    id: crypto.randomUUID(),
    x: options?.x ?? 0.5,
    y: options?.y ?? 0.5,
    scale: options?.scale ?? 2,
    startTime: options?.startTime ?? 0,
    transitionIn: options?.transitionIn ?? 0.6,
    hold: options?.hold ?? 2,
    transitionOut: options?.transitionOut ?? 0.6,
    easing: options?.easing ?? 'easeInOutCubic',
  }
}

const objectCounters: Record<string, number> = {}

export function createTimelineObject(
  type: TimelineObjectType,
  data: TimelineObject['data'],
  options?: {
    startTime?: number
    duration?: number
    lane?: number
    x?: number
    y?: number
    width?: number
    height?: number
    rotation?: number
    animateIn?: number
    style?: Partial<ObjectStyle>
    name?: string
  },
): TimelineObject {
  const count = (objectCounters[type] = (objectCounters[type] ?? 0) + 1)
  const defaultName = `${type.charAt(0).toUpperCase() + type.slice(1)} ${count}`

  return {
    id: crypto.randomUUID(),
    type,
    name: options?.name ?? defaultName,
    startTime: options?.startTime ?? 0,
    duration: options?.duration ?? 5,
    lane: options?.lane ?? 0,
    x: options?.x ?? 0,
    y: options?.y ?? 0,
    width: options?.width ?? 1,
    height: options?.height ?? 1,
    rotation: options?.rotation ?? 0,
    animateIn: options?.animateIn ?? (type === 'photo' || type === 'audio' || type === 'video' || type === 'text' ? 0 : 1),
    style: {
      color: '#FF0000',
      lineWidth: 8,
      opacity: 1,
      fontSize: 32,
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      fontStyle: 'normal',
      ...options?.style,
    },
    data,
  }
}
