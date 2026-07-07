import type { ArrowData, TextData, FreehandData, ObjectStyle } from '../types'

/** Compute the quadratic bezier control point for a segment with curvature */
function segmentControlPoint(
  ax: number, ay: number, bxx: number, by: number, curvature: number,
): { x: number; y: number } {
  const mx = (ax + bxx) / 2
  const my = (ay + by) / 2
  const dx = bxx - ax
  const dy = by - ay
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return { x: mx, y: my }
  // Perpendicular (rotated 90° clockwise = right of travel direction)
  const px = dy / len
  const py = -dx / len
  const offset = curvature * len * 0.5
  return { x: mx + px * offset, y: my + py * offset }
}

/** Approximate length of a quadratic bezier by sampling */
function quadBezierLength(
  ax: number, ay: number, cpx: number, cpy: number, bx: number, by: number,
): number {
  const STEPS = 16
  let length = 0
  let prevX = ax, prevY = ay
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS
    const u = 1 - t
    const x = u * u * ax + 2 * u * t * cpx + t * t * bx
    const y = u * u * ay + 2 * u * t * cpy + t * t * by
    const dx = x - prevX, dy = y - prevY
    length += Math.sqrt(dx * dx + dy * dy)
    prevX = x
    prevY = y
  }
  return length
}

/** Evaluate a point on a quadratic bezier at parameter t */
function quadBezierAt(
  ax: number, ay: number, cpx: number, cpy: number, bx: number, by: number, t: number,
): { x: number; y: number } {
  const u = 1 - t
  return {
    x: u * u * ax + 2 * u * t * cpx + t * t * bx,
    y: u * u * ay + 2 * u * t * cpy + t * t * by,
  }
}

/** Tangent angle of a quadratic bezier at parameter t */
function quadBezierAngleAt(
  ax: number, ay: number, cpx: number, cpy: number, bx: number, by: number, t: number,
): number {
  const u = 1 - t
  // Derivative: 2(1-t)(CP-A) + 2t(B-CP)
  const tx = 2 * u * (cpx - ax) + 2 * t * (bx - cpx)
  const ty = 2 * u * (cpy - ay) + 2 * t * (by - cpy)
  return Math.atan2(ty, tx)
}

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  data: ArrowData,
  style: ObjectStyle,
  progress: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  scaleFactor: number,
) {
  const points = data.points.map((p) => ({ x: bx + p.x * bw, y: by + p.y * bh }))
  if (points.length < 2) return

  const curvature = data.curvature ?? 0

  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.lineWidth * scaleFactor
  ctx.globalAlpha = style.opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Build segments with control points and lengths
  const segments: { ax: number; ay: number; cpx: number; cpy: number; bxx: number; by: number; len: number }[] = []
  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if (curvature !== 0) {
      const cp = segmentControlPoint(a.x, a.y, b.x, b.y, curvature)
      const len = quadBezierLength(a.x, a.y, cp.x, cp.y, b.x, b.y)
      segments.push({ ax: a.x, ay: a.y, cpx: cp.x, cpy: cp.y, bxx: b.x, by: b.y, len })
      totalLength += len
    } else {
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.sqrt(dx * dx + dy * dy)
      segments.push({ ax: a.x, ay: a.y, cpx: 0, cpy: 0, bxx: b.x, by: b.y, len })
      totalLength += len
    }
  }

  const drawLength = totalLength * progress

  // Draw path up to drawLength
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)

  let accumulated = 0
  let endPoint = points[0]
  let endAngle = 0

  for (const seg of segments) {
    if (accumulated + seg.len <= drawLength) {
      if (curvature !== 0) {
        ctx.quadraticCurveTo(seg.cpx, seg.cpy, seg.bxx, seg.by)
        endAngle = quadBezierAngleAt(seg.ax, seg.ay, seg.cpx, seg.cpy, seg.bxx, seg.by, 1)
      } else {
        ctx.lineTo(seg.bxx, seg.by)
        endAngle = Math.atan2(seg.by - seg.ay, seg.bxx - seg.ax)
      }
      accumulated += seg.len
      endPoint = { x: seg.bxx, y: seg.by }
    } else {
      const remaining = drawLength - accumulated
      const t = seg.len > 0 ? remaining / seg.len : 0
      if (curvature !== 0) {
        // Split bezier at t and draw the first portion
        // De Casteljau split: draw up to parameter t
        const pt = quadBezierAt(seg.ax, seg.ay, seg.cpx, seg.cpy, seg.bxx, seg.by, t)
        // Control point for the first half: lerp(A, CP, t)
        const cp1x = seg.ax + (seg.cpx - seg.ax) * t
        const cp1y = seg.ay + (seg.cpy - seg.ay) * t
        ctx.quadraticCurveTo(cp1x, cp1y, pt.x, pt.y)
        endPoint = pt
        endAngle = quadBezierAngleAt(seg.ax, seg.ay, seg.cpx, seg.cpy, seg.bxx, seg.by, t)
      } else {
        const x = seg.ax + (seg.bxx - seg.ax) * t
        const y = seg.ay + (seg.by - seg.ay) * t
        ctx.lineTo(x, y)
        endPoint = { x, y }
        endAngle = Math.atan2(seg.by - seg.ay, seg.bxx - seg.ax)
      }
      break
    }
  }

  ctx.stroke()

  // Draw arrowhead
  const showHead = data.progressiveHead ? progress > 0 : progress > 0.95
  if (showHead) {
    const headSize = data.headSize * (style.lineWidth * scaleFactor / 4)
    ctx.beginPath()
    ctx.moveTo(endPoint.x, endPoint.y)
    ctx.lineTo(
      endPoint.x - headSize * Math.cos(endAngle - Math.PI / 6),
      endPoint.y - headSize * Math.sin(endAngle - Math.PI / 6),
    )
    ctx.moveTo(endPoint.x, endPoint.y)
    ctx.lineTo(
      endPoint.x - headSize * Math.cos(endAngle + Math.PI / 6),
      endPoint.y - headSize * Math.sin(endAngle + Math.PI / 6),
    )
    ctx.stroke()
  }

  ctx.restore()
}

