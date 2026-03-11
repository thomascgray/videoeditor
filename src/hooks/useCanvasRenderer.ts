import { useEffect, useRef } from 'react'
import type { TimelineObject, PhotoData } from '../types'
import { renderFrame, loadImage } from '../lib/renderer'

export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  objects: TimelineObject[],
  globalTime: number,
) {
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const renderCountRef = useRef(0)

  // Load images for photo objects, then trigger re-render
  useEffect(() => {
    let cancelled = false
    const cache = imageCacheRef.current
    const photoSrcs = objects
      .filter((o) => o.type === 'photo')
      .map((o) => (o.data as PhotoData).src)
      .filter((src) => !cache.has(src))

    if (photoSrcs.length === 0) return

    ;(async () => {
      for (const src of photoSrcs) {
        if (cancelled) return
        try {
          const img = await loadImage(src)
          cache.set(src, img)
        } catch {
          // skip failed images
        }
      }
      if (!cancelled) {
        // Force a re-render by bumping ref and dispatching a render
        renderCountRef.current++
        const canvas = canvasRef.current
        if (canvas) {
          const ctx = canvas.getContext('2d')
          if (ctx) {
            renderFrame(ctx, objects, globalTime, {
              width: canvas.width,
              height: canvas.height,
            }, cache)
          }
        }
      }
    })()

    return () => { cancelled = true }
  }, [objects, canvasRef, globalTime])

  // Render frame on every time/objects change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    renderFrame(ctx, objects, globalTime, {
      width: canvas.width,
      height: canvas.height,
    }, imageCacheRef.current)
  }, [canvasRef, objects, globalTime])
}
