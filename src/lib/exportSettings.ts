import type { Project } from '../types'

/**
 * Export quality/size settings (issue #6). Two orthogonal knobs — resolution
 * (how many pixels) and compression (bits per pixel) — that together determine
 * the H.264 target bitrate, and therefore the output file size:
 *
 *     size ≈ (videoBitrate + audioBitrate) × duration / 8
 *
 * Everything here is pure + DOM-free so it can be shared by the main-thread
 * export, the worker export, and the ExportModal's live size estimate.
 */

export type CompressionPreset = 'studio' | 'social' | 'web' | 'web-low'

type CompressionSpec = {
  id: CompressionPreset
  label: string
  /** Bits per pixel per frame. bitrate = width × height × fps × bpp. */
  bpp: number
  blurb: string
}

/**
 * Compression tiers, high → low quality. `bpp` (bits/pixel/frame) is the classic
 * H.264 sizing heuristic — ~0.1 is a well-regarded 1080p target, so `social` lands
 * ~6 Mbps at 1080p30, `web` ~3 Mbps (source-tier), `web-low` ~1.5 Mbps.
 */
export const COMPRESSION_PRESETS: readonly CompressionSpec[] = [
  {
    id: 'studio',
    label: 'Studio',
    bpp: 0.20,
    blurb: 'Highest quality, best for further editing. Compression is almost impossible to notice.',
  },
  {
    id: 'social',
    label: 'Social Media',
    bpp: 0.10,
    blurb: 'Good for sharing on social media. Compression is noticeable when taking a good look. Keep in mind the platform may compress the video further.',
  },
  {
    id: 'web',
    label: 'Web',
    bpp: 0.05,
    blurb: 'Good for directly playing on websites. Compression is slightly visible, but not distracting.',
  },
  {
    id: 'web-low',
    label: 'Web (Low)',
    bpp: 0.025,
    blurb: 'Smallest file. Compression is visible, but fine for quick shares and previews.',
  },
]

export const DEFAULT_COMPRESSION: CompressionPreset = 'social'

/** Standard short-edge (min of width/height) resolution targets, high → low. */
const RESOLUTION_TARGETS = [2160, 1440, 1080, 720, 480] as const

export type ExportSettings = {
  /** Target short edge in px (e.g. 1080 = "1080p"). Drives downscaling. */
  shortEdge: number
  compression: CompressionPreset
}

/** Round to the nearest positive even integer (H.264 requires even dimensions). */
function roundEven(n: number): number {
  return Math.max(2, 2 * Math.round(n / 2))
}

const projectShortEdge = (project: Project): number =>
  Math.min(project.width, project.height)

/**
 * Export pixel dimensions for a chosen short edge, preserving the project aspect
 * ratio and NEVER upscaling past the native size (scale clamped ≤ 1).
 */
export function exportDimensions(
  project: Project,
  shortEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, shortEdge / projectShortEdge(project))
  return {
    width: roundEven(project.width * scale),
    height: roundEven(project.height * scale),
  }
}

export type ResolutionOption = {
  shortEdge: number
  /** e.g. "1080p" */
  label: string
  width: number
  height: number
  /** True when this is the project's native (full) resolution. */
  native: boolean
}

/**
 * The resolution choices to offer for a project: every standard target that
 * wouldn't upscale, plus the native resolution itself if it isn't already one.
 * Sorted high → low.
 */
export function resolutionOptions(project: Project): ResolutionOption[] {
  const native = projectShortEdge(project)
  const edges = new Set<number>([native])
  for (const t of RESOLUTION_TARGETS) {
    if (t <= native) edges.add(t)
  }
  return [...edges]
    .sort((a, b) => b - a)
    .map((shortEdge) => {
      const { width, height } = exportDimensions(project, shortEdge)
      return { shortEdge, label: `${shortEdge}p`, width, height, native: shortEdge === native }
    })
}

/** Default short edge: native, but capped at 1080p so big projects don't default huge. */
export function defaultShortEdge(project: Project): number {
  return Math.min(projectShortEdge(project), 1080)
}

const bppFor = (compression: CompressionPreset): number =>
  (COMPRESSION_PRESETS.find((p) => p.id === compression) ?? COMPRESSION_PRESETS[1]).bpp

/** Target H.264 video bitrate (bits/sec) for the given output pixels + fps + tier. */
export function videoBitrateFor(
  width: number,
  height: number,
  fps: number,
  compression: CompressionPreset,
): number {
  return Math.round(width * height * fps * bppFor(compression))
}

/** Total timeline duration in seconds (used by size estimate + encoders). */
export function totalDurationOf(project: Project): number {
  return project.objects.reduce((max, o) => Math.max(max, o.startTime + o.duration), 0)
}

const AUDIO_BITRATE = 128_000

const hasAudio = (project: Project): boolean =>
  project.objects.some((o) => (o.type === 'audio' || o.type === 'video') && !o.hidden)

/**
 * Resolve settings into the concrete encode parameters every export path needs:
 * output dimensions and the video bitrate.
 */
export function resolveEncodeConfig(
  project: Project,
  settings: ExportSettings,
): { width: number; height: number; videoBitrate: number } {
  const { width, height } = exportDimensions(project, settings.shortEdge)
  return {
    width,
    height,
    videoBitrate: videoBitrateFor(width, height, project.fps, settings.compression),
  }
}

/**
 * Estimated output size in bytes. Accurate to within codec overhead because the
 * encoder targets this same bitrate: size = (video + audio bitrate) × duration / 8.
 */
export function estimateExportBytes(project: Project, settings: ExportSettings): number {
  const { videoBitrate } = resolveEncodeConfig(project, settings)
  const audioBitrate = hasAudio(project) ? AUDIO_BITRATE : 0
  return Math.round(((videoBitrate + audioBitrate) * totalDurationOf(project)) / 8)
}

/** Human-readable byte size, e.g. "1.6 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
