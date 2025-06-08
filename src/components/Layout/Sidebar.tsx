import React from 'react'
import { useMailboxes } from '../../hooks/useJMAP'
import { useMailStore } from '../../stores/mailStore'
import { Mailbox } from '../../api/types'

interface MailboxItemProps {
  mailbox: Mailbox
  children: Mailbox[]
  childrenByParent: Record<string, Mailbox[]>
  isSelected: boolean
  onSelect: () => void
  depth: number
}

function getMailboxIcon(role: string | null): string {
  switch (role) {
    case 'inbox': return 'i-lucide:inbox'
    case 'sent': return 'i-lucide:send'
    case 'drafts': return 'i-lucide:file-text'
    case 'trash': return 'i-lucide:trash-2'
    case 'archive': return 'i-lucide:archive'
    case 'junk': return 'i-lucide:shield-x'
    default: return 'i-lucide:folder'
  }
}

export function MailboxItem({
  mailbox,
  children,
  childrenByParent,
  isSelected,
  onSelect,
  depth
}: MailboxItemProps) {
  const [isExpanded, setIsExpanded] = React.useState(true)
  const hasChildren = children.length > 0
  const paddingLeft = 12 + (depth * 16)
  
  return (
    <div>
      <div
        className={`
          flex items-center px-3 py-2 cursor-pointer transition-colors
          hover:bg-gray-100
          ${isSelected ? 'bg-primary-light bg-opacity-10 text-primary font-medium' : 'text-gray-700'}
        `}
        style={{ paddingLeft: `${paddingLeft}px` }}
        onClick={onSelect}
      >
        {hasChildren && (
          <button
            className="mr-1 p-0.5 hover:bg-gray-200 rounded transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(!isExpanded)
            }}
          >
            <div className={`
              i-lucide:chevron-right text-xs transition-transform
              ${isExpanded ? 'rotate-90' : ''}
            `} />
          </button>
        )}
        
        <div className={`${getMailboxIcon(mailbox.role)} mr-2 flex-shrink-0`} />
        
        <span className="flex-1 truncate">{mailbox.name}</span>
        
        {mailbox.unreadEmails > 0 && (
          <span className={`
            text-xs px-1.5 py-0.5 rounded-full flex-shrink-0
            ${isSelected ? 'bg-primary text-white' : 'bg-gray-200 text-gray-700'}
          `}>
            {mailbox.unreadEmails > 999 ? '999+' : mailbox.unreadEmails}
          </span>
        )}
      </div>
      
      {hasChildren && isExpanded && (
        <div>
          {children
            .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            .map((child) => (
              <MailboxItem
                key={child.id}
                mailbox={child}
                children={childrenByParent[child.id] || []}
                childrenByParent={childrenByParent}
                isSelected={isSelected}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  const { data: mailboxes, isLoading, error } = useMailboxes()
  const selectedMailboxId = useMailStore((state) => state.selectedMailboxId)
  const selectMailbox = useMailStore((state) => state.selectMailbox)
  
  // Auto-select inbox if no mailbox is selected
  React.useEffect(() => {
    if (!selectedMailboxId && mailboxes && mailboxes.length > 0) {
      const inbox = mailboxes.find(m => m.role === 'inbox')
      if (inbox) {
        selectMailbox(inbox.id)
      } else if (mailboxes.length > 0) {
        selectMailbox(mailboxes[0].id)
      }
    }
  }, [mailboxes, selectedMailboxId, selectMailbox])
  
  if (isLoading) {
    return (
      <div className="w-full h-full flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Mailboxes</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="i-eos-icons:loading animate-spin text-xl text-gray-500" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Mailboxes</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <div className="i-lucide:alert-circle text-red-500 text-xl mb-2" />
            <p className="text-sm text-red-600">Failed to load mailboxes</p>
          </div>
        </div>
      </div>
    )
  }

  if (!mailboxes || mailboxes.length === 0) {
    return (
      <div className="w-full h-full flex flex-col bg-gray-50">
        <div className="p-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">Mailboxes</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-gray-500">No mailboxes found</p>
        </div>
      </div>
    )
  }
  
  const rootMailboxes = mailboxes.filter(m => !m.parentId)
  const childrenByParent = mailboxes.reduce((acc, m) => {
    if (m.parentId) {
      if (!acc[m.parentId]) acc[m.parentId] = []
      acc[m.parentId].push(m)
    }
    return acc
  }, {} as Record<string, typeof mailboxes>)
  
  return (
    <div className="w-full h-full flex flex-col bg-gray-50">
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">Mailboxes</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto py-2">
        {rootMailboxes
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((mailbox) => (
            <MailboxItem
              key={mailbox.id}
              mailbox={mailbox}
              children={childrenByParent[mailbox.id] || []}
              childrenByParent={childrenByParent}
              isSelected={mailbox.id === selectedMailboxId}
              onSelect={() => selectMailbox(mailbox.id)}
              depth={0}
            />
          ))}
      </div>
      
      <div className="p-4 border-t border-gray-200">
        <button className="btn w-full justify-center">
          <div className="i-lucide:edit mr-2" />
          Compose
        </button>
      </div>
    </div>
  )
}
