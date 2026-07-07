import type { Project, PhotoData, AudioData, VideoData } from '../types'
import { renderFrame, loadImage } from './renderer'
import { getAssetUrl, getAssetBlob } from './assetStore'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

/**
 * Check if this browser supports WebCodecs VideoEncoder.
 */
function hasWebCodecsSupport(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined'
  )
}

/**
 * Export video as MP4 (WebCodecs) or WebM (MediaRecorder fallback).
 */
export async function exportVideo(
  project: Project,
  onProgress: (pct: number) => void,
): Promise<Blob> {
  if (hasWebCodecsSupport()) {
    return exportWithWebCodecs(project, onProgress)
  }
  return exportWithMediaRecorder(project, onProgress)
}

// ---------------------------------------------------------------------------
// WebCodecs Pipeline (main thread — uses HTMLVideoElement for video frames)
// ---------------------------------------------------------------------------

/** Stored chunk for deferred muxing (mp4-muxer needs audio config at construction) */
type StoredChunk = {
  data: Uint8Array
  type: 'key' | 'delta'
  timestamp: number
  duration: number
  meta?: EncodedVideoChunkMetadata | EncodedAudioChunkMetadata
}

async function exportWithWebCodecs(
  project: Project,
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

  // --- Load photos + video elements (same as preview/old export) ---
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

  // --- Set up canvas ---
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  // --- Find a supported H.264 encoder config ---
  const encoderConfig = await findSupportedVideoCodec(width, height, fps)

  // --- Encode video frames ---
  const videoChunks: StoredChunk[] = []

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      const buf = new Uint8Array(chunk.byteLength)
      chunk.copyTo(buf)
      videoChunks.push({
        data: buf,
        type: chunk.type,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? 0,
        meta: meta ?? undefined,
      })
    },
    error: (e) => { throw new Error(`VideoEncoder error: ${e.message}`) },
  })

  videoEncoder.configure(encoderConfig)

  const videoObjects = objects.filter((o) => o.type === 'video')

  for (let f = 0; f < totalFrames; f++) {
    const globalTime = f / fps
    const timestampUs = Math.round(globalTime * 1_000_000)

    // Seek video elements to correct source time
    for (const obj of videoObjects) {
      const data = obj.data as VideoData
      const videoEl = imageCache.get(data.assetId)
      if (!videoEl || !(videoEl instanceof HTMLVideoElement)) continue

      const clipStart = obj.startTime
      const clipEnd = obj.startTime + obj.duration
      if (globalTime >= clipStart && globalTime < clipEnd) {
        const clipProgress = (globalTime - clipStart) / obj.duration
        const sourceTime = clipProgress * data.originalDuration
        const timeDiff = Math.abs(videoEl.currentTime - sourceTime)

        if (timeDiff > 0.5) {
          // Large jump (clip start, or non-sequential) — full seek + wait
          videoEl.currentTime = sourceTime
          await new Promise<void>((resolve) => {
            videoEl.onseeked = () => resolve()
            setTimeout(resolve, 50)
          })
        } else if (timeDiff > 0.01) {
          // Small sequential advance — set time, brief yield for decode
          videoEl.currentTime = sourceTime
          await new Promise<void>((r) => setTimeout(r, 0))
        }
        // else: already at right time, no seek needed
      }
    }

    // Composite all objects onto canvas
    renderFrame(ctx, objects, globalTime, { width, height }, imageCache)

    // Encode canvas as video frame (no real-time delay!)
    const frame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / fps),
    })

    const isKeyFrame = f % Math.round(fps * 2) === 0
    videoEncoder.encode(frame, { keyFrame: isKeyFrame })
    frame.close()

    // Backpressure
    while (videoEncoder.encodeQueueSize > 10) {
      await new Promise<void>((r) => {
        videoEncoder.addEventListener('dequeue', () => r(), { once: true })
      })
    }

    onProgress((f / totalFrames) * 0.85)
  }

  await videoEncoder.flush()
  videoEncoder.close()

  onProgress(0.88)

  // --- Pre-render audio mix ---
  const audioChunks: StoredChunk[] = []
  const audioVideoObjects = objects.filter(
    (o) => o.type === 'audio' || o.type === 'video',
  )

  let audioSampleRate = 48000
  let audioChannels = 2

  if (audioVideoObjects.length > 0) {
    const sampleRate = 48000
    const offlineCtx = new OfflineAudioContext(
      2,
      Math.ceil(totalDuration * sampleRate),
      sampleRate,
    )

    for (const obj of audioVideoObjects) {
      const data = obj.data as AudioData | VideoData
      const blob = getAssetBlob(data.assetId)
      if (!blob) continue

      try {
        const arrayBuffer = await blob.arrayBuffer()
        const decoded = await offlineCtx.decodeAudioData(arrayBuffer)

        const source = offlineCtx.createBufferSource()
        source.buffer = decoded

        const rate = data.originalDuration / obj.duration
        source.playbackRate.value = Math.max(0.25, Math.min(4, rate))

        const gain = offlineCtx.createGain()
        gain.gain.value = data.volume

        source.connect(gain)
        gain.connect(offlineCtx.destination)
        source.start(obj.startTime)
      } catch {
        continue
      }
    }

    const audioBuffer = await offlineCtx.startRendering()
    audioSampleRate = audioBuffer.sampleRate
    audioChannels = audioBuffer.numberOfChannels

    // Encode audio with AudioEncoder
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        const buf = new Uint8Array(chunk.byteLength)
        chunk.copyTo(buf)
        audioChunks.push({
          data: buf,
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration ?? 0,
          meta: meta ?? undefined,
        })
      },
      error: (e) => { throw new Error(`AudioEncoder error: ${e.message}`) },
    })

    audioEncoder.configure({
      codec: 'mp4a.40.2', // AAC-LC
      numberOfChannels: audioChannels,
      sampleRate: audioSampleRate,
      bitrate: 128_000,
    })

    const frameSize = 1024
    const totalSamples = audioBuffer.length

    for (let offset = 0; offset < totalSamples; offset += frameSize) {
      const numSamples = Math.min(frameSize, totalSamples - offset)

      const planarData = new Float32Array(numSamples * audioChannels)
      for (let ch = 0; ch < audioChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch)
        planarData.set(
          channelData.subarray(offset, offset + numSamples),
          ch * numSamples,
        )
      }

      const audioFrame = new AudioData({
        format: 'f32-planar',
        sampleRate: audioSampleRate,
        numberOfFrames: numSamples,
        numberOfChannels: audioChannels,
        timestamp: Math.round((offset / audioSampleRate) * 1_000_000),
        data: planarData,
      })

      audioEncoder.encode(audioFrame)
      audioFrame.close()
    }

    await audioEncoder.flush()
    audioEncoder.close()
  }

  onProgress(0.93)

  // --- Mux video + audio into MP4 ---
  const hasAudio = audioChunks.length > 0

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    ...(hasAudio ? {
      audio: {
        codec: 'aac',
        numberOfChannels: audioChannels,
        sampleRate: audioSampleRate,
      },
    } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })

  for (const chunk of videoChunks) {
    muxer.addVideoChunkRaw(
      chunk.data, chunk.type, chunk.timestamp, chunk.duration,
      chunk.meta as EncodedVideoChunkMetadata,
    )
  }

  for (const chunk of audioChunks) {
    muxer.addAudioChunkRaw(
      chunk.data, chunk.type, chunk.timestamp, chunk.duration,
      chunk.meta as EncodedAudioChunkMetadata,
    )
  }

  muxer.finalize()

  onProgress(1)

  const outputBuffer = (muxer.target as ArrayBufferTarget).buffer
  return new Blob([outputBuffer], { type: 'video/mp4' })
}

