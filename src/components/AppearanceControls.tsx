import { IconSun, IconMoon } from '@tabler/icons-react'
import { type ThemeMode } from '../hooks/useUiPrefs'

type AppearanceControlsProps = {
  theme: ThemeMode
  onToggleTheme: () => void
}

/** Header appearance control (spec 17): a light/dark theme toggle. (Accent is a fixed brand red.) */
export default function AppearanceControls({ theme, onToggleTheme }: AppearanceControlsProps) {
  return (
    <button
      onClick={onToggleTheme}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex items-center justify-center w-7 h-7 rounded text-muted hover:text-fg hover:bg-surface-hover cursor-pointer transition-colors"
    >
      {theme === 'dark' ? <IconSun size={16} stroke={2} /> : <IconMoon size={16} stroke={2} />}
    </button>
  )
}
