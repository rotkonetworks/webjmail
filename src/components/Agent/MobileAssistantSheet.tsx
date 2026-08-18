import { useRef, useState } from 'react'

// A draggable bottom sheet for the assistant on mobile. The mail/draft stays
// visible behind it; drag the grabber to move between snap heights (peek / half
// / tall) so you can read the email and the assistant/draft at the same time.
// The chosen height is remembered.
const SNAPS = [0.4, 0.7, 0.94] // fractions of the viewport height
const KEY = 'webjmail:assistant-sheet-snap'

const clampFrac = (f: number) => Math.min(0.96, Math.max(0.22, f))

export function MobileAssistantSheet({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<number>(() => {
    const v = Number(localStorage.getItem(KEY))
    return SNAPS.includes(v) ? v : SNAPS[1]
  })
  // Live pixel height while dragging (null when settled on a snap).
  const [dragH, setDragH] = useState<number | null>(null)
  const start = useRef<{ y: number; h: number } | null>(null)

  const vh = () => window.innerHeight
  const heightPx = dragH ?? Math.round(snap * vh())

  const commit = (frac: number) => {
    const f = clampFrac(frac)
    setSnap(f)
    try {
      localStorage.setItem(KEY, String(f))
    } catch {
      /* ignore */
    }
  }

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, h: heightPx }
  }
  const onMove = (e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    // Drag up (smaller clientY) => taller sheet.
    setDragH(clampFrac((s.h + (s.y - e.clientY)) / vh()) * vh())
  }
  const onUp = () => {
    if (dragH != null) {
      const frac = dragH / vh()
      // Snap to the nearest configured height.
      const nearest = SNAPS.reduce((a, b) => (Math.abs(b - frac) < Math.abs(a - frac) ? b : a))
      commit(nearest)
      setDragH(null)
    }
    start.current = null
  }

  // Tapping the grabber cycles to the next snap (a quick way up/down without dragging).
  const cycle = () => {
    const idx = SNAPS.indexOf(snap)
    commit(SNAPS[(idx + 1) % SNAPS.length])
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
      style={{ height: heightPx, transition: dragH == null ? 'height 0.22s ease' : 'none' }}
    >
      {/* Grabber — drag to resize, tap to cycle snap heights. */}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={cycle}
        className="flex-shrink-0 flex items-center justify-center py-2.5 cursor-row-resize touch-none select-none"
        title="Drag to resize • tap to cycle height"
      >
        <div className="w-10 h-1.5 rounded-full bg-[var(--text-tertiary)] opacity-60" />
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  )
}
