import type { TimelineObject, ArrowData, TextData, FreehandData, PhotoData, ObjectStyle } from '../types'
import {
  drawArrow,
  drawText,
  drawRectangle,
  drawCircle,
  drawFreehand,
} from './annotations'

export type EditorOptions = {
  editorMode?: boolean
  activeDrawingObjectId?: string | null
}

const GHOST_ALPHA = 0.25

/**
 * Render a single frame at the given global time.
 * Composites all visible objects sorted by lane (lowest = background).
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  objects: TimelineObject[],
  globalTime: number,
  options: { width: number; height: number },
  imageCache: Map<string, HTMLImageElement | ImageBitmap>,
  editorOptions?: EditorOptions,
) {
  const { width: w, height: h } = options
  const editorMode = editorOptions?.editorMode ?? false
  const activeDrawingObjectId = editorOptions?.activeDrawingObjectId ?? null

  // Black background
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)

  // Filter to visible objects and sort by lane ascending (low = back)
  const visible = objects
    .filter((obj) => globalTime >= obj.startTime && globalTime < obj.startTime + obj.duration)
    .sort((a, b) => a.lane - b.lane)

  for (const obj of visible) {
    const elapsed = globalTime - obj.startTime
    const progress = obj.animateIn > 0
      ? Math.min(1, elapsed / obj.animateIn)
      : 1

    // Active drawing object: full opacity, no ghost
    if (activeDrawingObjectId === obj.id) {
      drawObject(ctx, obj, 1.0, w, h, imageCache)
      continue
    }

    // Ghost preview: two-pass rendering for editor mode
    if (editorMode && progress < 1 && obj.type !== 'photo') {
      // Pass 1: ghost of full shape at reduced opacity
      const ghostStyle = { ...obj.style, opacity: obj.style.opacity * GHOST_ALPHA }
      drawObject(ctx, obj, 1.0, w, h, imageCache, ghostStyle)
      // Pass 2: animated portion at full opacity
      drawObject(ctx, obj, progress, w, h, imageCache)
      continue
    }

    drawObject(ctx, obj, progress, w, h, imageCache)
  }
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: TimelineObject,
  progress: number,
  w: number,
  h: number,
  imageCache: Map<string, HTMLImageElement | ImageBitmap>,
  styleOverride?: ObjectStyle,
) {
  const style = styleOverride ?? obj.style
  // Compute bounding box in pixel space
  const bx = obj.x * w
  const by = obj.y * h
  const bw = obj.width * w
  const bh = obj.height * h
  const cx = bx + bw / 2
  const cy = by + bh / 2

  // Scale factor for lineWidth/fontSize: sqrt(area ratio) relative to full canvas
  const scaleFactor = Math.sqrt((bw * bh) / (w * h))

  ctx.save()

  // Apply rotation around bounding box center
  if (obj.rotation !== 0) {
    ctx.translate(cx, cy)
    ctx.rotate(obj.rotation)
    ctx.translate(-cx, -cy)
  }

  switch (obj.type) {
    case 'photo': {
      const data = obj.data as PhotoData
      const img = imageCache.get(data.src)
      if (img) {
        ctx.globalAlpha = style.opacity * progress
        drawImageCover(ctx, img, bx, by, bw, bh)
      }
      break
    }
    case 'arrow':
      drawArrow(ctx, obj.data as ArrowData, style, progress, bx, by, bw, bh, scaleFactor)
      break
    case 'text':
      drawText(ctx, obj.data as TextData, style, progress, bx, by, bw, bh, scaleFactor)
      break
    case 'rectangle':
      drawRectangle(ctx, style, progress, bx, by, bw, bh, scaleFactor)
      break
    case 'circle':
      drawCircle(ctx, style, progress, bx, by, bw, bh, scaleFactor)
      break
    case 'freehand':
      drawFreehand(ctx, obj.data as FreehandData, style, progress, bx, by, bw, bh, scaleFactor)
      break
  }

  ctx.restore()
}

/**
 * Draw image with object-fit: cover behaviour into a target rectangle.
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | ImageBitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const imgRatio = img.width / img.height
  const targetRatio = dw / dh

  let sx = 0, sy = 0, sw = img.width, sh = img.height

  if (imgRatio > targetRatio) {
    sw = img.height * targetRatio
    sx = (img.width - sw) / 2
  } else {
    sh = img.width / targetRatio
    sy = (img.height - sh) / 2
  }

  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
