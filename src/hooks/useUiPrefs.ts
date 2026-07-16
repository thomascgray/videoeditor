import { useState, useEffect, useCallback } from 'react'

export type ThemeMode = 'light' | 'dark'
export type AccentId = 'blue' | 'teal' | 'violet' | 'rose'

// Presets mirror the accent values defined in index.css (:root + [data-accent="…"]).
export const ACCENTS: { id: AccentId; label: string; color: string }[] = [
  { id: 'blue', label: 'Blue', color: '#2563eb' },
  { id: 'teal', label: 'Teal', color: '#0d9488' },
  { id: 'violet', label: 'Violet', color: '#7c3aed' },
  { id: 'rose', label: 'Rose', color: '#e11d48' },
]

type UiPrefs = { theme: ThemeMode; accent: AccentId }
const STORAGE_KEY = 'ui-prefs'
const DEFAULTS: UiPrefs = { theme: 'light', accent: 'blue' }

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<UiPrefs>
    return {
      theme: p.theme === 'dark' ? 'dark' : 'light',
      accent: ACCENTS.some((a) => a.id === p.accent) ? (p.accent as AccentId) : 'blue',
    }
  } catch {
    return DEFAULTS
  }
}

/**
 * Editor appearance prefs (spec 17): light/dark theme + accent preset. Applied by stamping
 * data-theme / data-accent on <html> — the index.css token layer reacts to those. Persisted to
 * localStorage independently of the project (config.persistProject) and of undo. Light + blue are
 * the CSS defaults, so we clear the attribute in those cases to keep the DOM clean.
 */
export function useUiPrefs() {
  const [prefs, setPrefs] = useState<UiPrefs>(load)

  useEffect(() => {
    const root = document.documentElement
    if (prefs.theme === 'dark') root.dataset.theme = 'dark'
    else delete root.dataset.theme
    if (prefs.accent !== 'blue') root.dataset.accent = prefs.accent
    else delete root.dataset.accent
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      /* storage unavailable — prefs still apply for this session */
    }
  }, [prefs])

  const toggleTheme = useCallback(
    () => setPrefs((p) => ({ ...p, theme: p.theme === 'dark' ? 'light' : 'dark' })),
    [],
  )
  const setAccent = useCallback((accent: AccentId) => setPrefs((p) => ({ ...p, accent })), [])

  return { theme: prefs.theme, accent: prefs.accent, toggleTheme, setAccent }
}
