import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type { TimelineObject, InteractionMode, ProjectAction, ArrowData, FreehandData } from '../types'
import { useCanvasRenderer } from '../hooks/useCanvasRenderer'
import type { EditorOptions } from '../lib/renderer'
import { segmentControlPoint } from '../lib/annotations'

const ARROW_MAX_POINTS = 10

// === Types ===

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

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
}

// === Constants ===

const HANDLE_SIZE = 10 // canvas pixels
const ROTATION_HANDLE_DISTANCE = 30 // canvas pixels
const HANDLE_HIT_RADIUS = 14 // canvas pixels, generous for easy clicking
const MIN_SIZE = 0.01 // minimum object size in normalized coords

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
}: CanvasProps) {
  const renderCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const [dragState, setDragState] = useState<DragState>(null)
  const [cursor, setCursor] = useState('default')
  const dragStateRef = useRef<DragState>(null)
  const mouseNormRef = useRef<{ nx: number; ny: number } | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const activeDrawingObjectId = dragState?.kind === 'draw-freehand' ? dragState.objectId : null
  const editorOpts = useMemo<EditorOptions>(() => ({
    editorMode: true,
    activeDrawingObjectId,
  }), [activeDrawingObjectId])
  useCanvasRenderer(renderCanvasRef, objects, globalTime, isPlaying, editorOpts)

  // Keep dragStateRef in sync for use in event handlers
  dragStateRef.current = dragState

  // Set canvas dimensions
  useEffect(() => {
    const rc = renderCanvasRef.current
    const oc = overlayCanvasRef.current
    if (!rc || !oc) return
    rc.width = width
    rc.height = height
    oc.width = width
    oc.height = height
  }, [width, height])

  const selectedObject =
    objects.find((o) => o.id === selectedObjectId) ?? null

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
    ctx.strokeStyle = '#4f8ef7'
    ctx.lineWidth = 2
    ctx.setLineDash([])
    ctx.strokeRect(bx, by, bw, bh)

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
      ctx.strokeStyle = '#4f8ef7'
      ctx.lineWidth = 1.5
      ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
      ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
    }

    // Rotation handle: line from top-center to handle circle
    const rotY = by - ROTATION_HANDLE_DISTANCE
    ctx.beginPath()
    ctx.moveTo(bx + bw / 2, by)
    ctx.lineTo(bx + bw / 2, rotY)
    ctx.strokeStyle = '#4f8ef7'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(bx + bw / 2, rotY, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#4f8ef7'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Small rotation icon inside the circle
    ctx.beginPath()
    ctx.arc(bx + bw / 2, rotY, 3, -Math.PI * 0.7, Math.PI * 0.5)
    ctx.strokeStyle = '#4f8ef7'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.restore()
  }, [selectedObject, interactionMode, width, height])

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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = overlayCanvasRef.current
      if (!canvas) return
      if (!selectedObject) return

      const { nx, ny } = clientToNorm(e, canvas)

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
    [interactionMode, selectedObject, width, height, dispatch],
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

      if (ds) {
        // --- Active drag ---
        if (ds.kind === 'move') {
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: ds.objectId,
            updates: {
              x: ds.origX + (nx - ds.startNx),
              y: ds.origY + (ny - ds.startNy),
            },
          })
        } else if (ds.kind === 'resize') {
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
            updates: result,
          })
        } else if (ds.kind === 'rotate') {
          const currentAngle = Math.atan2(
            ny - ds.centerNy,
            nx - ds.centerNx,
          )
          const newRotation =
            ds.origRotation + (currentAngle - ds.startAngle)
          dispatch({
            type: 'UPDATE_OBJECT_TRANSIENT',
            objectId: ds.objectId,
            updates: { rotation: newRotation },
          })
        }
        // Redraw overlay for rubber band during drag in arrow draw mode
        if (interactionMode === 'draw' && selectedObject?.type === 'arrow') {
          drawOverlay()
        }
        return
      }

      // --- Hover cursor feedback ---
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
    [interactionMode, selectedObject, width, height, dispatch, drawOverlay],
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

      if (ds.kind === 'move') {
        dispatch({
          type: 'UPDATE_OBJECT_TRANSIENT',
          objectId: ds.objectId,
          updates: {
            x: ds.origX + (nx - ds.startNx),
            y: ds.origY + (ny - ds.startNy),
          },
        })
      } else if (ds.kind === 'resize') {
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
          updates: result,
        })
      } else if (ds.kind === 'rotate') {
        const currentAngle = Math.atan2(ny - ds.centerNy, nx - ds.centerNx)
        dispatch({
          type: 'UPDATE_OBJECT_TRANSIENT',
          objectId: ds.objectId,
          updates: {
            rotation: ds.origRotation + (currentAngle - ds.startAngle),
          },
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
  }, [dragState, dispatch, objects, width, height])

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
      </div>
    </div>
  )
}
