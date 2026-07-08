import {
  createFile,
  DataStream,
  type Sample,
  type Track,
  type Movie,
  MP4BoxBuffer,
} from 'mp4box'

/**
 * MP4 demuxer + VideoDecoder pipeline.
 *
 * Takes an MP4 Blob, demuxes it with MP4Box.js to collect all encoded samples,
 * then decodes frames on-demand via VideoDecoder.
 *
 * IMPORTANT: Every VideoFrame returned MUST be .close()'d by the caller
 * to avoid GPU memory leaks.
 */

/** An encoded sample ready for decoding */
type EncodedSample = {
  data: Uint8Array
  isSync: boolean
  timestamp: number  // microseconds
  duration: number   // microseconds
}

/**
 * Creates a video decoder for an MP4 blob.
 */
export async function createVideoFrameSource(blob: Blob): Promise<VideoFrameSource> {
  const source = new VideoFrameSource()
  await source.init(blob)
  return source
}

export class VideoFrameSource {
  private decoder: VideoDecoder | null = null
  private samples: EncodedSample[] = []
  private sampleIndex: number = 0
  private decoderConfig: VideoDecoderConfig | null = null

  // Decoded frames waiting to be consumed
  private frameBuffer: VideoFrame[] = []
  private frameResolvers: Array<(frame: VideoFrame | null) => void> = []
  private flushed: boolean = false
  private error: Error | null = null

  // The frame most recently returned by getFrameAtTime(). Source-owned: retained
  // across calls (so it can be re-served) and closed here when we advance past it.
  private currentFrame: VideoFrame | null = null

  /** Duration of the video in seconds */
  duration: number = 0
  /** Frames per second (from track metadata) */
  fps: number = 0
  /** Total number of frames */
  frameCount: number = 0
  /** Video dimensions */
  width: number = 0
  height: number = 0

