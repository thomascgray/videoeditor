import type { TimelineObject, ArrowData, TextData, FreehandData, PhotoData, VideoData, ObjectStyle } from '../types'
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
  imageCache: Map<string, HTMLImageElement | HTMLVideoElement | ImageBitmap | VideoFrame>,
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
  imageCache: Map<string, HTMLImageElement | HTMLVideoElement | ImageBitmap | VideoFrame>,
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

  // Scale factor for lineWidth/fontSize: based on canvas resolution (not object bbox)
  // so that all objects at the same lineWidth render at the same visual thickness
  const REF_AREA = 1920 * 1080
  const scaleFactor = Math.sqrt((w * h) / REF_AREA)

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
      const img = imageCache.get(data.assetId)
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
    case 'video': {
      const vdata = obj.data as VideoData
      const videoEl = imageCache.get(vdata.assetId)
      if (videoEl) {
        ctx.globalAlpha = style.opacity * progress
        drawImageCover(ctx, videoEl, bx, by, bw, bh)
      }
      break
    }
    case 'audio':
      // Audio has no visual representation on canvas
      break
  }

  ctx.restore()
}

/**
 * Draw image with object-fit: cover behaviour into a target rectangle.
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLVideoElement | ImageBitmap | VideoFrame,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  // Use duck-typing for DOM types so this works in Web Workers too
  const imgW = img instanceof VideoFrame ? img.displayWidth
    : 'videoWidth' in img ? (img as HTMLVideoElement).videoWidth
    : img.width
  const imgH = img instanceof VideoFrame ? img.displayHeight
    : 'videoHeight' in img ? (img as HTMLVideoElement).videoHeight
    : img.height
  if (imgW === 0 || imgH === 0) return
  const imgRatio = imgW / imgH
  const targetRatio = dw / dh

  let sx = 0, sy = 0, sw = imgW, sh = imgH

  if (imgRatio > targetRatio) {
    sw = imgH * targetRatio
    sx = (imgW - sw) / 2
  } else {
    sh = imgW / targetRatio
    sy = (imgH - sh) / 2
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
