import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type { TimelineObject, InteractionMode, ProjectAction, ArrowData, FreehandData, CameraZoom } from '../types'
import { useCanvasRenderer } from '../hooks/useCanvasRenderer'
import type { EditorOptions } from '../lib/renderer'
import { segmentControlPoint } from '../lib/annotations'
import { resolvePose, editPose, activeKeyframeIndex, keyframeColor } from '../lib/keyframes'
import { resolveCamera, cameraFrameRect, isIdentityCamera, governingZoomAt } from '../lib/camera'

const ARROW_MAX_POINTS = 10
const ZOOM_ACCENT = '#f59e0b' // amber — matches the zoom panel header

// === Types ===

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type ZoomCorner = 'nw' | 'ne' | 'se' | 'sw'

type DragState =
  | null
  | {
      kind: 'move'
      objectId: string
      startNx: number
      startNy: number
      origX: number
      origY: number
    }
  | {
      kind: 'resize'
      objectId: string
      handle: HandleId
      startNx: number
      startNy: number
      origX: number
      origY: number
      origW: number
      origH: number
      rotation: number
    }
  | {
      kind: 'rotate'
      objectId: string
      centerNx: number
      centerNy: number
      startAngle: number
      origRotation: number
    }
  | {
      kind: 'draw-freehand'
      objectId: string
    }
  | {
      // Camera-zoom framing rectangle move: shifts the focal point (spec 13).
      kind: 'zoom-move'
      zoomId: string
      startNx: number
      startNy: number
      origX: number
      origY: number
      scale: number
    }
  | {
      // Camera-zoom framing rectangle resize: changes scale about the fixed focal point.
      kind: 'zoom-resize'
      zoomId: string
      cx: number
      cy: number
    }

type CanvasProps = {
  objects: TimelineObject[]
  globalTime: number
  isPlaying: boolean
  width: number
  height: number
  selectedObjectId: string | null
  interactionMode: InteractionMode
  dispatch: React.Dispatch<ProjectAction>
  onFinishArrow?: () => void
  // Camera zooms (spec 13)
  zooms?: CameraZoom[]
  selectedZoomId: string | null
  onSelectZoom: (id: string | null) => void
  cameraView: 'frame' | 'live'
  onToggleCameraView: () => void
}

// === Constants ===

const HANDLE_SIZE = 10 // canvas pixels
const ROTATION_HANDLE_DISTANCE = 30 // canvas pixels
const HANDLE_HIT_RADIUS = 14 // canvas pixels, generous for easy clicking
const MIN_SIZE = 0.01 // minimum object size in normalized coords
const MIN_ZOOM_SCALE = 1 // full frame (spec 13: scale >= 1 only)
const MAX_ZOOM_SCALE = 20 // sanity cap for on-canvas resize

// === Coordinate Helpers ===

function clientToNorm(
  e: MouseEvent | React.MouseEvent,
  canvas: HTMLCanvasElement,
): { nx: number; ny: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    nx: (e.clientX - rect.left) / rect.width,
    ny: (e.clientY - rect.top) / rect.height,
  }
}

/**
 * Rotate a normalized point about a normalized center, performing the rotation
 * in *pixel* space. Objects are drawn with a pixel-space rotation (see
 * renderer.ts / drawOverlay), and rotation does not commute with the non-uniform
 * normalized→pixel scaling on a non-square canvas — so hit-testing must rotate
 * in pixel space too, otherwise the hit-regions drift from the drawn shape.
 */
function rotatePointAspect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angle: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dxPx = (px - cx) * canvasW
  const dyPx = (py - cy) * canvasH
  const rxPx = dxPx * cos - dyPx * sin
  const ryPx = dxPx * sin + dyPx * cos
  return { x: cx + rxPx / canvasW, y: cy + ryPx / canvasH }
}

/** Transform a point into object-local space (undo rotation around object center) */
function normToObjectLocal(
  nx: number,
  ny: number,
  obj: TimelineObject,
  canvasW: number,
  canvasH: number,
): { lx: number; ly: number } {
  const cx = obj.x + obj.width / 2
  const cy = obj.y + obj.height / 2
  const p = rotatePointAspect(nx, ny, cx, cy, -obj.rotation, canvasW, canvasH)
  return { lx: p.x, ly: p.y }
}

/** Convert normalized canvas coords to object-local 0–1 coords (within the bbox) */
function normToObjectBbox(
  nx: number,
  ny: number,
  obj: TimelineObject,
  canvasW: number,
  canvasH: number,
): { bx: number; by: number } {
  const { lx, ly } = normToObjectLocal(nx, ny, obj, canvasW, canvasH)
  return {
    bx: obj.width !== 0 ? (lx - obj.x) / obj.width : 0,
    by: obj.height !== 0 ? (ly - obj.y) / obj.height : 0,
  }
}

// === Hit Testing ===

