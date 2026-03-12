// === Timeline Object Types ===

export type TimelineObjectType = 'photo' | 'arrow' | 'text' | 'rectangle' | 'circle' | 'freehand'

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

  // Visual style
  style: ObjectStyle

  // Type-specific payload
  data: PhotoData | ArrowData | TextData | ShapeData | FreehandData
}

export type ObjectStyle = {
  color: string
  lineWidth: number
  opacity: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
}

export type PhotoData = {
  src: string             // base64 data URL
}

export type ArrowData = {
  points: { x: number; y: number }[]  // 0–1 relative to object's bounding box
  headSize: number
  curved: boolean
}

export type TextData = {
  content: string
  background?: string
  padding?: number
}

export type ShapeData = Record<string, never>

export type FreehandData = {
  points: { x: number; y: number }[]  // 0–1 relative to object's bounding box
}

// === Project ===

export type Project = {
  id: string
  name: string
  fps: number
  width: number
  height: number
  objects: TimelineObject[]
}

// === Interaction Modes ===

export type InteractionMode = 'select' | 'draw'

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
  | { type: 'UNDO' }
  | { type: 'REDO' }

// === Factory Functions ===

export function createDefaultProject(): Project {
  return {
    id: crypto.randomUUID(),
    name: 'Untitled Battle Report',
    fps: 30,
    width: 1920,
    height: 1080,
    objects: [],
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
    animateIn: options?.animateIn ?? (type === 'photo' ? 0 : 1),
    style: {
      color: '#FF0000',
      lineWidth: 4,
      opacity: 1,
      fontSize: 32,
      fontFamily: 'sans-serif',
      fontWeight: 'bold',
      ...options?.style,
    },
    data,
  }
}
