import { useToastStore, type ToastType } from '../../stores/toastStore'

const styles: Record<ToastType, { icon: string; accent: string }> = {
  success: { icon: 'i-lucide:check-circle', accent: 'text-[var(--accent-green)]' },
  error: { icon: 'i-lucide:alert-circle', accent: 'text-red-400' },
  info: { icon: 'i-lucide:info', accent: 'text-[var(--accent-cyan)]' },
}

// Global toast outlet. Mounted once at the app root so it works on the login
// screen and inside the authenticated app, in both web and desktop builds.
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => {
        const s = styles[t.type]
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg shadow-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)]"
          >
            <div className={`${s.icon} ${s.accent} text-lg flex-shrink-0 mt-0.5`} />
            <span className="flex-1 break-words whitespace-pre-wrap">{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              className="flex-shrink-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              aria-label="Dismiss"
            >
              <div className="i-lucide:x text-xs" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
