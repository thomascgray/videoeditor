import { useEffect, useRef, useState, useCallback } from 'react'
import type { TimelineObject, AudioData, VideoData } from '../types'
import { getAssetUrl } from '../lib/assetStore'
import { registerVideoElement, unregisterVideoElement, notifyVideoReady } from '../lib/mediaRegistry'
import { clipRate, sourceTimeAt, effectiveVolume } from '../lib/mediaTiming'

type MediaEntry = {
  objectId: string
  assetId: string
  element: HTMLAudioElement | HTMLVideoElement
  originalDuration: number
  volume: number
}

/**
 * Manages HTMLMediaElements for audio/video clips, synced to the timeline.
 * Handles play/pause/seek, playbackRate, volume, and mute.
 */
export function useAudioPlayback(
  objects: TimelineObject[],
  globalTime: number,
  isPlaying: boolean,
  // Preview playback speed (usePlayback) — the playhead advances this much faster, so each media
  // element must play at rate * previewSpeed to stay in sync. Export is unaffected (separate path).
  previewSpeed = 1,
) {
  const [isMuted, setIsMuted] = useState(false)
  // Master preview volume (0–1). Scales each clip's own data.volume; a monitoring level for
  // playback only (export mixes each clip at its own volume, independent of this).
  const [volume, setVolumeState] = useState(1)
  const volumeRef = useRef(1)
  const entriesRef = useRef<Map<string, MediaEntry>>(new Map())
  const globalTimeRef = useRef(globalTime)
  globalTimeRef.current = globalTime

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev
      for (const entry of entriesRef.current.values()) {
        entry.element.muted = next
      }
      return next
    })
  }, [])

  // Set the master volume and push it to every live element immediately (no element churn, so
  // dragging the slider stays smooth). Raising the volume above zero also lifts mute.
  const setVolume = useCallback((v: number) => {
    const next = clamp01(v)
    volumeRef.current = next
    setVolumeState(next)
    for (const entry of entriesRef.current.values()) {
      entry.element.volume = clamp01(entry.volume * next)
      if (next > 0) entry.element.muted = false
    }
    if (next > 0) setIsMuted(false)
  }, [])

  // Create/destroy media elements when objects change
  useEffect(() => {
    const entries = entriesRef.current
    const currentIds = new Set<string>()

    for (const obj of objects) {
      if (obj.type !== 'audio' && obj.type !== 'video') continue
      // Hidden clips (spec 14 R11): don't register a media element. Not adding to
      // currentIds means the cleanup loop below pauses + unregisters any element that
      // was live before the object was hidden (so useCanvasRenderer stops blitting it).
      if (obj.hidden) continue
      currentIds.add(obj.id)

      const data = obj.data as AudioData | VideoData
      const existing = entries.get(obj.id)

      if (existing && existing.assetId === data.assetId) {
        // Update volume and playbackRate on existing element (rate honors trim: span/duration)
        existing.element.playbackRate = clipRate(data, obj.duration) * previewSpeed
        existing.element.volume = clamp01(effectiveVolume(data) * volumeRef.current)
        existing.originalDuration = data.originalDuration
        existing.volume = effectiveVolume(data)
        continue
      }

      // Create new element
      const url = getAssetUrl(data.assetId)
      if (!url) continue

      // Clean up old entry if asset changed
      if (existing) {
        existing.element.pause()
        existing.element.src = ''
      }

      const el = obj.type === 'video'
        ? document.createElement('video')
        : document.createElement('audio')
      el.src = url
      el.preload = 'auto'
      el.volume = clamp01(effectiveVolume(data) * volumeRef.current)
      el.muted = isMuted

      el.playbackRate = clipRate(data, obj.duration) * previewSpeed

      // Video elements double as the canvas image source (A2). playsInline lets a
      // detached element decode frames; register it so useCanvasRenderer can draw it.
      if (obj.type === 'video') {
        ;(el as HTMLVideoElement).playsInline = true
        // Paint the canvas the moment the first frame decodes, so a freshly imported
        // clip appears immediately instead of blank-until-next-scrub.
        el.addEventListener('loadeddata', notifyVideoReady)
        registerVideoElement(obj.id, el as HTMLVideoElement)
      }

      entries.set(obj.id, {
        objectId: obj.id,
        assetId: data.assetId,
        element: el,
        originalDuration: data.originalDuration,
        volume: effectiveVolume(data),
      })
    }

    // Remove entries for deleted objects
    for (const [id, entry] of entries) {
      if (!currentIds.has(id)) {
        entry.element.pause()
        entry.element.src = ''
        unregisterVideoElement(id)
        entries.delete(id)
      }
    }
  }, [objects, isMuted, previewSpeed])

  // Sync play/pause and currentTime
  useEffect(() => {
    const entries = entriesRef.current

    for (const obj of objects) {
      if (obj.type !== 'audio' && obj.type !== 'video') continue
      if (obj.hidden) continue
      const entry = entries.get(obj.id)
      if (!entry) continue

      const el = entry.element
      const data = obj.data as AudioData | VideoData

      // Is this clip active at the current time?
      const clipStart = obj.startTime
      const clipEnd = obj.startTime + obj.duration
      const isActive = globalTime >= clipStart && globalTime < clipEnd

      if (isActive && isPlaying) {
        // Position within the source media honors trim: sourceIn + progress*span
        const clipProgress = (globalTime - clipStart) / obj.duration
        const sourceTime = sourceTimeAt(data, clipProgress)

        el.playbackRate = clipRate(data, obj.duration) * previewSpeed

        // Only seek if we're significantly out of sync (>0.3s)
        if (Math.abs(el.currentTime - sourceTime) > 0.3) {
          el.currentTime = sourceTime
        }

        if (el.paused) {
          el.play().catch(() => {/* autoplay may be blocked */})
        }
      } else {
        if (!el.paused) {
          el.pause()
        }
        if (isActive) {
          // Paused but active — seek to correct position
          const clipProgress = (globalTime - clipStart) / obj.duration
          el.currentTime = sourceTimeAt(data, clipProgress)
        }
      }
    }
  }, [objects, globalTime, isPlaying])

  // When seeking (not playing), update positions immediately
  useEffect(() => {
    if (isPlaying) return
    const entries = entriesRef.current

    for (const obj of objects) {
      if (obj.type !== 'audio' && obj.type !== 'video') continue
      if (obj.hidden) continue
      const entry = entries.get(obj.id)
      if (!entry) continue

      const clipStart = obj.startTime
      const clipEnd = obj.startTime + obj.duration
      const isActive = globalTime >= clipStart && globalTime < clipEnd

      if (isActive) {
        const data = obj.data as AudioData | VideoData
        const clipProgress = (globalTime - clipStart) / obj.duration
        entry.element.currentTime = sourceTimeAt(data, clipProgress)
      }
    }
  }, [objects, globalTime, isPlaying])

  // Cleanup on unmount
  useEffect(() => {
    const entries = entriesRef.current
    return () => {
      for (const entry of entries.values()) {
        entry.element.pause()
        entry.element.src = ''
        unregisterVideoElement(entry.objectId)
      }
      entries.clear()
    }
  }, [])

  return { isMuted, toggleMute, volume, setVolume }
}
