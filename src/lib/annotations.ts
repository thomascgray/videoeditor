import type { ArrowData, TextData, ShapeData, FreehandData, ObjectStyle } from '../types'

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  data: ArrowData,
  style: ObjectStyle,
  progress: number,
  w: number,
  h: number,
) {
  const points = data.points.map((p) => ({ x: p.x * w, y: p.y * h }))
  if (points.length < 2) return

  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.lineWidth
  ctx.globalAlpha = style.opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Calculate total path length
  let totalLength = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    totalLength += Math.sqrt(dx * dx + dy * dy)
  }

  const drawLength = totalLength * progress

  // Draw path up to drawLength
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)

  let accumulated = 0
  let endPoint = points[0]
  let endAngle = 0

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const segLen = Math.sqrt(dx * dx + dy * dy)

    if (accumulated + segLen <= drawLength) {
      ctx.lineTo(points[i].x, points[i].y)
      accumulated += segLen
      endPoint = points[i]
      endAngle = Math.atan2(dy, dx)
    } else {
      const remaining = drawLength - accumulated
      const t = segLen > 0 ? remaining / segLen : 0
      const x = points[i - 1].x + dx * t
      const y = points[i - 1].y + dy * t
      ctx.lineTo(x, y)
      endPoint = { x, y }
      endAngle = Math.atan2(dy, dx)
      break
    }
  }

  ctx.stroke()

  // Draw arrowhead when progress > 0.95
  if (progress > 0.95) {
    const headSize = data.headSize * (style.lineWidth / 4)
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

export function drawText(
  ctx: CanvasRenderingContext2D,
  data: TextData,
  style: ObjectStyle,
  progress: number,
  w: number,
  h: number,
) {
  const x = data.x * w
  const y = data.y * h
  const fontSize = style.fontSize ?? 32

  ctx.save()
  ctx.globalAlpha = style.opacity * progress
  ctx.font = `${style.fontWeight ?? 'bold'} ${fontSize}px ${style.fontFamily ?? 'sans-serif'}`

  const visibleText = data.content.substring(0, Math.floor(progress * data.content.length) || data.content.length)

  // Draw background if specified
  if (data.background) {
    const metrics = ctx.measureText(visibleText)
    const padding = data.padding ?? 8
    ctx.fillStyle = data.background
    ctx.fillRect(
      x - padding,
      y - fontSize - padding,
      metrics.width + padding * 2,
      fontSize + padding * 2,
    )
  }

  ctx.fillStyle = style.color
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(visibleText, x, y)
  ctx.restore()
}

export function drawRectangle(
  ctx: CanvasRenderingContext2D,
  data: ShapeData,
  style: ObjectStyle,
  progress: number,
  w: number,
  h: number,
) {
  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.lineWidth
  ctx.globalAlpha = style.opacity * progress

  const x = data.x * w
  const y = data.y * h
  const rw = data.width * w * progress
  const rh = data.height * h * progress

  ctx.strokeRect(x, y, rw, rh)
  ctx.restore()
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  data: ShapeData,
  style: ObjectStyle,
  progress: number,
  w: number,
  h: number,
) {
  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.lineWidth
  ctx.globalAlpha = style.opacity * progress

  const cx = (data.x + data.width / 2) * w
  const cy = (data.y + data.height / 2) * h
  const rx = (data.width / 2) * w
  const ry = (data.height / 2) * h

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
  w: number,
  h: number,
) {
  const points = data.points.map((p) => ({ x: p.x * w, y: p.y * h }))
  if (points.length < 2) return

  const drawCount = Math.max(2, Math.floor(points.length * progress))

  ctx.save()
  ctx.strokeStyle = style.color
  ctx.lineWidth = style.lineWidth
  ctx.globalAlpha = style.opacity
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < drawCount; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()
  ctx.restore()
}
