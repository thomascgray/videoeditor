import type { Project } from '../types'
import { createDefaultProject } from '../types'

const STORAGE_KEY = 'battle-report-project'

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project))
  } catch (e) {
    console.warn('Failed to save project to localStorage:', e)
  }
}

export function loadProject(): Project {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      const parsed = JSON.parse(data)
      // Migration: old slide-based projects don't have 'objects'
      if (parsed.objects && Array.isArray(parsed.objects)) {
        return parsed as Project
      }
      // Old format — discard and start fresh
      console.warn('Discarding old slide-based project from localStorage')
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch (e) {
    console.warn('Failed to load project from localStorage:', e)
  }
  return createDefaultProject()
}

export function clearProject(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function exportProjectJSON(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function importProjectJSON(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const project = JSON.parse(reader.result as string) as Project
        resolve(project)
      } catch {
        reject(new Error('Invalid project file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}
