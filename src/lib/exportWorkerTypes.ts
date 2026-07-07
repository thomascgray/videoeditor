import type { Project } from '../types'

/** Pre-rendered audio data (from OfflineAudioContext on main thread) */
export type RenderedAudio = {
  channelData: Float32Array[] // one per channel
  sampleRate: number
  numberOfChannels: number
  length: number // total samples per channel
}

/** Main thread → Worker */
export type ExportWorkerRequest = {
  type: 'start'
  project: Project
  assetBlobs: Array<[string, Blob]>
  audio: RenderedAudio | null
}

/** Worker → Main thread */
export type ExportWorkerResponse =
  | { type: 'progress'; pct: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string }
