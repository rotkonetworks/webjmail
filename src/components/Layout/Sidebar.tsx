import React from 'react'

interface Mailbox {
  id: string
  name: string
  parentId: string | null
  role: string | null
  totalEmails: number
  unreadEmails: number
  sortOrder: number
}

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
  // Mock data for demonstration
  const mailboxes: Mailbox[] = [
    { id: '1', name: 'Inbox', parentId: null, role: 'inbox', totalEmails: 523, unreadEmails: 12, sortOrder: 1 },
    { id: '2', name: 'Sent', parentId: null, role: 'sent', totalEmails: 234, unreadEmails: 0, sortOrder: 2 },
    { id: '3', name: 'Drafts', parentId: null, role: 'drafts', totalEmails: 5, unreadEmails: 0, sortOrder: 3 },
    { id: '4', name: 'Archive', parentId: null, role: 'archive', totalEmails: 1832, unreadEmails: 0, sortOrder: 4 },
    { id: '5', name: 'Trash', parentId: null, role: 'trash', totalEmails: 43, unreadEmails: 0, sortOrder: 5 },
    { id: '6', name: 'Work', parentId: null, role: null, totalEmails: 156, unreadEmails: 3, sortOrder: 10 },
    { id: '7', name: 'Projects', parentId: '6', role: null, totalEmails: 89, unreadEmails: 2, sortOrder: 1 },
    { id: '8', name: 'Personal', parentId: null, role: null, totalEmails: 234, unreadEmails: 1, sortOrder: 11 },
  ]
  
  const [selectedId, setSelectedId] = React.useState('1')
  
  const rootMailboxes = mailboxes.filter(m => !m.parentId)
  const childrenByParent = mailboxes.reduce((acc, m) => {
    if (m.parentId) {
      if (!acc[m.parentId]) acc[m.parentId] = []
      acc[m.parentId].push(m)
    }
    return acc
  }, {} as Record<string, Mailbox[]>)
  
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
              isSelected={mailbox.id === selectedId}
              onSelect={() => setSelectedId(mailbox.id)}
              depth={0}
            />
          ))}
      </div>
      
      <div className="p-4 border-t border-gray-200">
        <button className="btn w-full justify-center">
          <div className="i-lucide:plus mr-2" />
          New Mailbox
        </button>
      </div>
    </div>
  )
}
