import { useEffect, useRef, useCallback } from 'react'
import type { TimelineObject, PhotoData } from '../types'
import { renderFrame, loadImage } from '../lib/renderer'
import { getAssetUrl } from '../lib/assetStore'
import { getVideoElement } from '../lib/mediaRegistry'
import type { EditorOptions } from '../lib/renderer'

/**
 * Draws the timeline onto a canvas.
 *
 * Photos are loaded/cached here. Video frames come from the shared PLAYING
 * elements owned by useAudioPlayback (via mediaRegistry) — the canvas never
 * seeks them. While playing, a rAF loop blits each element's current frame, so
 * the canvas stays smooth and decoupled from React's 60Hz playback state. While
 * paused, it renders on demand (scrubbing) and after a seek settles.
 */
export function useCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  objects: TimelineObject[],
  globalTime: number,
  isPlaying: boolean,
  width: number,
  height: number,
  editorOptions?: EditorOptions,
) {
  // Photos cached by assetId; video elements are merged in per-render (by object id).
  const imageCacheRef = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map())
  const globalTimeRef = useRef(globalTime)
  globalTimeRef.current = globalTime

  const doRender = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Pull the current video element for each video object from the shared
    // registry (keyed by object id — matches renderer.ts's lookup).
    const cache = imageCacheRef.current
    for (const obj of objects) {
      if (obj.type === 'video') {
        const el = getVideoElement(obj.id)
        if (el) cache.set(obj.id, el)
      }
    }

    renderFrame(ctx, objects, globalTimeRef.current, {
      width: canvas.width,
      height: canvas.height,
    }, cache, editorOptions)
  }, [canvasRef, objects, editorOptions])

  // Own the render canvas's backing-store size. Setting canvas.width/height clears it, so we
  // resize (only when it actually changed) and immediately redraw in the same effect — otherwise
  // switching aspect ratio while paused would leave the canvas blank until the next scrub/play.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    doRender()
  }, [width, height, doRender, canvasRef])

  // Load images for photo objects from the asset store.
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
          cache.set(assetId, await loadImage(url))
        } catch {
          // skip failed images
        }
      }
      if (!cancelled) doRender()
    })()

    return () => { cancelled = true }
  }, [objects, doRender])

  // Playing: blit the playing video elements' frames via a rAF loop. No seeking,
  // and independent of React re-render frequency.
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    const loop = () => {
      doRender()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, doRender])

  // Paused: render on demand when time / objects / options change (scrubbing).
  useEffect(() => {
    if (isPlaying) return
    doRender()
  }, [isPlaying, globalTime, objects, editorOptions, doRender])

  // Paused: redraw once a scrub-seek settles on a shared element (nearest frame).
  useEffect(() => {
    if (isPlaying) return
    const els = objects
      .filter((o) => o.type === 'video')
      .map((o) => getVideoElement(o.id))
      .filter((el): el is HTMLVideoElement => el != null)
    if (els.length === 0) return

    const onSeeked = () => doRender()
    els.forEach((el) => el.addEventListener('seeked', onSeeked))
    return () => els.forEach((el) => el.removeEventListener('seeked', onSeeked))
  }, [isPlaying, objects, doRender])
}