function hitTestObject(
  nx: number,
  ny: number,
  obj: TimelineObject,
  canvasW: number,
  canvasH: number,
): boolean {
  const { lx, ly } = normToObjectLocal(nx, ny, obj, canvasW, canvasH)
  return (
    lx >= obj.x &&
    lx <= obj.x + obj.width &&
    ly >= obj.y &&
    ly <= obj.y + obj.height
  )
}

function hitTestHandles(
  nx: number,
  ny: number,
  obj: TimelineObject,
  canvasW: number,
  canvasH: number,
): HandleId | 'rotate' | null {
  const { lx, ly } = normToObjectLocal(nx, ny, obj, canvasW, canvasH)

  // Hit radius in normalized coords
  const hrx = HANDLE_HIT_RADIUS / canvasW
  const hry = HANDLE_HIT_RADIUS / canvasH

  // Check rotation handle first (above top-center)
  const rotX = obj.x + obj.width / 2
  const rotY = obj.y - ROTATION_HANDLE_DISTANCE / canvasH
  if (Math.abs(lx - rotX) < hrx && Math.abs(ly - rotY) < hry) {
    return 'rotate'
  }

  // Resize handles
  const handles: [HandleId, number, number][] = [
    ['nw', obj.x, obj.y],
    ['n', obj.x + obj.width / 2, obj.y],
    ['ne', obj.x + obj.width, obj.y],
    ['e', obj.x + obj.width, obj.y + obj.height / 2],
    ['se', obj.x + obj.width, obj.y + obj.height],
    ['s', obj.x + obj.width / 2, obj.y + obj.height],
    ['sw', obj.x, obj.y + obj.height],
    ['w', obj.x, obj.y + obj.height / 2],
  ]

  for (const [id, hx, hy] of handles) {
    if (Math.abs(lx - hx) < hrx && Math.abs(ly - hy) < hry) {
      return id
    }
  }

  return null
}

// === Resize Math ===

function computeResize(
  handle: HandleId,
  mouseNx: number,
  mouseNy: number,
  startNx: number,
  startNy: number,
  orig: { x: number; y: number; w: number; h: number; rotation: number },
  canvasW: number,
  canvasH: number,
): { x: number; y: number; width: number; height: number } {
  const cos = Math.cos(orig.rotation)
  const sin = Math.sin(orig.rotation)

  // Project mouse delta onto the object's local axes, in *pixel* space (the
  // object is rotated in pixel space), then convert the local deltas back to
  // normalized width/height changes. On a non-square canvas this differs from a
  // plain normalized-space projection by the aspect factors below.
  const dxPx = (mouseNx - startNx) * canvasW
  const dyPx = (mouseNy - startNy) * canvasH
  const localDx = (dxPx * cos + dyPx * sin) / canvasW
  const localDy = (-dxPx * sin + dyPx * cos) / canvasH

  let nx = orig.x,
    ny = orig.y,
    nw = orig.w,
    nh = orig.h

  const hasW = handle === 'w' || handle === 'nw' || handle === 'sw'
  const hasE = handle === 'e' || handle === 'ne' || handle === 'se'
  const hasN = handle === 'n' || handle === 'nw' || handle === 'ne'
  const hasS = handle === 's' || handle === 'sw' || handle === 'se'

  if (hasW) {
    nx += localDx
    nw -= localDx
  }
  if (hasE) {
    nw += localDx
  }
  if (hasN) {
    ny += localDy
    nh -= localDy
  }
  if (hasS) {
    nh += localDy
  }

  // Enforce minimum size
  if (nw < MIN_SIZE) {
    if (hasW) nx -= MIN_SIZE - nw
    nw = MIN_SIZE
  }
  if (nh < MIN_SIZE) {
    if (hasN) ny -= MIN_SIZE - nh
    nh = MIN_SIZE
  }

  // Fix anchor point: rotation is around center, so changing the box
  // shifts the center, which moves the anchor corner in world space.
  // Compute correction to keep the anchor's world position fixed.
  const oldCx = orig.x + orig.w / 2
  const oldCy = orig.y + orig.h / 2
  const newCx = nx + nw / 2
  const newCy = ny + nh / 2

  // Anchor corner position (same in both old and new local frame)
  let anchorX: number, anchorY: number
  if (handle === 'se') {
    anchorX = nx
    anchorY = ny
  } else if (handle === 'nw') {
    anchorX = nx + nw
    anchorY = ny + nh
  } else if (handle === 'ne') {
    anchorX = nx
    anchorY = ny + nh
  } else if (handle === 'sw') {
    anchorX = nx + nw
    anchorY = ny
  } else if (handle === 'n') {
    anchorX = nx + nw / 2
    anchorY = ny + nh
  } else if (handle === 's') {
    anchorX = nx + nw / 2
    anchorY = ny
  } else if (handle === 'e') {
    anchorX = nx
    anchorY = ny + nh / 2
  } else {
    // 'w'
    anchorX = nx + nw
    anchorY = ny + nh / 2
  }

  const anchorOldWorld = rotatePointAspect(
    anchorX,
    anchorY,
    oldCx,
    oldCy,
    orig.rotation,
    canvasW,
    canvasH,
  )
  const anchorNewWorld = rotatePointAspect(
    anchorX,
    anchorY,
    newCx,
    newCy,
    orig.rotation,
    canvasW,
    canvasH,
  )

  nx += anchorOldWorld.x - anchorNewWorld.x
  ny += anchorOldWorld.y - anchorNewWorld.y

  return { x: nx, y: ny, width: nw, height: nh }
}

