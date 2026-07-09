import { useState, useCallback, useRef } from 'react'
import type { Project } from '../types'
import { exportVideo } from '../lib/ffmpegExport'
import type { ExportSettings } from '../lib/exportSettings'

export function useFFmpegExport() {
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const startExport = useCallback(async (project: Project, settings: ExportSettings) => {
    setIsExporting(true)
    setProgress(0)
    setError(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const blob = await exportVideo(project, settings, (pct) => {
        setProgress(pct)
      }, controller.signal)

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = blob.type === 'video/mp4' ? 'mp4' : 'webm'
      a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      // A user-initiated cancel is not an error.
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : 'Export failed')
      }
    } finally {
      setIsExporting(false)
      abortRef.current = null
    }
  }, [])

  const cancelExport = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return {
    isExporting,
    progress,
    error,
    startExport,
    cancelExport,
  }
}
