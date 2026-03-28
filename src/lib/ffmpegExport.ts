import type { Project, PhotoData, AudioData, VideoData } from '../types'
import { renderFrame, loadImage } from './renderer'
import { getAssetUrl, getAssetBlob } from './assetStore'

export type ExportFormat = 'webm' | 'mp4'

/**
 * Export using the browser's native MediaRecorder + captureStream APIs.
 * Uses hardware-accelerated VP8/VP9 encoding — fast even at 1080p.
 * Audio from audio/video clips is mixed via AudioContext.
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

  // Pre-load all photo images and video elements from asset store
  const imageCache = new Map<string, HTMLImageElement | HTMLVideoElement>()
  for (const obj of objects) {
    if (obj.type === 'photo') {
      const assetId = (obj.data as PhotoData).assetId
      if (!imageCache.has(assetId)) {
        const url = getAssetUrl(assetId)
        if (url) imageCache.set(assetId, await loadImage(url))
      }
    } else if (obj.type === 'video') {
      const assetId = (obj.data as VideoData).assetId
      if (!imageCache.has(assetId)) {
        const url = getAssetUrl(assetId)
        if (url) {
          const video = document.createElement('video')
          video.src = url
          video.muted = true
          video.preload = 'auto'
          video.playsInline = true
          await new Promise<void>((resolve) => {
            video.onloadeddata = () => resolve()
            video.onerror = () => resolve()
          })
          imageCache.set(assetId, video)
        }
      }
    }
  }

  // Create a real canvas (OffscreenCanvas doesn't support captureStream)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // captureStream(0) = manual frame control via requestFrame()
  const videoStream = canvas.captureStream(0)
  const videoTrack = videoStream.getVideoTracks()[0]

  // Set up audio mixing if there are audio/video clips
  const audioVideoObjects = objects.filter(
    (o) => o.type === 'audio' || o.type === 'video'
  )

  let combinedStream: MediaStream
  let audioCtx: AudioContext | null = null

  if (audioVideoObjects.length > 0) {
    audioCtx = new AudioContext()
    const destination = audioCtx.createMediaStreamDestination()

    // Render all audio/video clips into an offline buffer approach:
    // We'll create MediaElementSourceNodes for each clip
    // But since we're doing frame-by-frame, we need to use OfflineAudioContext instead
    // to pre-render the audio mix, then play it via a buffer source during recording.

    // Pre-render the complete audio mix using OfflineAudioContext
    const sampleRate = 44100
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDuration * sampleRate), sampleRate)

    for (const obj of audioVideoObjects) {
      const data = obj.data as AudioData | VideoData
      const blob = getAssetBlob(data.assetId)
      if (!blob) continue

      try {
        const arrayBuffer = await blob.arrayBuffer()
        const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer)

        const source = offlineCtx.createBufferSource()
        source.buffer = audioBuffer

        // Playback rate
        const rate = data.originalDuration / obj.duration
        source.playbackRate.value = Math.max(0.25, Math.min(4, rate))

        // Volume
        const gain = offlineCtx.createGain()
        gain.gain.value = data.volume

        source.connect(gain)
        gain.connect(offlineCtx.destination)

        // Start at the object's start time on the timeline
        source.start(obj.startTime)
      } catch {
        // Skip clips that can't be decoded (e.g., video without audio track)
        continue
      }
    }

    const renderedBuffer = await offlineCtx.startRendering()

    // Now play the pre-rendered audio buffer through the live AudioContext
    const bufferSource = audioCtx.createBufferSource()
    bufferSource.buffer = renderedBuffer
    bufferSource.connect(destination)
    bufferSource.connect(audioCtx.destination) // also hear it (optional, helps with timing)
    bufferSource.start()

    // Combine video + audio streams
    const audioTrack = destination.stream.getAudioTracks()[0]
    combinedStream = new MediaStream([videoTrack, audioTrack])
  } else {
    combinedStream = videoStream
  }

  const chunks: Blob[] = []
  const recorder = new MediaRecorder(combinedStream, {
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

  // Collect video objects for frame-by-frame seeking
  const videoObjects = objects.filter((o) => o.type === 'video')

  for (let f = 0; f < totalFrames; f++) {
    const globalTime = f / fps

    // Seek all active video elements to the correct frame
    for (const obj of videoObjects) {
      const data = obj.data as VideoData
      const videoEl = imageCache.get(data.assetId)
      if (!videoEl || !(videoEl instanceof HTMLVideoElement)) continue

      const clipStart = obj.startTime
      const clipEnd = obj.startTime + obj.duration
      if (globalTime >= clipStart && globalTime < clipEnd) {
        const clipProgress = (globalTime - clipStart) / obj.duration
        const sourceTime = clipProgress * data.originalDuration
        videoEl.currentTime = sourceTime
        // Wait for the seek to complete so we get the correct frame
        await new Promise<void>((resolve) => {
          videoEl.onseeked = () => resolve()
          // Timeout fallback in case seeked never fires
          setTimeout(resolve, 100)
        })
      }
    }

    renderFrame(ctx, objects, globalTime, { width, height }, imageCache)

    // Push this frame into the MediaRecorder stream
    // @ts-expect-error - requestFrame exists on CanvasCaptureMediaStreamTrack
    if (videoTrack.requestFrame) videoTrack.requestFrame()

    // Delay by the frame interval so MediaRecorder gets correct timestamps
    await new Promise((r) => setTimeout(r, 1000 / fps))

    onProgress(f / totalFrames * 0.95)
  }

  recorder.stop()
  await recordingDone

  // Clean up audio context
  if (audioCtx) {
    await audioCtx.close()
  }

  onProgress(1)
  return new Blob(chunks, { type: recorder.mimeType || 'video/webm' })
}

function getSupportedMimeType(): string {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return 'video/webm'
}