/**
 * Try H.264 codec strings from most to least capable,
 * returning the first supported encoder config.
 */
async function findSupportedVideoCodec(
  width: number,
  height: number,
  framerate: number,
): Promise<VideoEncoderConfig> {
  const codecs = [
    'avc1.640028', // High Profile, Level 4.0
    'avc1.4d0028', // Main Profile, Level 4.0
    'avc1.420028', // Baseline Profile, Level 4.0
    'avc1.640020', // High Profile, Level 3.0
    'avc1.4d0020', // Main Profile, Level 3.0
    'avc1.420020', // Baseline Profile, Level 3.0
  ]

  for (const codec of codecs) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate: 8_000_000,
      framerate,
    }

    try {
      const support = await VideoEncoder.isConfigSupported(config)
      if (support.supported) return support.config!
    } catch {
      // try next
    }
  }

  throw new Error(
    'No supported H.264 encoder found in this browser.',
  )
}

// ---------------------------------------------------------------------------
// MediaRecorder Fallback (for browsers without WebCodecs)
// ---------------------------------------------------------------------------

async function exportWithMediaRecorder(
  project: Project,
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

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const videoStream = canvas.captureStream(0)
  const videoTrack = videoStream.getVideoTracks()[0]

  const audioVideoObjects = objects.filter(
    (o) => o.type === 'audio' || o.type === 'video',
  )

  let combinedStream: MediaStream
  let audioCtx: AudioContext | null = null

  if (audioVideoObjects.length > 0) {
    audioCtx = new AudioContext()
    const destination = audioCtx.createMediaStreamDestination()

    const sampleRate = 44100
    const offlineCtx = new OfflineAudioContext(
      2,
      Math.ceil(totalDuration * sampleRate),
      sampleRate,
    )

    for (const obj of audioVideoObjects) {
      const data = obj.data as AudioData | VideoData
      const blob = getAssetBlob(data.assetId)
      if (!blob) continue

      try {
        const arrayBuffer = await blob.arrayBuffer()
        const decoded = await offlineCtx.decodeAudioData(arrayBuffer)

        const source = offlineCtx.createBufferSource()
        source.buffer = decoded

        const rate = data.originalDuration / obj.duration
        source.playbackRate.value = Math.max(0.25, Math.min(4, rate))

        const gain = offlineCtx.createGain()
        gain.gain.value = data.volume

        source.connect(gain)
        gain.connect(offlineCtx.destination)
        source.start(obj.startTime)
      } catch {
        continue
      }
    }

    const renderedBuffer = await offlineCtx.startRendering()

    const bufferSource = audioCtx.createBufferSource()
    bufferSource.buffer = renderedBuffer
    bufferSource.connect(destination)
    bufferSource.connect(audioCtx.destination)
    bufferSource.start()

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

  const videoObjects = objects.filter((o) => o.type === 'video')

  for (let f = 0; f < totalFrames; f++) {
    const globalTime = f / fps

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
        await new Promise<void>((resolve) => {
          videoEl.onseeked = () => resolve()
          setTimeout(resolve, 100)
        })
      }
    }

    renderFrame(ctx, objects, globalTime, { width, height }, imageCache)

    // @ts-expect-error - requestFrame exists on CanvasCaptureMediaStreamTrack
    if (videoTrack.requestFrame) videoTrack.requestFrame()

    await new Promise((r) => setTimeout(r, 1000 / fps))

    onProgress((f / totalFrames) * 0.95)
  }

  recorder.stop()
  await recordingDone

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
