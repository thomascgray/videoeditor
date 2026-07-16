import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconChevronDown } from '@tabler/icons-react'

/**
 * Popover primitive (spec 17 P) — mirrors `AspectRatioSelector`'s open/outside-click/Escape pattern,
 * but renders its panel through a **portal** to `document.body` with fixed positioning. The context
 * toolbar lives inside the render area's `overflow-hidden`, so an in-flow panel would be clipped;
 * portalling + viewport-clamped `fixed` coords keeps popovers fully visible anywhere on screen.
 *
 * The trigger is a toolbar-style button (icon + optional label + chevron). `children` is the panel
 * content, or a `(close) => ReactNode` render-prop when the content needs to dismiss the popover.
 */
export function Popover({
  icon,
  label,
  title,
  children,
  panelClassName,
}: {
  icon?: ReactNode
  label?: string
  title: string
  children: ReactNode | ((close: () => void) => ReactNode)
  panelClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Position the panel below the trigger (flip above when there's no room), clamped to the viewport.
  // Runs pre-paint so the measured panel size is used before the first visible frame.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const t = triggerRef.current
    if (!t) return
    const reposition = () => {
      const tr = t.getBoundingClientRect()
      const pw = panelRef.current?.offsetWidth ?? 0
      const ph = panelRef.current?.offsetHeight ?? 0
      const GAP = 8, M = 8
      let left = tr.left + tr.width / 2 - pw / 2
      let top = tr.bottom + GAP
      if (top + ph > window.innerHeight - M && tr.top - GAP - ph > M) top = tr.top - GAP - ph
      left = Math.max(M, Math.min(left, window.innerWidth - pw - M))
      top = Math.max(M, Math.min(top, window.innerHeight - ph - M))
      setPos({ left, top })
    }
    reposition()
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [open])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    // Escape closes only the popover — stop it reaching App's window-level handler (which would
    // otherwise deselect the object out from under the open popover). document (bubble) fires first.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
        className={`flex h-8 items-center gap-1 rounded px-1.5 text-xs transition-colors cursor-pointer ${
          open ? 'bg-surface-hover text-fg' : 'text-muted hover:bg-surface-hover hover:text-fg'
        }`}
      >
        {icon}
        {label && <span className="font-medium">{label}</span>}
        <IconChevronDown size={13} stroke={2} className="text-subtle" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={`fixed z-80 rounded-lg border border-border bg-surface shadow-xl ${panelClassName ?? ''}`}
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>,
          document.body,
        )}
    </>
  )
}
