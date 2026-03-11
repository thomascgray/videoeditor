import type { Project, PhotoData } from '../types'
import { renderFrame, loadImage } from './renderer'

export type ExportFormat = 'webm' | 'mp4'

/**
 * Export using the browser's native MediaRecorder + captureStream APIs.
 * Uses hardware-accelerated VP8/VP9 encoding — fast even at 1080p.
 */
export async function exportVideo(
  project: Project,
  _format: ExportFormat,
  onProgress: (pct: number) => void,
): Promise<Blob> {
  const { fps, width, height, objects } = project

  const totalDuration = objects.reduce(
    (max, obj) => Math.max(max, obj.startTime + obj.duration),
    0,
  )
  const totalFrames = Math.ceil(totalDuration * fps)
  if (totalFrames === 0) throw new Error('No frames to export')

  onProgress(0)

  // Pre-load all photo images
  const imageCache = new Map<string, HTMLImageElement>()
  for (const obj of objects) {
    if (obj.type === 'photo') {
      const src = (obj.data as PhotoData).src
      if (!imageCache.has(src)) {
        imageCache.set(src, await loadImage(src))
      }
    }
  }

  // Create a real canvas (OffscreenCanvas doesn't support captureStream)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // captureStream(0) = manual frame control via requestFrame()
  const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0]
  const chunks: Blob[] = []

  const recorder = new MediaRecorder(stream, {
    mimeType: getSupportedMimeType(),
    videoBitsPerSecond: 8_000_000,
  })

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const recordingDone = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start()

  for (let f = 0; f < totalFrames; f++) {
    const globalTime = f / fps
    renderFrame(ctx, objects, globalTime, { width, height }, imageCache)

    // Push this frame into the MediaRecorder stream
    // @ts-expect-error - requestFrame exists on CanvasCaptureMediaStreamTrack
    if (track.requestFrame) track.requestFrame()

    // Delay by the frame interval so MediaRecorder gets correct timestamps
    await new Promise((r) => setTimeout(r, 1000 / fps))

    onProgress(f / totalFrames * 0.95)
  }

  recorder.stop()
  await recordingDone

  onProgress(1)
  return new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
}

function getSupportedMimeType(): string {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return 'video/webm'
}
