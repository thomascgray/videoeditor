import type { TimelineObject, ArrowData, TextData, ShapeData, FreehandData, PhotoData } from '../types'
import {
  drawArrow,
  drawText,
  drawRectangle,
  drawCircle,
  drawFreehand,
} from './annotations'

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
) {
  const { width: w, height: h } = options

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
) {
  switch (obj.type) {
    case 'photo': {
      const data = obj.data as PhotoData
      const img = imageCache.get(data.src)
      if (img) {
        const px = obj.x * w
        const py = obj.y * h
        const pw = obj.width * w
        const ph = obj.height * h
        ctx.save()
        ctx.globalAlpha = obj.style.opacity * progress
        drawImageCover(ctx, img, px, py, pw, ph)
        ctx.restore()
      }
      break
    }
    case 'arrow':
      drawArrow(ctx, obj.data as ArrowData, obj.style, progress, w, h)
      break
    case 'text':
      drawText(ctx, obj.data as TextData, obj.style, progress, w, h)
      break
    case 'rectangle':
      drawRectangle(ctx, obj.data as ShapeData, obj.style, progress, w, h)
      break
    case 'circle':
      drawCircle(ctx, obj.data as ShapeData, obj.style, progress, w, h)
      break
    case 'freehand':
      drawFreehand(ctx, obj.data as FreehandData, obj.style, progress, w, h)
      break
  }
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
