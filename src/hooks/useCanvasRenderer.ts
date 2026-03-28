import { useEffect, useRef, useCallback } from 'react'
import type { TimelineObject, PhotoData, VideoData } from '../types'
import { renderFrame, loadImage } from '../lib/renderer'
import { getAssetUrl } from '../lib/assetStore'
import type { EditorOptions } from '../lib/renderer'

export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  objects: TimelineObject[],
  globalTime: number,
  editorOptions?: EditorOptions,
) {
  // Cache holds both HTMLImageElement (photos) and HTMLVideoElement (videos)
  const imageCacheRef = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map())
  const renderCountRef = useRef(0)

  const doRender = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    renderFrame(ctx, objects, globalTime, {
      width: canvas.width,
      height: canvas.height,
    }, imageCacheRef.current, editorOptions)
  }, [canvasRef, objects, globalTime, editorOptions])

  // Load images for photo objects from asset store
  useEffect(() => {
    let cancelled = false
    const cache = imageCacheRef.current
    const photoAssetIds = objects
      .filter((o) => o.type === 'photo')
      .map((o) => (o.data as PhotoData).assetId)
      .filter((id) => !cache.has(id))

    if (photoAssetIds.length === 0) return

    ;(async () => {
      for (const assetId of photoAssetIds) {
        if (cancelled) return
        const url = getAssetUrl(assetId)
        if (!url) continue
        try {
          const img = await loadImage(url)
          cache.set(assetId, img)
        } catch {
          // skip failed images
        }
      }
      if (!cancelled) {
        renderCountRef.current++
        doRender()
      }
    })()

    return () => { cancelled = true }
  }, [objects, canvasRef, globalTime, doRender])

  // Load video elements for video objects
  useEffect(() => {
    const cache = imageCacheRef.current
    const videoAssetIds = objects
      .filter((o) => o.type === 'video')
      .map((o) => (o.data as VideoData).assetId)
      .filter((id) => !cache.has(id))

    for (const assetId of videoAssetIds) {
      const url = getAssetUrl(assetId)
      if (!url) continue
      const video = document.createElement('video')
      video.src = url
      video.muted = true // muted for canvas rendering; audio handled separately
      video.preload = 'auto'
      video.playsInline = true
      cache.set(assetId, video)
    }
  }, [objects])

  // Seek video elements to correct time and render
  useEffect(() => {
    const cache = imageCacheRef.current
    let pendingSeeks = 0

    for (const obj of objects) {
      if (obj.type !== 'video') continue
      const data = obj.data as VideoData
      const videoEl = cache.get(data.assetId)
      if (!videoEl || !(videoEl instanceof HTMLVideoElement)) continue

      const clipStart = obj.startTime
      const clipEnd = obj.startTime + obj.duration
      const isActive = globalTime >= clipStart && globalTime < clipEnd

      if (isActive) {
        // Calculate position within source media
        const clipProgress = (globalTime - clipStart) / obj.duration
        const sourceTime = clipProgress * data.originalDuration

        // Only seek if we're out of sync
        if (Math.abs(videoEl.currentTime - sourceTime) > 0.05) {
          pendingSeeks++
          const onSeeked = () => {
            videoEl.removeEventListener('seeked', onSeeked)
            pendingSeeks--
            // Re-render once all seeks complete
            if (pendingSeeks === 0) {
              doRender()
            }
          }
          videoEl.addEventListener('seeked', onSeeked)
          videoEl.currentTime = sourceTime
        }
      }
    }

    // Render immediately (with whatever frame is currently available)
    doRender()
  }, [objects, globalTime, doRender])
}
