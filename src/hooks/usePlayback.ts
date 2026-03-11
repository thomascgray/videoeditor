import { useState, useRef, useCallback, useEffect } from 'react'
import type { Project } from '../types'

export function usePlayback(project: Project) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [globalTime, setGlobalTime] = useState(0)
  const rafRef = useRef<number>(0)
  const lastFrameTimeRef = useRef<number>(0)

  // Total duration = furthest endTime of any object
  const totalDuration = project.objects.reduce(
    (max, obj) => Math.max(max, obj.startTime + obj.duration),
    0,
  )

  const totalDurationRef = useRef(totalDuration)

  useEffect(() => {
    totalDurationRef.current = totalDuration
  }, [totalDuration])

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current)
      return
    }

    lastFrameTimeRef.current = 0

    const tick = (timestamp: number) => {
      if (lastFrameTimeRef.current === 0) {
        lastFrameTimeRef.current = timestamp
      }
      const delta = (timestamp - lastFrameTimeRef.current) / 1000
      lastFrameTimeRef.current = timestamp

      setGlobalTime((prev) => {
        const next = prev + delta
        if (next >= totalDurationRef.current) {
          setIsPlaying(false)
          return 0
        }
        return next
      })

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPlaying])

  const play = useCallback(() => {
    if (totalDurationRef.current <= 0) return
    setIsPlaying(true)
  }, [])
  const pause = useCallback(() => setIsPlaying(false), [])
  const togglePlayback = useCallback(() => {
    if (totalDurationRef.current <= 0) return
    setIsPlaying((p) => !p)
  }, [])

  const seek = useCallback(
    (time: number) => {
      setGlobalTime(Math.max(0, Math.min(time, totalDuration)))
    },
    [totalDuration],
  )

  return {
    isPlaying,
    globalTime,
    totalDuration,
    play,
    pause,
    togglePlayback,
    seek,
  }
}
