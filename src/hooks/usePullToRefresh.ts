import { useCallback, useRef, useState } from 'react'

const THRESHOLD = 64 // pull distance that arms a refresh
const MAX_PULL = 110 // allow a little overshoot past the threshold for an elastic feel
const SETTLE_MS = 180 // wheel "release" debounce — fire once the scroll gesture stops
const MIN_SPIN_MS = 650 // keep the spinner up long enough to register, even on an instant refetch

// Overscroll up at the top of a scroll container (wheel or touch) past a
// threshold to trigger a refresh. Unlike a hair-trigger, the pull can stretch a
// bit past the threshold and snaps back on release. `trigger` lets a refresh
// button share the same guaranteed-visible spin. Returns props to spread on the
// scroll div plus state for the visual indicator.
export function usePullToRefresh(onRefresh: () => void | Promise<unknown>, isRefreshing = false) {
  const ref = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const pullRef = useRef(0)
  const startY = useRef<number | null>(null)
  const settle = useRef<number | null>(null)

  const setPullBoth = useCallback((v: number) => {
    pullRef.current = v
    setPull(v)
  }, [])

  // Run the refresh but hold the spinner for a minimum so the user always sees
  // that we tried — even when the refetch resolves from cache instantly.
  const trigger = useCallback(() => {
    if (busy) return
    setBusy(true)
    const started = Date.now()
    Promise.resolve()
      .then(() => onRefresh())
      .catch(() => {})
      .finally(() => {
        const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - started))
        window.setTimeout(() => setBusy(false), wait)
      })
  }, [busy, onRefresh])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const el = ref.current
      if (!el || busy || isRefreshing) return
      if (el.scrollTop <= 0 && e.deltaY < 0) {
        // Resistance grows as you pull further — the last few pixels are the hardest.
        const resist = 1 - pullRef.current / (MAX_PULL * 1.6)
        setPullBoth(Math.min(pullRef.current - e.deltaY * resist, MAX_PULL))
        if (settle.current) clearTimeout(settle.current)
        settle.current = window.setTimeout(() => {
          if (pullRef.current >= THRESHOLD) trigger()
          setPullBoth(0)
        }, SETTLE_MS)
      }
    },
    [busy, isRefreshing, trigger, setPullBoth]
  )

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const el = ref.current
    startY.current = el && el.scrollTop <= 0 ? e.touches[0].clientY : null
  }, [])

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const el = ref.current
      if (!el || startY.current === null || busy || isRefreshing) return
      if (el.scrollTop > 0) {
        startY.current = null
        setPullBoth(0)
        return
      }
      const dy = e.touches[0].clientY - startY.current
      if (dy > 0) {
        // Rubber-band: half the finger travel, easing off as we approach the cap.
        const eased = Math.min(dy * 0.55, MAX_PULL)
        setPullBoth(eased)
      }
    },
    [busy, isRefreshing, setPullBoth]
  )

  const onTouchEnd = useCallback(() => {
    if (pullRef.current >= THRESHOLD) trigger()
    setPullBoth(0)
    startY.current = null
  }, [trigger, setPullBoth])

  return {
    pull,
    threshold: THRESHOLD,
    armed: pull >= THRESHOLD,
    refreshing: busy || isRefreshing,
    trigger,
    scrollRef: ref,
    bind: { ref, onWheel, onTouchStart, onTouchMove, onTouchEnd },
  }
}
