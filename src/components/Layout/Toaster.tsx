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
            <div className="flex-1 min-w-0">
              <span className="block break-words whitespace-pre-wrap">{t.message}</span>
              {t.actions && t.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {t.actions.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => {
                        a.onClick()
                        removeToast(t.id)
                      }}
                      className="px-2 py-1 rounded text-xs font-medium border border-[var(--border-color)] hover:bg-[var(--bg-tertiary)] text-[var(--accent-cyan)]"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