// === Cursor Helpers ===

function getHandleCursor(
  handle: HandleId | 'rotate',
  rotation: number,
): string {
  if (handle === 'rotate') return 'crosshair'

  const baseAngles: Record<HandleId, number> = {
    n: 0,
    ne: 45,
    e: 90,
    se: 135,
    s: 180,
    sw: 225,
    w: 270,
    nw: 315,
  }

  const adjusted =
    ((baseAngles[handle] + (rotation * 180) / Math.PI) % 360 + 360) % 360

  if (adjusted < 22.5 || adjusted >= 337.5) return 'ns-resize'
  if (adjusted < 67.5) return 'nesw-resize'
  if (adjusted < 112.5) return 'ew-resize'
  if (adjusted < 157.5) return 'nwse-resize'
  if (adjusted < 202.5) return 'ns-resize'
  if (adjusted < 247.5) return 'nesw-resize'
  if (adjusted < 292.5) return 'ew-resize'
  return 'nwse-resize'
}

// === Camera-zoom framing rect (spec 13) ===
// The framing rect is axis-aligned (no rotation) and always keeps the canvas aspect ratio
// (w = h = 1/scale in normalized coords), so its editing math is much simpler than an object's.

/** Clamp a focal point so the framing rect stays fully inside the canvas [0,1]. */
function clampFocal(x: number, y: number, scale: number): { x: number; y: number } {
  const half = 0.5 / scale
  return {
    x: Math.min(Math.max(x, half), 1 - half),
    y: Math.min(Math.max(y, half), 1 - half),
  }
}

/** Which corner handle (if any) of a normalized framing rect is under the cursor. */
function hitTestZoomHandle(
  nx: number, ny: number,
  rect: { x: number; y: number; w: number; h: number },
  canvasW: number, canvasH: number,
): ZoomCorner | null {
  const hrx = HANDLE_HIT_RADIUS / canvasW
  const hry = HANDLE_HIT_RADIUS / canvasH
  const corners: [ZoomCorner, number, number][] = [
    ['nw', rect.x, rect.y],
    ['ne', rect.x + rect.w, rect.y],
    ['se', rect.x + rect.w, rect.y + rect.h],
    ['sw', rect.x, rect.y + rect.h],
  ]
  for (const [id, hx, hy] of corners) {
    if (Math.abs(nx - hx) < hrx && Math.abs(ny - hy) < hry) return id
  }
  return null
}

/** Is the cursor inside the framing rect body (normalized coords)? */
function hitTestZoomBody(
  nx: number, ny: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  return nx >= rect.x && nx <= rect.x + rect.w && ny >= rect.y && ny <= rect.y + rect.h
}

/** New scale from a corner drag, keeping the focal point (center) fixed. */
function scaleFromCornerDrag(nx: number, ny: number, cx: number, cy: number): number {
  const half = Math.max(Math.abs(nx - cx), Math.abs(ny - cy))
  const scale = half > 1e-4 ? 0.5 / half : MAX_ZOOM_SCALE
  return Math.min(Math.max(scale, MIN_ZOOM_SCALE), MAX_ZOOM_SCALE)
}

// === Component ===