/** Export curve helpers for use in overlay drawing */
export { segmentControlPoint, quadBezierAt }

export function drawText(
  ctx: CanvasRenderingContext2D,
  data: TextData,
  style: ObjectStyle,
  progress: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  scaleFactor: number,
) {
  const fontSize = (style.fontSize ?? 32) * scaleFactor
  const lineHeight = fontSize * 1.25

  ctx.save()
  ctx.globalAlpha = style.opacity
  ctx.font = `${style.fontWeight ?? 'bold'} ${fontSize}px ${style.fontFamily ?? 'sans-serif'}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  const full = data.content ?? ''
  // Typewriter reveal: round so progress=1 shows the whole string and
  // progress=0 shows nothing (no whole-word flash on the first frame).
  const charCount = Math.max(0, Math.min(full.length, Math.round(progress * full.length)))
  const visibleText = full.substring(0, charCount)

  const visibleLines = visibleText.split('\n')
  const x = bx + bw / 2
  const cy = by + bh / 2

  // Draw background sized to the FINAL text so the box doesn't grow as
  // letters type on.
  if (data.background) {
    const allLines = full.split('\n')
    let maxW = 0
    for (const line of allLines) maxW = Math.max(maxW, ctx.measureText(line).width)
    const padding = (data.padding ?? 8) * scaleFactor
    const boxH = allLines.length * lineHeight
    ctx.fillStyle = data.background
    ctx.fillRect(
      x - maxW / 2 - padding,
      cy - boxH / 2 - padding,
      maxW + padding * 2,
      boxH + padding * 2,
    )
  }

  ctx.fillStyle = style.color
  const totalH = (visibleLines.length - 1) * lineHeight
  const startY = cy - totalH / 2
  visibleLines.forEach((line, i) => {
    ctx.fillText(line, x, startY + i * lineHeight)
  })
  ctx.restore()
}

export function drawRectangle(
  ctx: CanvasRenderingContext2D,
  style: ObjectStyle,
  progress: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  scaleFactor: number,
) {
  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.lineWidth * scaleFactor
  ctx.globalAlpha = style.opacity * progress

  const rw = bw * progress
  const rh = bh * progress

  ctx.strokeRect(bx, by, rw, rh)
  ctx.restore()
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  style: ObjectStyle,
  progress: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  scaleFactor: number,
) {
  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.lineWidth * scaleFactor
  ctx.globalAlpha = style.opacity * progress

  const cx = bx + bw / 2
  const cy = by + bh / 2
  const rx = bw / 2
  const ry = bh / 2

  ctx.beginPath()
  ctx.ellipse(cx, cy, rx * progress, ry * progress, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function drawFreehand(
  ctx: CanvasRenderingContext2D,
  data: FreehandData,
  style: ObjectStyle,
  progress: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  scaleFactor: number,
) {
  const totalPoints = data.strokes.reduce((sum, s) => sum + s.length, 0)
  if (totalPoints < 2) return

  const drawCount = Math.max(2, Math.floor(totalPoints * progress))

  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.lineWidth * scaleFactor
  ctx.globalAlpha = style.opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  let drawn = 0
  for (const stroke of data.strokes) {
    if (drawn >= drawCount) break
    if (stroke.length === 0) continue

    const pts = stroke.map((p) => ({ x: bx + p.x * bw, y: by + p.y * bh }))
    const canDraw = Math.min(pts.length, drawCount - drawn)

    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < canDraw; i++) {
      ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.stroke()
    drawn += canDraw
  }

  ctx.restore()
}