  async init(blob: Blob): Promise<void> {
    // Phase 1: Demux — collect all encoded samples from the MP4
    const { samples, config, trackInfo } = await demuxMP4(blob)
    this.samples = samples
    this.decoderConfig = config
    this.duration = trackInfo.duration
    this.fps = trackInfo.fps
    this.frameCount = trackInfo.frameCount
    this.width = trackInfo.width
    this.height = trackInfo.height

    // Phase 2: Set up decoder
    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        if (this.frameResolvers.length > 0) {
          const resolver = this.frameResolvers.shift()!
          resolver(frame)
        } else {
          this.frameBuffer.push(frame)
        }
      },
      error: (e: DOMException) => {
        this.error = new Error(`VideoDecoder error: ${e.message}`)
        for (const resolver of this.frameResolvers) {
          resolver(null)
        }
        this.frameResolvers = []
      },
    })

    configureDecoder(this.decoder, this.decoderConfig)

    // Start feeding samples to the decoder (don't await — runs in background)
    this.feedDecoder()
  }

  /**
   * Feed encoded samples to the decoder with backpressure.
   * Runs as an async background task.
   */
  private async feedDecoder(): Promise<void> {
    try {
      while (this.sampleIndex < this.samples.length) {
        if (this.error) return

        const sample = this.samples[this.sampleIndex]

        // Backpressure: wait if decoder queue is getting full
        while (this.decoder!.decodeQueueSize > 10) {
          await new Promise<void>((r) => {
            this.decoder!.addEventListener('dequeue', () => r(), { once: true })
          })
        }

        const chunk = new EncodedVideoChunk({
          type: sample.isSync ? 'key' : 'delta',
          timestamp: sample.timestamp,
          duration: sample.duration,
          data: sample.data,
        })

        this.decoder!.decode(chunk)
        this.sampleIndex++
      }

      // All samples fed — flush to get remaining frames
      await this.decoder!.flush()
      this.flushed = true

      // Signal end to any waiting consumers
      for (const resolver of this.frameResolvers) {
        resolver(null)
      }
      this.frameResolvers = []
    } catch (e) {
      this.error = e instanceof Error ? e : new Error(String(e))
      for (const resolver of this.frameResolvers) {
        resolver(null)
      }
      this.frameResolvers = []
    }
  }

  /**
   * Get the next decoded VideoFrame in presentation order.
   * Returns null when all frames have been decoded.
   *
   * IMPORTANT: Caller MUST call frame.close() when done with the frame.
   */
  async nextFrame(): Promise<VideoFrame | null> {
    if (this.error) throw this.error

    // Check buffer first
    if (this.frameBuffer.length > 0) {
      return this.frameBuffer.shift()!
    }

    // If decoder is flushed and buffer is empty, we're done
    if (this.flushed) return null

    // Wait for next frame from decoder
    return new Promise<VideoFrame | null>((resolve) => {
      this.frameResolvers.push(resolve)
    })
  }

  /**
   * Get the source frame whose interval covers `targetTimeSeconds`.
   *
   * SOURCE-OWNED lifecycle: the returned VideoFrame belongs to this source and
   * stays valid until the next getFrameAtTime() call or destroy(). The caller
   * may draw it but MUST NOT close it. Call with non-decreasing target times
   * (sequential export). The current frame is retained and re-served when
   * consecutive targets fall within it (output fps > source fps, or clips
   * rate-stretched slow); overshoot frames are retained, never dropped.
   */
  async getFrameAtTime(targetTimeSeconds: number): Promise<VideoFrame | null> {
    if (this.error) throw this.error
    const targetUs = targetTimeSeconds * 1_000_000

    // Prime the first frame on the first call.
    if (!this.currentFrame) {
      this.currentFrame = await this.nextFrame()
      if (!this.currentFrame) return null // stream produced no frames at all
    }

    // Advance while the current frame ends at/before the target AND more frames
    // exist. Stops on the frame whose interval covers the target, or — if the
    // target is past the end — the last decoded frame. If the target precedes the
    // current frame (e.g. source-time 0 with a nonzero starting CTS), the loop
    // doesn't run and we anchor to the first available frame.
    while (this.frameEndUs(this.currentFrame) <= targetUs) {
      const next = await this.nextFrame()
      if (!next) break // no more frames — keep the last as the best available
      this.currentFrame.close()
      this.currentFrame = next
    }

    return this.currentFrame
  }

  /** End of a frame's presentation interval, in µs (falls back to nominal fps). */
  private frameEndUs(frame: VideoFrame): number {
    const durUs = frame.duration ?? (this.fps > 0 ? 1_000_000 / this.fps : 33_333)
    return frame.timestamp + durUs
  }

  /**
   * Clean up all resources. Call when done with this source.
   */
  destroy(): void {
    if (this.currentFrame) {
      this.currentFrame.close()
      this.currentFrame = null
    }

    for (const frame of this.frameBuffer) {
      frame.close()
    }
    this.frameBuffer = []

    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.close()
    }

    for (const resolver of this.frameResolvers) {
      resolver(null)
    }
    this.frameResolvers = []
  }
}

// ---------------------------------------------------------------------------
// MP4 Demuxing (synchronous — no async callbacks)
// ---------------------------------------------------------------------------

type DemuxResult = {
  samples: EncodedSample[]
  config: VideoDecoderConfig
  trackInfo: {
    duration: number
    fps: number
    frameCount: number
    width: number
    height: number
  }
}

/**
 * Demux an MP4 blob: parse the container, extract all encoded video samples
 * and the decoder config. No decoding happens here.
 */