export default function Canvas({
  objects,
  globalTime,
  isPlaying,
  width,
  height,
  selectedObjectId,
  interactionMode,
  dispatch,
  onFinishArrow,
  zooms,
  selectedZoomId,
  onSelectZoom,
  cameraView,
  onToggleCameraView,
}: CanvasProps) {
  const renderCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const [dragState, setDragState] = useState<DragState>(null)
  const [cursor, setCursor] = useState('default')
  const dragStateRef = useRef<DragState>(null)
  const mouseNormRef = useRef<{ nx: number; ny: number } | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const isLive = cameraView === 'live'
  const selectedZoom = zooms?.find((z) => z.id === selectedZoomId) ?? null

  // Live view applies the real camera transform (WYSIWYG == export); Frame view renders un-zoomed
  // (identity) so the whole scene stays visible + editable. Recomputed each render so it tracks the
  // playhead while playing (spec 13 R6).
  const liveCamera = useMemo(
    () => (isLive ? resolveCamera(zooms, globalTime) : undefined),
    [isLive, zooms, globalTime],
  )

  const activeDrawingObjectId = dragState?.kind === 'draw-freehand' ? dragState.objectId : null
  const editorOpts = useMemo<EditorOptions>(() => ({
    editorMode: !isLive, // Live view = WYSIWYG, no editor ghosts
    activeDrawingObjectId,
    camera: liveCamera,
  }), [isLive, activeDrawingObjectId, liveCamera])
  useCanvasRenderer(renderCanvasRef, objects, globalTime, isPlaying, width, height, editorOpts)

  // Keep dragStateRef in sync for use in event handlers
  dragStateRef.current = dragState

  // Size the overlay canvas's backing store. The render canvas is sized by useCanvasRenderer
  // (which also redraws on resize), so we only own the overlay here.
  useEffect(() => {
    const oc = overlayCanvasRef.current
    if (!oc) return
    oc.width = width
    oc.height = height
  }, [width, height])

  const selectedObjectRaw =
    objects.find((o) => o.id === selectedObjectId) ?? null
  // Overlay, hit-testing and drag operate on the keyframe-resolved pose, so the selection box
  // follows a keyframed object and dragging edits the rendered position (not a hidden static
  // base). Enter/exit transitions are intentionally NOT applied here, so the object stays
  // grabbable at its home position while its entrance/exit plays.
  const selectedObject = selectedObjectRaw
    ? resolvePose(selectedObjectRaw, globalTime)
    : null

  // When the playhead is parked on a keyframe of the selected object, tint the whole selection
  // overlay with that keyframe's color (and thicken it) so it's unmistakable that edits/drags now
  // land on that keyframe. Off a keyframe (or un-keyframed), fall back to the default blue.
  const activeKfIdx = selectedObjectRaw ? activeKeyframeIndex(selectedObjectRaw, globalTime) : -1
  const selColor = activeKfIdx >= 0 ? keyframeColor(activeKfIdx) : '#4f8ef7'
  const selWidth = activeKfIdx >= 0 ? 3 : 2

  // --- Draw overlay ---
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, width, height)

    // Canvas border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, width - 2, height - 2)

    // Live view is playback/confirmation only (R6): the render canvas already shows the real
    // transform, and editing handles are hidden. So draw no authoring chrome.
    if (isLive) return

    // --- Camera framing overlay (spec 13, Frame view) ---
    // A selected zoom shows its editable target rect (with handles); otherwise the resolved
    // camera at the playhead is shown read-only and animates as the playhead moves.
    {
      const framedPose = selectedZoom
        ? { x: selectedZoom.x, y: selectedZoom.y, scale: selectedZoom.scale }
        : resolveCamera(zooms, globalTime)
      if (selectedZoom != null || !isIdentityCamera(framedPose)) {
        const r = cameraFrameRect(framedPose)
        const rx = r.x * width, ry = r.y * height, rw = r.w * width, rh = r.h * height

        // Grey scrim over everything, punched out at the framed region.
        ctx.save()
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.fillRect(0, 0, width, height)
        ctx.clearRect(rx, ry, rw, rh)
        ctx.restore()

        // Framing rectangle border (solid + handles when selected, dashed preview otherwise).
        ctx.strokeStyle = ZOOM_ACCENT
        ctx.lineWidth = selectedZoom ? 3 : 2
        ctx.setLineDash(selectedZoom ? [] : [8, 5])
        ctx.strokeRect(rx, ry, rw, rh)
        ctx.setLineDash([])

        if (selectedZoom) {
          const hs = HANDLE_SIZE
          const corners: [number, number][] = [
            [rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh],
          ]
          for (const [hx, hy] of corners) {
            ctx.fillStyle = '#ffffff'
            ctx.strokeStyle = ZOOM_ACCENT
            ctx.lineWidth = 1.5
            ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs)
            ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs)
          }
          // Amount label tab
          const label = `⛶ ${selectedZoom.scale.toFixed(1)}×`
          ctx.font = 'bold 13px sans-serif'
          const tabW = ctx.measureText(label).width + 12
          const tabH = 18
          ctx.fillStyle = ZOOM_ACCENT
          ctx.fillRect(rx, ry - tabH, tabW, tabH)
          ctx.fillStyle = '#ffffff'
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'left'
          ctx.fillText(label, rx + 6, ry - tabH / 2 + 1)
        }
      }
    }

    if (!selectedObject) return

    // --- Arrow draw mode overlay: vertex dots + rubber band ---
    if (interactionMode === 'draw' && selectedObject.type === 'arrow') {
      const obj = selectedObject
      const data = obj.data as ArrowData
      const bx = obj.x * width
      const by = obj.y * height
      const bw = obj.width * width
      const bh = obj.height * height

      ctx.save()
      if (obj.rotation !== 0) {
        const ccx = bx + bw / 2
        const ccy = by + bh / 2
        ctx.translate(ccx, ccy)
        ctx.rotate(obj.rotation)
        ctx.translate(-ccx, -ccy)
      }

      const pixelPoints = data.points.map((p) => ({
        x: bx + p.x * bw,
        y: by + p.y * bh,
      }))

      // Draw vertex dots
      for (const pt of pixelPoints) {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
        ctx.fillStyle = obj.style.color
        ctx.fill()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Rubber band preview line from last point to cursor
      const mouse = mouseNormRef.current
      if (pixelPoints.length > 0 && mouse) {
        const last = pixelPoints[pixelPoints.length - 1]
        const cursorX = mouse.nx * width
        const cursorY = mouse.ny * height

        ctx.setLineDash([6, 4])
        ctx.strokeStyle = obj.style.color
        ctx.lineWidth = 2
        ctx.globalAlpha = 0.7

        const curvature = data.curvature ?? 0
        ctx.beginPath()
        ctx.moveTo(last.x, last.y)
        if (curvature !== 0) {
          const cp = segmentControlPoint(last.x, last.y, cursorX, cursorY, curvature)
          ctx.quadraticCurveTo(cp.x, cp.y, cursorX, cursorY)
        } else {
          ctx.lineTo(cursorX, cursorY)
        }
        ctx.stroke()

        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }

      ctx.restore()
      return
    }

    if (interactionMode !== 'move') return

    const obj = selectedObject
    const bx = obj.x * width
    const by = obj.y * height
    const bw = obj.width * width
    const bh = obj.height * height
    const cx = bx + bw / 2
    const cy = by + bh / 2

    ctx.save()

    if (obj.rotation !== 0) {
      ctx.translate(cx, cy)
      ctx.rotate(obj.rotation)
      ctx.translate(-cx, -cy)
    }

    // Bounding box
    ctx.strokeStyle = selColor
    ctx.lineWidth = selWidth
    ctx.setLineDash([])
    ctx.strokeRect(bx, by, bw, bh)

    // Keyframe badge: when parked on a keyframe, draw a filled tab in that keyframe's color so
    // it's unmistakable which keyframe is being edited.
    if (activeKfIdx >= 0) {
      const label = `◆ ${activeKfIdx + 1}`
      ctx.font = 'bold 13px sans-serif'
      const tabW = ctx.measureText(label).width + 12
      const tabH = 18
      ctx.fillStyle = selColor
      ctx.fillRect(bx, by - tabH, tabW, tabH)
      ctx.fillStyle = '#ffffff'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.fillText(label, bx + 6, by - tabH / 2 + 1)
    }

    // Resize handles
    const hs = HANDLE_SIZE
    const handlePositions = [
      { x: bx, y: by },
      { x: bx + bw / 2, y: by },
      { x: bx + bw, y: by },
      { x: bx + bw, y: by + bh / 2 },
      { x: bx + bw, y: by + bh },
      { x: bx + bw / 2, y: by + bh },
      { x: bx, y: by + bh },
      { x: bx, y: by + bh / 2 },
    ]

    for (const h of handlePositions) {
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = selColor
      ctx.lineWidth = 1.5
      ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
      ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
    }

    // Rotation handle: line from top-center to handle circle
    const rotY = by - ROTATION_HANDLE_DISTANCE
    ctx.beginPath()
    ctx.moveTo(bx + bw / 2, by)
    ctx.lineTo(bx + bw / 2, rotY)
    ctx.strokeStyle = selColor
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(bx + bw / 2, rotY, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = selColor
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Small rotation icon inside the circle
    ctx.beginPath()
    ctx.arc(bx + bw / 2, rotY, 3, -Math.PI * 0.7, Math.PI * 0.5)
    ctx.strokeStyle = selColor
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.restore()
  }, [selectedObject, interactionMode, width, height, selColor, selWidth, activeKfIdx, isLive, zooms, selectedZoom, globalTime])

  useEffect(() => {
    drawOverlay()
  }, [drawOverlay])

  // --- Mouse handlers ---

  // Helper to add a point to the current arrow
  const addArrowPoint = useCallback((nx: number, ny: number) => {
    if (!selectedObject || selectedObject.type !== 'arrow') return false
    const data = selectedObject.data as ArrowData
    if (data.points.length >= ARROW_MAX_POINTS) return false
    const { bx, by } = normToObjectBbox(nx, ny, selectedObject, width, height)
    const newPoints = [...data.points, { x: bx, y: by }]
    dispatch({
      type: 'UPDATE_OBJECT',
      objectId: selectedObject.id,
      updates: { data: { ...data, points: newPoints } },
    })
    // Auto-finish at max points
    if (newPoints.length >= ARROW_MAX_POINTS) {
      onFinishArrow?.()
    }
    return true
  }, [selectedObject, dispatch, onFinishArrow, width, height])

  // Apply an in-progress zoom framing-rect drag (move or resize) as a transient update.
  const applyZoomDrag = useCallback((ds: DragState, nx: number, ny: number) => {
    if (!ds) return
    if (ds.kind === 'zoom-move') {
      const focal = clampFocal(ds.origX + (nx - ds.startNx), ds.origY + (ny - ds.startNy), ds.scale)
      dispatch({ type: 'UPDATE_ZOOM_TRANSIENT', zoomId: ds.zoomId, updates: { x: focal.x, y: focal.y } })
    } else if (ds.kind === 'zoom-resize') {
      const scale = scaleFromCornerDrag(nx, ny, ds.cx, ds.cy)
      const focal = clampFocal(ds.cx, ds.cy, scale)
      dispatch({ type: 'UPDATE_ZOOM_TRANSIENT', zoomId: ds.zoomId, updates: { scale, x: focal.x, y: focal.y } })
    }
  }, [dispatch])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = overlayCanvasRef.current
      if (!canvas) return

      const { nx, ny } = clientToNorm(e, canvas)

      // --- Camera zoom editing (Frame view only; Live view is playback-only, R6) ---
      if (!isLive && e.button === 0) {
        if (selectedZoom) {
          const rect = cameraFrameRect({ x: selectedZoom.x, y: selectedZoom.y, scale: selectedZoom.scale })
          const corner = hitTestZoomHandle(nx, ny, rect, width, height)
          if (corner) {
            setDragState({ kind: 'zoom-resize', zoomId: selectedZoom.id, cx: selectedZoom.x, cy: selectedZoom.y })
            return
          }
          if (hitTestZoomBody(nx, ny, rect)) {
            setDragState({
              kind: 'zoom-move', zoomId: selectedZoom.id,
              startNx: nx, startNy: ny, origX: selectedZoom.x, origY: selectedZoom.y, scale: selectedZoom.scale,
            })
            return
          }
          // Clicked outside the selected zoom's rect — keep selection (deselect via Esc/timeline).
          return
        }
        // Nothing selected: clicking an active resolved framing rect selects its zoom. Guarded on
        // !selectedObject so this never steals a click meant for a selected object.
        if (!selectedObject) {
          const cam = resolveCamera(zooms, globalTime)
          if (!isIdentityCamera(cam) && hitTestZoomBody(nx, ny, cameraFrameRect(cam))) {
            const gz = governingZoomAt(zooms, globalTime)
            if (gz) {
              onSelectZoom(gz.id)
              return
            }
          }
        }
      }

      if (!selectedObject) return

      // --- Draw mode ---
      if (interactionMode === 'draw') {
        const isDrawable = selectedObject.type === 'arrow' || selectedObject.type === 'freehand'
        if (!isDrawable) return

        if (selectedObject.type === 'arrow') {
          // Left click only — right-click handled by onContextMenu
          if (e.button === 0) {
            addArrowPoint(nx, ny)
          }
        } else {
          const { bx, by } = normToObjectBbox(nx, ny, selectedObject, width, height)
          // Freehand: mousedown starts a new stroke
          const data = selectedObject.data as FreehandData
          const newStrokes = [...data.strokes, [{ x: bx, y: by }]]
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: selectedObject.id,
            updates: { data: { strokes: newStrokes } },
          })
          setDragState({ kind: 'draw-freehand', objectId: selectedObject.id })
        }
        return
      }

      if (interactionMode !== 'move') return

      // Check handles on the selected object (rotate, resize)
      const handle = hitTestHandles(nx, ny, selectedObject, width, height)

      if (handle === 'rotate') {
        const centerNx = selectedObject.x + selectedObject.width / 2
        const centerNy = selectedObject.y + selectedObject.height / 2
        const startAngle = Math.atan2(ny - centerNy, nx - centerNx)
        setDragState({
          kind: 'rotate',
          objectId: selectedObject.id,
          centerNx,
          centerNy,
          startAngle,
          origRotation: selectedObject.rotation,
        })
        return
      }

      if (handle) {
        setDragState({
          kind: 'resize',
          objectId: selectedObject.id,
          handle,
          startNx: nx,
          startNy: ny,
          origX: selectedObject.x,
          origY: selectedObject.y,
          origW: selectedObject.width,
          origH: selectedObject.height,
          rotation: selectedObject.rotation,
        })
        return
      }

      // Hit test on the selected object body for move
      if (hitTestObject(nx, ny, selectedObject, width, height)) {
        setDragState({
          kind: 'move',
          objectId: selectedObject.id,
          startNx: nx,
          startNy: ny,
          origX: selectedObject.x,
          origY: selectedObject.y,
        })
      }

      // Clicking empty space does nothing — deselect via Escape or timeline
    },
    [interactionMode, selectedObject, width, height, dispatch, isLive, selectedZoom, zooms, globalTime, onSelectZoom],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = overlayCanvasRef.current
      if (!canvas) return

      const { nx, ny } = clientToNorm(e, canvas)
      mouseNormRef.current = { nx, ny }

      // Update tooltip position (relative to the canvas container)
      const rect = canvas.getBoundingClientRect()
      setTooltipPos({ x: e.clientX - rect.left + 15, y: e.clientY - rect.top + 15 })

      const ds = dragStateRef.current

      if (ds && (ds.kind === 'zoom-move' || ds.kind === 'zoom-resize')) {
        applyZoomDrag(ds, nx, ny)
        return
      }

      if (ds) {
        // --- Active drag --- keyframe-aware: editPose cements a keyframe for a keyframed
        // property, otherwise edits the static base (see keyframes.ts).
        const dragObj = selectedObjectRaw
        const t = dragObj ? globalTime - dragObj.startTime : 0
        if (dragObj && ds.kind === 'move') {
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: ds.objectId,
            updates: editPose(dragObj, {
              x: ds.origX + (nx - ds.startNx),
              y: ds.origY + (ny - ds.startNy),
            }, t),
          })
        } else if (dragObj && ds.kind === 'resize') {
          const result = computeResize(
            ds.handle,
            nx,
            ny,
            ds.startNx,
            ds.startNy,
            {
              x: ds.origX,
              y: ds.origY,
              w: ds.origW,
              h: ds.origH,
              rotation: ds.rotation,
            },
            width,
            height,
          )
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: ds.objectId,
            updates: editPose(dragObj, result, t),
          })
        } else if (dragObj && ds.kind === 'rotate') {
          const currentAngle = Math.atan2(
            ny - ds.centerNy,
            nx - ds.centerNx,
          )
          const newRotation =
            ds.origRotation + (currentAngle - ds.startAngle)
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: ds.objectId,
            updates: editPose(dragObj, { rotation: newRotation }, t),
          })
        }
        // Redraw overlay for rubber band during drag in arrow draw mode
        if (interactionMode === 'draw' && selectedObject?.type === 'arrow') {
          drawOverlay()
        }
        return
      }

      // --- Hover cursor feedback ---
      if (isLive) {
        setCursor('default')
        return
      }

      // Zoom framing rect hover (Frame view, zoom selected)
      if (selectedZoom) {
        const rect = cameraFrameRect({ x: selectedZoom.x, y: selectedZoom.y, scale: selectedZoom.scale })
        const corner = hitTestZoomHandle(nx, ny, rect, width, height)
        if (corner) {
          setCursor(corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize')
          return
        }
        setCursor(hitTestZoomBody(nx, ny, rect) ? 'move' : 'default')
        return
      }

      if (interactionMode === 'draw') {
        setCursor('crosshair')
        // Redraw overlay for rubber band preview
        if (selectedObject?.type === 'arrow') {
          drawOverlay()
        }
        return
      }

      if (interactionMode === 'move' && selectedObject) {
        const handle = hitTestHandles(nx, ny, selectedObject, width, height)
        if (handle) {
          setCursor(getHandleCursor(handle, selectedObject.rotation))
          return
        }
        if (hitTestObject(nx, ny, selectedObject, width, height)) {
          setCursor('move')
          return
        }
      }

      setCursor('default')
    },
    [interactionMode, selectedObject, selectedObjectRaw, width, height, dispatch, drawOverlay, globalTime, applyZoomDrag, isLive, selectedZoom],
  )

  const handleMouseUp = useCallback(() => {
    if (dragStateRef.current) {
      dispatch({ type: 'COMMIT_TRANSIENT' })
      setDragState(null)
    }
  }, [dispatch])

  // Listen for mouseup/mousemove on window so dragging outside canvas works
  useEffect(() => {
    if (!dragState) return

    const onMove = (e: MouseEvent) => {
      const canvas = overlayCanvasRef.current
      if (!canvas) return

      const { nx, ny } = clientToNorm(e, canvas)
      const ds = dragStateRef.current
      if (!ds) return

      if (ds.kind === 'zoom-move' || ds.kind === 'zoom-resize') {
        applyZoomDrag(ds, nx, ny)
        return
      }

      const dragObj = objects.find((o) => o.id === ds.objectId)
      const t = dragObj ? globalTime - dragObj.startTime : 0

      if (dragObj && ds.kind === 'move') {
        dispatch({
          type: 'UPDATE_OBJECT_TRANSIENT',
          objectId: ds.objectId,
          updates: editPose(dragObj, {
            x: ds.origX + (nx - ds.startNx),
            y: ds.origY + (ny - ds.startNy),
          }, t),
        })
      } else if (dragObj && ds.kind === 'resize') {
        const result = computeResize(ds.handle, nx, ny, ds.startNx, ds.startNy, {
          x: ds.origX,
          y: ds.origY,
          w: ds.origW,
          h: ds.origH,
          rotation: ds.rotation,
        }, width, height)
        dispatch({
          type: 'UPDATE_OBJECT_TRANSIENT',
          objectId: ds.objectId,
          updates: editPose(dragObj, result, t),
        })
      } else if (dragObj && ds.kind === 'rotate') {
        const currentAngle = Math.atan2(ny - ds.centerNy, nx - ds.centerNx)
        dispatch({
          type: 'UPDATE_OBJECT_TRANSIENT',
          objectId: ds.objectId,
          updates: editPose(dragObj, {
            rotation: ds.origRotation + (currentAngle - ds.startAngle),
          }, t),
        })
      } else if (ds.kind === 'draw-freehand') {
        const obj = objects.find((o) => o.id === ds.objectId)
        if (obj) {
          const { bx, by } = normToObjectBbox(nx, ny, obj, width, height)
          const data = obj.data as FreehandData
          const lastStroke = data.strokes[data.strokes.length - 1]
          const newStrokes = [
            ...data.strokes.slice(0, -1),
            [...lastStroke, { x: bx, y: by }],
          ]
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: ds.objectId,
            updates: { data: { strokes: newStrokes } },
          })
        }
      }
    }

    const onUp = () => {
      dispatch({ type: 'COMMIT_TRANSIENT' })
      setDragState(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragState, dispatch, objects, width, height, globalTime, applyZoomDrag])

  // --- Right-click: finish arrow drawing ---
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (interactionMode === 'draw' && selectedObject?.type === 'arrow') {
        e.preventDefault()
        const data = selectedObject.data as ArrowData
        if (data.points.length >= 2) {
          onFinishArrow?.()
        }
      }
    },
    [interactionMode, selectedObject, onFinishArrow],
  )

  // --- Double-click: place final point and finish ---
  const handleDoubleClick = useCallback(
    () => {
      if (interactionMode === 'draw' && selectedObject?.type === 'arrow') {
        // The two mousedown events already added two points — remove the extra one
        const data = selectedObject.data as ArrowData
        if (data.points.length >= 2) {
          const trimmed = data.points.slice(0, -1)
          dispatch({
            type: 'UPDATE_OBJECT',
            objectId: selectedObject.id,
            updates: { data: { ...data, points: trimmed } },
          })
        }
        onFinishArrow?.()
      }
    },
    [interactionMode, selectedObject, dispatch, onFinishArrow],
  )

  // --- Mouse leave: hide tooltip ---
  const handleMouseLeave = useCallback(() => {
    setTooltipPos(null)
    mouseNormRef.current = null
  }, [])

  // --- Tooltip text ---
  const tooltipText = useMemo(() => {
    if (interactionMode !== 'draw' || selectedObject?.type !== 'arrow') return null
    const data = selectedObject.data as ArrowData
    const count = data.points.length
    const segments = Math.max(0, count - 1)
    if (count >= ARROW_MAX_POINTS - 1) return 'Click to place last point (max reached)'
    if (count === 0) return 'Click to place first point'
    if (count === 1) return 'Click to add points'
    return `Click to add points \u00b7 Right-click to finish with ${segments} segment${segments !== 1 ? 's' : ''}`
  }, [interactionMode, selectedObject])

  return (
    <div className="flex-1 flex items-center justify-center bg-gray-950 p-4 overflow-hidden">
      <div className="relative max-w-full max-h-full" style={{ aspectRatio: `${width}/${height}` }}>
        <canvas
          ref={renderCanvasRef}
          className="block w-full h-full rounded shadow-lg"
          style={{ aspectRatio: `${width}/${height}` }}
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ cursor }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
          onDoubleClick={handleDoubleClick}
          onMouseLeave={handleMouseLeave}
        />
        {tooltipText && tooltipPos && (
          <div
            className="absolute bg-black/80 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap"
            style={{ left: tooltipPos.x, top: tooltipPos.y }}
          >
            {tooltipText}
          </div>
        )}

        {/* Frame / Live camera view toggle (spec 13, R7). Frame = author un-zoomed with a framing
            rectangle; Live = the real push-in (WYSIWYG, matches export). Shortcut: V. */}
        <button
          onClick={onToggleCameraView}
          title={isLive ? 'Showing the real camera push-in — click for Frame view (V)' : 'Author view — click for Live push-in preview (V)'}
          className={`absolute top-2 right-2 px-2.5 py-1 text-xs font-semibold rounded shadow cursor-pointer transition-colors ${
            isLive
              ? 'bg-amber-500 text-black hover:bg-amber-400'
              : 'bg-gray-800/90 text-gray-200 hover:bg-gray-700'
          }`}
        >
          {isLive ? '● Live' : '○ Frame'}
        </button>
      </div>
    </div>
  )
}
