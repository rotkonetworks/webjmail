// src/components/Layout/Sidebar.tsx
import React from 'react'
import { useMailboxes, usePrimaryAccountId } from '../../hooks'
import { useMailStore } from '../../stores/mailStore'
import { useAuthStore } from '../../stores/authStore'
import { useUnreadStore } from '../../stores/unreadStore'
import { useUIStore } from '../../stores/uiStore'
import { jmapClient } from '../../api/jmap'
import { toast } from '../../stores/toastStore'
import { Mailbox } from '../../api/types'

export function Sidebar() {
  const { data: mailboxes, isLoading, error, refetch } = useMailboxes()
  const accountId = usePrimaryAccountId()
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectMailbox = useMailStore((state) => state.selectMailbox)
  const unifiedView = useMailStore((state) => state.unifiedView)
  const showUnifiedInbox = useMailStore((state) => state.showUnifiedInbox)
  const accounts = useAuthStore((state) => state.accounts)
  const unreadByAccount = useUnreadStore((state) => state.byAccount)
  const totalUnread = Object.values(unreadByAccount).reduce((a, b) => a + b, 0)
  const logout = useAuthStore((state) => state.logout)
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const [creatingFolder, setCreatingFolder] = React.useState(false)

  const handleNewFolder = async () => {
    if (!accountId || creatingFolder) return
    const name = prompt('New folder name:')?.trim()
    if (!name) return
    setCreatingFolder(true)
    try {
      await jmapClient.createMailbox(accountId, name)
      await refetch()
      toast.success(`Folder “${name}” created`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  // Per-folder actions menu
  const [menuFor, setMenuFor] = React.useState<string | null>(null)
  // Refresh both the folder list/counts and the message list everywhere.
  const refreshAll = () => window.dispatchEvent(new CustomEvent('mailbox-changed'))

  const handleMarkRead = async (mailbox: Mailbox) => {
    setMenuFor(null)
    if (!accountId) return
    try {
      const n = await jmapClient.markMailboxRead(accountId, mailbox.id)
      refreshAll()
      toast.success(n > 0 ? `Marked ${n} message${n > 1 ? 's' : ''} as read` : 'No unread messages')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark read')
    }
  }

  const handleRename = async (mailbox: Mailbox) => {
    setMenuFor(null)
    if (!accountId) return
    const name = prompt('Rename folder:', mailbox.name)?.trim()
    if (!name || name === mailbox.name) return
    try {
      await jmapClient.updateMailbox(accountId, mailbox.id, { name })
      refreshAll()
      toast.success('Folder renamed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  const handleDeleteFolder = async (mailbox: Mailbox) => {
    setMenuFor(null)
    if (!accountId) return
    if (!confirm(`Delete folder “${mailbox.name}”? This can't be undone.`)) return
    try {
      await jmapClient.destroyMailbox(accountId, mailbox.id)
      if (selectedMailboxId === mailbox.id) selectMailbox(null)
      refreshAll()
      toast.success('Folder deleted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  // Check if mobile
  const [isMobile, setIsMobile] = React.useState(false)
  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])
  
  // Auto-select inbox
  React.useEffect(() => {
    if (!selectedMailboxId && mailboxes && mailboxes.length > 0) {
      const inbox = mailboxes.find((m) => m.role === 'inbox')
      if (inbox) {
        selectMailbox(inbox.id)
      } else {
        selectMailbox(mailboxes[0].id)
      }
    }
  }, [mailboxes, selectedMailboxId, selectMailbox])
  
  // Sort mailboxes with custom order
  const sortedMailboxes = React.useMemo(() => {
    if (!mailboxes) return []

    // Define the order for special mailboxes
    const roleOrder: Record<string, number> = {
      'inbox': 1,
      'drafts': 2,
      'junk': 3,
      'spam': 3, // Alternative name for junk
      'trash': 4,
      'sent': 5,
    }
    
    // Separate special and custom mailboxes
    const specialMailboxes: Mailbox[] = []
    const customMailboxes: Mailbox[] = []
    
    mailboxes.forEach(mailbox => {
      if (mailbox.role && roleOrder[mailbox.role] !== undefined) {
        specialMailboxes.push(mailbox)
      } else {
        customMailboxes.push(mailbox)
      }
    })
    
    // Sort special mailboxes by role order
    specialMailboxes.sort((a, b) => {
      const aOrder = a.role ? roleOrder[a.role] : 999
      const bOrder = b.role ? roleOrder[b.role] : 999
      return aOrder - bOrder
    })
    
    // Sort custom mailboxes alphabetically
    customMailboxes.sort((a, b) => a.name.localeCompare(b.name))
    
    // Combine: special mailboxes first, then custom ones
    return [...specialMailboxes, ...customMailboxes]
  }, [mailboxes])
  
  const getMailboxIcon = (role: string | null): string => {
    switch (role) {
      case 'inbox':
        return 'i-lucide:inbox'
      case 'sent':
        return 'i-lucide:send'
      case 'drafts':
        return 'i-lucide:file-text'
      case 'trash':
        return 'i-lucide:trash-2'
      case 'archive':
        return 'i-lucide:archive'
      case 'junk':
      case 'spam':
        return 'i-lucide:shield-x'
      default:
        return 'i-lucide:folder'
    }
  }
  
  const getMailboxColor = (role: string | null): string => {
    switch (role) {
      case 'inbox':
        return 'text-[var(--primary-color)]'
      case 'sent':
        return 'text-[var(--accent-cyan)]'
      case 'drafts':
        return 'text-[var(--accent-yellow)]'
      case 'trash':
        return 'text-[var(--accent-pink)]'
      case 'junk':
      case 'spam':
        return 'text-[var(--accent-orange)]'
      default:
        return 'text-[var(--accent-green)]'
    }
  }
  
  if (isLoading) {
    return (
      <div className="w-full bg-[var(--bg-secondary)] border-r border-[var(--border-color)] p-4">
        <div className="animate-spin i-eos-icons:loading text-xl text-[var(--text-tertiary)]" />
      </div>
    )
  }
  
  if (error) {
    return (
      <div className="w-full h-full bg-[var(--bg-secondary)] border-r border-[var(--border-color)] p-4 flex flex-col items-center justify-center text-center gap-3">
        <div className="i-lucide:wifi-off text-3xl text-[var(--text-tertiary)]" />
        <div className="text-sm text-[var(--text-secondary)]">Couldn't load mailboxes</div>
        <div className="text-xs text-[var(--text-tertiary)] break-words max-w-full">
          {error instanceof Error ? error.message : 'Check your connection and try again.'}
        </div>
        <button
          onClick={() => refetch()}
          className="mt-1 px-3 py-1.5 text-sm bg-[var(--primary-color)] text-[var(--on-primary)] rounded-lg hover:bg-[var(--primary-hover)] transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }
  
  if (!mailboxes || mailboxes.length === 0) {
    return (
      <div className="w-full bg-[var(--bg-secondary)] border-r border-[var(--border-color)] p-4">
        <div className="text-[var(--text-tertiary)]">No mailboxes found</div>
      </div>
    )
  }
  
  return (
    <div className={`
      w-full h-full
      bg-[var(--bg-secondary)] flex flex-col
      ${isMobile && !sidebarOpen ? 'hidden' : ''}
    `}>
      {/* Mailboxes */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* Unified inbox across all accounts (multi-account desktop) */}
        {accounts.length > 1 && (
          <>
            <button
              onClick={showUnifiedInbox}
              className={`w-full px-4 py-2.5 flex items-center gap-3 text-left text-[var(--text-primary)] transition-all hover:bg-white/10 ${
                unifiedView ? 'bg-[var(--primary-color)]/20 border-r-4 border-[var(--primary-color)]' : ''
              }`}
            >
              <div className="i-lucide:layers text-lg flex-shrink-0" />
              <span className="flex-1 min-w-0 truncate font-medium">All inboxes</span>
              {totalUnread > 0 ? (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--primary-color)] text-[var(--on-primary)] font-medium">
                  {totalUnread > 999 ? '999+' : totalUnread}
                </span>
              ) : (
                <span className="text-xs text-[var(--text-tertiary)]">{accounts.length}</span>
              )}
            </button>
            <div className="my-2 mx-4 border-t border-[var(--border-color)]" />
          </>
        )}
        {sortedMailboxes.map((mailbox) => {
          const isSelected = mailbox.id === selectedMailboxId
          const isSpecial = mailbox.role && ['inbox', 'drafts', 'junk', 'spam', 'trash', 'sent'].includes(mailbox.role)
          
          return (
            <React.Fragment key={mailbox.id}>
              {/* Add separator before custom mailboxes */}
              {!isSpecial && sortedMailboxes.indexOf(mailbox) > 0 && 
               sortedMailboxes[sortedMailboxes.indexOf(mailbox) - 1].role && (
                <div className="my-2 mx-4 border-t border-[var(--border-color)]" />
              )}
              
              <div
                className={`group relative w-full flex items-center transition-all hover:bg-white/10 ${
                  isSelected
                    ? 'bg-[var(--primary-color)]/20 border-r-4 border-[var(--primary-color)]'
                    : ''
                }`}
              >
                <button
                  onClick={() => selectMailbox(mailbox.id)}
                  className="flex-1 min-w-0 px-4 py-2.5 flex items-center gap-3 text-left text-[var(--text-primary)]"
                >
                  <div
                    className={`flex-shrink-0 ${getMailboxIcon(mailbox.role)} ${isSelected ? '' : getMailboxColor(mailbox.role)}`}
                  />
                  <span className="flex-1 min-w-0 truncate font-medium">{mailbox.name}</span>
                  {mailbox.unreadEmails > 0 && (
                    <span
                      className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${isSelected ? 'bg-[var(--primary-color)] text-[var(--on-primary)]' : 'bg-[var(--accent-cyan)] text-[var(--on-accent)]'}`}
                    >
                      {mailbox.unreadEmails > 999 ? '999+' : mailbox.unreadEmails}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setMenuFor(menuFor === mailbox.id ? null : mailbox.id)}
                  className="flex-shrink-0 px-2 self-stretch opacity-0 group-hover:opacity-100 focus:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  title="Folder actions"
                >
                  <div className="i-lucide:more-vertical text-sm" />
                </button>
                {menuFor === mailbox.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuFor(null)} />
                    <div className="absolute right-2 top-full z-50 mt-1 w-44 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl py-1">
                      <button
                        onClick={() => handleMarkRead(mailbox)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 flex items-center gap-2"
                      >
                        <div className="i-lucide:check-check text-[var(--text-tertiary)]" /> Mark all read
                      </button>
                      {!isSpecial && (
                        <>
                          <button
                            onClick={() => handleRename(mailbox)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 flex items-center gap-2"
                          >
                            <div className="i-lucide:pencil text-[var(--text-tertiary)]" /> Rename
                          </button>
                          <button
                            onClick={() => handleDeleteFolder(mailbox)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-red-400/10 text-red-400 flex items-center gap-2"
                          >
                            <div className="i-lucide:trash-2" /> Delete
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </React.Fragment>
          )
        })}
      </div>
      
      {/* Bottom section */}
      <div className="border-t border-[var(--border-color)] p-4">
        <button
          onClick={handleNewFolder}
          disabled={creatingFolder}
          className="w-full flex items-center gap-3 px-3 py-2 text-[var(--text-primary)] hover:text-[var(--accent-cyan)] hover:bg-white/10 rounded transition-all disabled:opacity-50"
          title="Create a new folder"
        >
          <div className={creatingFolder ? 'i-eos-icons:loading animate-spin' : 'i-lucide:folder-plus'} />
          <span className="text-sm">New folder</span>
        </button>
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 text-[var(--text-primary)] hover:text-red-400 hover:bg-red-400/10 rounded transition-all mt-2"
          title="Sign out"
        >
          <div className="i-lucide:log-out" />
          <span className="text-sm">Sign out</span>
        </button>
      </div>
    </div>
  )
}
