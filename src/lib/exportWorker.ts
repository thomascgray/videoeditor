import type { PhotoData, VideoData, Project } from '../types'
import type { ExportWorkerRequest, ExportWorkerResponse, RenderedAudio } from './exportWorkerTypes'
import { renderFrame } from './renderer'
import { createVideoFrameSource, type VideoFrameSource } from './videoDecoder'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

// ---------------------------------------------------------------------------
// Stored chunk types for deferred muxing
// ---------------------------------------------------------------------------

type StoredVideoChunk = {
  data: Uint8Array
  type: 'key' | 'delta'
  timestamp: number
  duration: number
  meta?: EncodedVideoChunkMetadata
}

type StoredAudioChunk = {
  data: Uint8Array
  type: 'key' | 'delta'
  timestamp: number
  duration: number
  meta?: EncodedAudioChunkMetadata
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

function sendMessage(msg: ExportWorkerResponse) {
  self.postMessage(msg)
}

function sendProgress(pct: number) {
  sendMessage({ type: 'progress', pct })
}

self.onmessage = async (e: MessageEvent<ExportWorkerRequest>) => {
  const { type } = e.data
  if (type !== 'start') return

  try {
    const blob = await runExport(e.data.project, e.data.assetBlobs, e.data.audio)
    sendMessage({ type: 'done', blob })
  } catch (err) {
    sendMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Export failed',
    })
  }
}

// ---------------------------------------------------------------------------
// Export pipeline (runs entirely in the worker)
// ---------------------------------------------------------------------------

async function runExport(
  project: Project,
  assetBlobEntries: Array<[string, Blob]>,
  audio: RenderedAudio | null,
): Promise<Blob> {
  const { fps, width, height, objects } = project
  const assetBlobs = new Map(assetBlobEntries)

  const totalDuration = objects.reduce(
    (max, obj) => Math.max(max, obj.startTime + obj.duration),
    0,
  )
  const totalFrames = Math.ceil(totalDuration * fps)
  if (totalFrames === 0) throw new Error('No frames to export')

  sendProgress(0)

  // --- Load photos as ImageBitmap + initialize video decoders ---
  const imageCache = new Map<string, ImageBitmap | VideoFrame>()
  const videoDecoders = new Map<string, VideoFrameSource>()

  for (const obj of objects) {
    if (obj.type === 'photo') {
      const assetId = (obj.data as PhotoData).assetId
      if (!imageCache.has(assetId)) {
        const blob = assetBlobs.get(assetId)
        if (blob) {
          const bitmap = await createImageBitmap(blob)
          imageCache.set(assetId, bitmap)
        }
      }
    } else if (obj.type === 'video') {
      const assetId = (obj.data as VideoData).assetId
      if (!videoDecoders.has(assetId)) {
        const blob = assetBlobs.get(assetId)
        if (blob) {
          const source = await createVideoFrameSource(blob)
          videoDecoders.set(assetId, source)
        }
      }
    }
  }

  // --- Set up OffscreenCanvas ---
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!

  // Audio is pre-rendered on the main thread (OfflineAudioContext isn't available in workers)
  // and passed in as raw Float32Array channel data

  // --- Find a supported H.264 codec ---
  const codecConfig = await findSupportedVideoCodec(width, height, fps)

  // --- Encode video frames ---
  const videoChunks: StoredVideoChunk[] = []

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

  videoEncoder.configure(codecConfig)

  const videoObjects = objects.filter((o) => o.type === 'video')

  for (let f = 0; f < totalFrames; f++) {
    const globalTime = f / fps
    const timestampUs = Math.round(globalTime * 1_000_000)

    // Seek video decoders and put frames in imageCache
    for (const obj of videoObjects) {
      const data = obj.data as VideoData
      const decoder = videoDecoders.get(data.assetId)
      if (!decoder) continue

      const clipStart = obj.startTime
      const clipEnd = obj.startTime + obj.duration
      if (globalTime >= clipStart && globalTime < clipEnd) {
        const clipProgress = (globalTime - clipStart) / obj.duration
        const sourceTime = clipProgress * data.originalDuration

        const frame = await decoder.getFrameAtTime(sourceTime)
        if (frame) {
          const existing = imageCache.get(data.assetId)
          if (existing instanceof VideoFrame) existing.close()
          imageCache.set(data.assetId, frame)
        }
      }
    }

    // Composite all objects onto canvas
    renderFrame(ctx, objects, globalTime, { width, height }, imageCache)

    // Encode canvas as video frame
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

    sendProgress((f / totalFrames) * 0.85)
  }

  await videoEncoder.flush()
  videoEncoder.close()

  // Clean up video frames in imageCache
  for (const [, val] of imageCache) {
    if (val instanceof VideoFrame) val.close()
    else if (val instanceof ImageBitmap) val.close()
  }
  for (const [, decoder] of videoDecoders) {
    decoder.destroy()
  }

  sendProgress(0.88)

  // --- Encode audio ---
  const audioChunks: StoredAudioChunk[] = []

  if (audio) {
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
      numberOfChannels: audio.numberOfChannels,
      sampleRate: audio.sampleRate,
      bitrate: 128_000,
    })

    const frameSize = 1024
    const totalSamples = audio.length
    const { numberOfChannels, sampleRate } = audio

    for (let offset = 0; offset < totalSamples; offset += frameSize) {
      const numSamples = Math.min(frameSize, totalSamples - offset)

      const planarData = new Float32Array(numSamples * numberOfChannels)
      for (let ch = 0; ch < numberOfChannels; ch++) {
        planarData.set(
          audio.channelData[ch].subarray(offset, offset + numSamples),
          ch * numSamples,
        )
      }

      const audioFrame = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: numSamples,
        numberOfChannels,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: planarData,
      })

      audioEncoder.encode(audioFrame)
      audioFrame.close()
    }

    await audioEncoder.flush()
    audioEncoder.close()
  }

  sendProgress(0.93)

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
        numberOfChannels: audio!.numberOfChannels,
        sampleRate: audio!.sampleRate,
      },
    } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })

  for (const chunk of videoChunks) {
    muxer.addVideoChunkRaw(chunk.data, chunk.type, chunk.timestamp, chunk.duration, chunk.meta)
  }

  for (const chunk of audioChunks) {
    muxer.addAudioChunkRaw(chunk.data, chunk.type, chunk.timestamp, chunk.duration, chunk.meta)
  }

  muxer.finalize()

  sendProgress(1)

  const outputBuffer = (muxer.target as ArrayBufferTarget).buffer
  return new Blob([outputBuffer], { type: 'video/mp4' })
}

// ---------------------------------------------------------------------------
// Codec negotiation
// ---------------------------------------------------------------------------

/**
 * Try a list of H.264 codec strings from most to least capable,
 * returning the first one the browser supports for encoding.
 */
async function findSupportedVideoCodec(
  width: number,
  height: number,
  framerate: number,
): Promise<VideoEncoderConfig> {
  // H.264 profiles/levels from high to baseline
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
    'No supported H.264 encoder found. Your browser may not support hardware video encoding.',
  )
}
