import { useState, useCallback } from 'react'
import type { Project } from '../types'
import { exportVideo } from '../lib/ffmpegExport'

export function useFFmpegExport() {
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const startExport = useCallback(async (project: Project) => {
    setIsExporting(true)
    setProgress(0)
    setError(null)

    try {
      const blob = await exportVideo(project, (pct) => {
        setProgress(pct)
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = blob.type === 'video/mp4' ? 'mp4' : 'webm'
      a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }, [])

  return {
    isExporting,
    progress,
    error,
    startExport,
  }
}
