import { useState } from 'react'
import { useAlertStore, type AlertTrigger } from '../../stores/alertStore'
import { useAuthStore } from '../../stores/authStore'
import { testChannel } from '../../lib/alerts'
import { isTauri } from '../../lib/tauri'
import { toast } from '../../stores/toastStore'

const TRIGGERS: Array<{ key: AlertTrigger; label: string; hint: string }> = [
  { key: 'mail', label: 'New mail', hint: 'Unread mail arriving in an inbox' },
  { key: 'calendar', label: 'Calendar reminders', hint: 'Before events start' },
  { key: 'failure', label: 'Sync & login problems', hint: "Server unreachable or login expired" },
]

const input =
  'w-full text-sm bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1.5 outline-none focus:border-[var(--primary-color)]'

export function AlertSettings() {
  const a = useAlertStore()
  const accounts = useAuthStore((s) => s.accounts)
  const [testing, setTesting] = useState<string | null>(null)

  const test = async (ch: 'desktop' | 'ntfy') => {
    setTesting(ch)
    try {
      await testChannel(ch)
      toast.success(ch === 'desktop' ? 'Test notification sent' : `Sent to ntfy topic "${a.ntfyTopic}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Alerts</h3>
      <div className="space-y-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 items-center text-sm">
          <span />
          <span className="text-xs text-[var(--text-tertiary)]">Desktop</span>
          <span className="text-xs text-[var(--text-tertiary)]">ntfy</span>
          {TRIGGERS.map((t) => (
            <div key={t.key} className="contents">
              <div>
                <div>{t.label}</div>
                <div className="text-xs text-[var(--text-tertiary)]">{t.hint}</div>
              </div>
              <input
                type="checkbox"
                className="justify-self-center"
                checked={a.routes[t.key].desktop}
                onChange={(e) => a.setRoute(t.key, 'desktop', e.target.checked)}
              />
              <input
                type="checkbox"
                className="justify-self-center"
                checked={a.routes[t.key].ntfy}
                onChange={(e) => a.setRoute(t.key, 'ntfy', e.target.checked)}
              />
            </div>
          ))}
        </div>

        <label className="flex items-center justify-between gap-2 text-sm">
          <span>Remind before events</span>
          <select
            value={a.reminderMinutes}
            onChange={(e) => a.setReminderMinutes(Number(e.target.value))}
            className="text-sm bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-2 py-1"
          >
            {[0, 1, 5, 10, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'At start' : `${m} min`}
              </option>
            ))}
          </select>
        </label>

        {isTauri && accounts.length > 1 && (
          <div>
            <div className="text-xs text-[var(--text-tertiary)] mb-1">New-mail alerts for</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {accounts.map((acc) => (
                <label key={acc.name} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={!a.mutedAccounts.includes(acc.name)}
                    onChange={() => a.toggleAccountMuted(acc.name)}
                  />
                  {acc.name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-[var(--border-color)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-tertiary)]">
              Desktop notifications{isTauri ? ' (dunst, mako, GNOME…)' : ''}
            </span>
            <button
              onClick={() => test('desktop')}
              disabled={!!testing}
              className="px-2 py-1 text-xs rounded border border-[var(--border-color)] hover:bg-[var(--bg-secondary)]"
            >
              {testing === 'desktop' ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--border-color)] space-y-2">
          <div className="text-xs text-[var(--text-tertiary)]">ntfy</div>
          <input
            type="text"
            value={a.ntfyServer}
            onChange={(e) => a.setNtfy({ ntfyServer: e.target.value })}
            placeholder="https://ntfy.sh"
            className={input}
          />
          <input
            type="text"
            value={a.ntfyTopic}
            onChange={(e) => a.setNtfy({ ntfyTopic: e.target.value })}
            placeholder="Topic, e.g. tommi-mail-8f3k2"
            className={input}
          />
          <input
            type="password"
            value={a.ntfyAuth}
            onChange={(e) => a.setNtfy({ ntfyAuth: e.target.value })}
            placeholder="Access token or user:password (optional)"
            autoComplete="off"
            className={input}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
              On public ntfy.sh anyone who knows the topic can read it. Use a long random topic or your own server.
              Alerts are sent only while webjmail is running.
            </p>
            <button
              onClick={() => test('ntfy')}
              disabled={!!testing || !a.ntfyTopic.trim()}
              className="shrink-0 px-2 py-1 text-xs rounded border border-[var(--border-color)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
            >
              {testing === 'ntfy' ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
