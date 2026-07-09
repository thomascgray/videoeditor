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

export type TextData = {
  content: string
  background?: string
  padding?: number
}

export type ShapeData = Record<string, never>

export type FreehandData = {
  strokes: { x: number; y: number }[][]  // array of strokes, each stroke is points 0–1 relative to bbox
}

export type AudioData = {
  assetId: string           // reference to asset in asset store
  volume: number            // 0–1
  originalDuration: number  // seconds — the source file's actual duration
  waveform?: number[]       // ~200 peak values for visualization
}

export type VideoData = {
  assetId: string           // reference to asset in asset store
  volume: number            // 0–1
  originalDuration: number  // seconds — the source file's actual duration
}

// === Camera (spec 13) ===

// The resolved camera pose at an instant (what renderFrame consumes).
export type CameraState = {
  x: number      // normalized 0–1 focal point, held at canvas center
  y: number      // normalized 0–1
  scale: number  // >= 1 (1 = full frame, 2 = 2x punch-in)
}

// One authored "zoom" — a punch-in envelope. resolveCamera compiles a list of these
// into a CameraState at each global time. Reuses spec-12 EasingKind.
export type CameraZoom = {
  id: string
  x: number              // focal point (normalized 0–1)
  y: number
  scale: number          // >= 1, the "amount"
  startTime: number      // global seconds — when the ease-in begins
  transitionIn: number   // seconds to ease from the CURRENT camera pose into this target
  hold: number           // seconds held fully zoomed
  transitionOut: number  // seconds to ease back to full frame IF no next zoom takes over first
  easing: EasingKind     // spec-12 curve applied to both in and out ramps
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
  | { type: 'ADD_OBJECTS'; objects: TimelineObject[] }
  | { type: 'REMOVE_OBJECT'; objectId: string }
  | { type: 'UPDATE_OBJECT'; objectId: string; updates: Partial<Omit<TimelineObject, 'id' | 'type'>> }
  | { type: 'UPDATE_OBJECT_TRANSIENT'; objectId: string; updates: Partial<Omit<TimelineObject, 'id' | 'type'>> }
  | { type: 'COMMIT_TRANSIENT' }
  | { type: 'DUPLICATE_OBJECT'; objectId: string }
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
    animateIn: options?.animateIn ?? (type === 'photo' || type === 'audio' || type === 'video' ? 0 : 1),
    style: {
      color: '#FF0000',
      lineWidth: 8,
      opacity: 1,
      fontSize: 32,
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      ...options?.style,
    },
    data,
  }
}
