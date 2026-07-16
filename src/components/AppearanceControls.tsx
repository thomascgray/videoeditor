import { IconSun, IconMoon } from '@tabler/icons-react'
import { ACCENTS, type ThemeMode, type AccentId } from '../hooks/useUiPrefs'

type AppearanceControlsProps = {
  theme: ThemeMode
  accent: AccentId
  onToggleTheme: () => void
  onSetAccent: (a: AccentId) => void
}

/** Header appearance controls (spec 17): accent preset swatches + a light/dark theme toggle. */
export default function AppearanceControls({ theme, accent, onToggleTheme, onSetAccent }: AppearanceControlsProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1" title="Accent colour">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            onClick={() => onSetAccent(a.id)}
            title={a.label}
            aria-label={`${a.label} accent`}
            className="w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110"
            style={{
              background: a.color,
              boxShadow: accent === a.id ? '0 0 0 2px var(--surface), 0 0 0 3.5px var(--text)' : 'none',
            }}
          />
        ))}
      </div>
      <button
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        className="flex items-center justify-center w-7 h-7 rounded text-muted hover:text-fg hover:bg-surface-hover cursor-pointer transition-colors"
      >
        {theme === 'dark' ? <IconSun size={16} stroke={2} /> : <IconMoon size={16} stroke={2} />}
      </button>
    </div>
  )
}
