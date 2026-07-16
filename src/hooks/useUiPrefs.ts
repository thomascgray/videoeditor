import { useState, useEffect, useCallback } from 'react'

export type ThemeMode = 'light' | 'dark'

type UiPrefs = { theme: ThemeMode }
const STORAGE_KEY = 'ui-prefs'
const DEFAULTS: UiPrefs = { theme: 'light' }

function load(): UiPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw) as Partial<UiPrefs>
    return { theme: p.theme === 'dark' ? 'dark' : 'light' }
  } catch {
    return DEFAULTS
  }
}

/**
 * Editor appearance prefs (spec 17): the light/dark theme. Applied by stamping data-theme on
 * <html> — the index.css token layer reacts to it. Persisted to localStorage independently of the
 * project (config.persistProject) and of undo. Light is the CSS default, so we clear the attribute
 * in that case to keep the DOM clean. (The accent is a fixed brand red in index.css — not
 * user-selectable; any legacy data-accent is cleared here.)
 */
export function useUiPrefs() {
  const [prefs, setPrefs] = useState<UiPrefs>(load)

  useEffect(() => {
    const root = document.documentElement
    if (prefs.theme === 'dark') root.dataset.theme = 'dark'
    else delete root.dataset.theme
    delete root.dataset.accent // clear any accent stamped by an older build
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      /* storage unavailable — prefs still apply for this session */
    }
  }, [prefs])

  const toggleTheme = useCallback(
    () => setPrefs((p) => ({ theme: p.theme === 'dark' ? 'light' : 'dark' })),
    [],
  )

  return { theme: prefs.theme, toggleTheme }
}