async function demuxMP4(blob: Blob): Promise<DemuxResult> {
  const arrayBuffer = await blob.arrayBuffer()

  return new Promise<DemuxResult>((resolve, reject) => {
    const mp4File = createFile()
    const collectedSamples: EncodedSample[] = []
    let videoTrack: Track | null = null
    let firstSample: Sample | null = null

    mp4File.onReady = (info: Movie) => {
      videoTrack = info.videoTracks[0]
      if (!videoTrack) {
        reject(new Error('No video track found in MP4'))
        return
      }

      // Extract all samples for this track
      mp4File.setExtractionOptions(videoTrack.id, undefined, {
        nbSamples: 1000,
      })
      mp4File.start()
    }

    mp4File.onSamples = (
      trackId: number,
      _user: unknown,
      samples: Sample[],
    ) => {
      for (const sample of samples) {
        if (!firstSample) firstSample = sample

        collectedSamples.push({
          data: new Uint8Array(sample.data!),
          isSync: sample.is_sync,
          timestamp: (sample.cts * 1_000_000) / sample.timescale,
          duration: (sample.duration * 1_000_000) / sample.timescale,
        })

        mp4File.releaseUsedSamples(trackId, sample.number)
      }
    }

    mp4File.onError = (_module: string, message: string) => {
      reject(new Error(`MP4Box error: ${message}`))
    }

    // Feed entire file to mp4box
    const buf = MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0)
    mp4File.appendBuffer(buf)
    mp4File.flush()

    // After flush, all synchronous callbacks have fired
    if (!videoTrack || !firstSample) {
      reject(new Error('Failed to parse MP4: no video track or samples found'))
      return
    }

    // Re-bind to explicitly-typed consts: TS narrows the closure-assigned `let`s
    // to `never` after the guard, which it can't see the mp4box callbacks populate.
    const track: Track = videoTrack
    const first: Sample = firstSample

    const config = buildDecoderConfig(track, first)
    const duration = track.duration / track.timescale
    const frameCount = track.nb_samples

    resolve({
      samples: collectedSamples,
      config,
      trackInfo: {
        duration,
        fps: duration > 0 ? frameCount / duration : 30,
        frameCount,
        width: track.video?.width ?? 0,
        height: track.video?.height ?? 0,
      },
    })
  })
}

// ---------------------------------------------------------------------------
// Codec configuration helpers
// ---------------------------------------------------------------------------

/**
 * Extract codec-specific description bytes from an MP4Box sample entry.
 */
function getCodecDescription(sample: Sample): ArrayBuffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = sample.description as any

  const configBox = entry.avcC ?? entry.hvcC ?? entry.av1C ?? entry.vpcC
  if (!configBox) {
    throw new Error('No codec config box found in sample description. Unsupported codec?')
  }

  // DataStream.BIG_ENDIAN exists at runtime but isn't in mp4box's types.
  const bigEndian = (DataStream as unknown as { BIG_ENDIAN: number }).BIG_ENDIAN
  const stream = new DataStream(undefined, 0, bigEndian)
  configBox.write(stream)
  // Strip the 8-byte MP4 box header ([size][fourcc]) — VideoDecoder wants ONLY the
  // AVCDecoderConfigurationRecord. Keeping the header caused "Failed to parse avcC"
  // and was why the spec-08 decoder was abandoned (root cause validated by the B0 spike).
  return (stream.buffer as ArrayBuffer).slice(8, stream.getPosition())
}

function buildDecoderConfig(track: Track, firstSample: Sample): VideoDecoderConfig {
  return {
    codec: track.codec,
    codedWidth: track.video!.width,
    codedHeight: track.video!.height,
    description: getCodecDescription(firstSample),
  }
}

/**
 * Configure a VideoDecoder with fallback strategies for codec string quirks.
 * Calls configure() directly rather than relying on isConfigSupported(),
 * which can be overly strict in some browsers.
 */
function configureDecoder(decoder: VideoDecoder, config: VideoDecoderConfig): void {
  // Strategy 1: Try the exact codec string + description from the container
  try {
    decoder.configure(config)
    return
  } catch {
    // fall through
  }

  // Strategy 2: Normalize H.264 constraint flags (avc1.PPCCLL → avc1.PP00LL)
  // Some MP4s report constraint flags that WebCodecs doesn't recognize
  if (config.codec.startsWith('avc1.') && config.codec.length >= 11) {
    const profile = config.codec.slice(5, 7)
    const level = config.codec.slice(9, 11)
    const normalized = `avc1.${profile}00${level}`
    try {
      decoder.configure({ ...config, codec: normalized })
      return
    } catch {
      // fall through
    }
  }

  throw new Error(
    `Video codec "${config.codec}" is not supported for decoding in this browser`,
  )
}
