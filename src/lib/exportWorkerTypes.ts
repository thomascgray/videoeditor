import type { Project } from '../types'

/** Pre-rendered audio data (from OfflineAudioContext on main thread) */
export type RenderedAudio = {
  channelData: Float32Array[] // one per channel
  sampleRate: number
  numberOfChannels: number
  length: number // total samples per channel
}

/** Resolved output dimensions + video bitrate for the encode (issue #6). */
export type EncodeConfig = {
  width: number
  height: number
  videoBitrate: number
}

/** Main thread → Worker */
export type ExportWorkerRequest = {
  type: 'start'
  project: Project
  assetBlobs: Array<[string, Blob]>
  audio: RenderedAudio | null
  encode: EncodeConfig
}

/** Worker → Main thread */
export type ExportWorkerResponse =
  | { type: 'progress'; pct: number }
  | { type: 'done'; blob: Blob }
  // `recoverable` = the worker couldn't decode (no HTMLVideoElement fallback in a
  // worker); the main thread should retry on its element-seeking path.
  | { type: 'error'; message: string; recoverable?: boolean }
