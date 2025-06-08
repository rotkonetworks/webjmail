import React from 'react'
import { format } from 'date-fns'
import DOMPurify from 'dompurify'
import { useAuthStore } from '../../stores/authStore'
import { useMailStore } from '../../stores/mailStore'
import { useMarkAsRead } from '../../hooks/useJMAP'

export function MessageView() {
  const session = useAuthStore((state) => state.session)
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const emails = useMailStore((state) => state.emails)
  const markAsRead = useMarkAsRead()
  
  const email = selectedEmailId ? emails[selectedEmailId] : null
  const primaryAccountId = session?.primaryAccounts['urn:ietf:params:jmap:mail']
  
  React.useEffect(() => {
    if (email && primaryAccountId && !email.keywords.$seen) {
      markAsRead.mutate({
        accountId: primaryAccountId,
        emailId: email.id,
        isRead: true,
      })
    }
  }, [email?.id, email?.keywords.$seen, primaryAccountId])

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <div className="i-lucide:mail text-6xl mb-4 opacity-20" />
          <p>Select an email to read</p>
        </div>
      </div>
    )
  }

  const htmlBody = email.htmlBody?.[0]
  const textBody = email.textBody?.[0]
  const bodyValue = htmlBody 
    ? email.bodyValues[htmlBody.partId]
    : textBody 
    ? email.bodyValues[textBody.partId]
    : null

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Email Header */}
      <div className="border-b border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <h1 className="text-2xl font-semibold text-gray-900">
            {email.subject || '(no subject)'}
          </h1>
          <div className="flex items-center gap-2">
            <button
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Archive"
            >
              <div className="i-lucide:archive text-gray-600" />
            </button>
            <button
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Delete"
            >
              <div className="i-lucide:trash-2 text-gray-600" />
            </button>
            <button
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Mark as unread"
              onClick={() => {
                markAsRead.mutate({
                  emailId: email.id,
                  isRead: false,
                })
              }}
            >
              <div className="i-lucide:mail text-gray-600" />
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-semibold">
              {email.from?.[0]?.name?.charAt(0).toUpperCase() || 
               email.from?.[0]?.email.charAt(0).toUpperCase() || '?'}
            </div>
            <div>
              <div className="font-medium text-gray-900">
                {email.from?.[0]?.name || email.from?.[0]?.email || 'Unknown'}
              </div>
              <div className="text-gray-600">
                {email.from?.[0]?.email}
              </div>
            </div>
          </div>
          
          <div className="ml-auto text-gray-600">
            {format(new Date(email.receivedAt), 'PPp')}
          </div>
        </div>
        
        {email.to && email.to.length > 0 && (
          <div className="mt-3 text-sm text-gray-600">
            <span className="font-medium">To:</span>{' '}
            {email.to.map(addr => addr.name || addr.email).join(', ')}
          </div>
        )}
      </div>
      
      {/* Email Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {bodyValue && (
          <div className="prose prose-sm max-w-none">
            {htmlBody ? (
              <div 
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(bodyValue.value, {
                    ALLOWED_TAGS: [
                      'a', 'abbr', 'address', 'article', 'aside', 'b', 'blockquote',
                      'br', 'caption', 'cite', 'code', 'dd', 'del', 'details', 'div',
                      'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2',
                      'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'ins', 'kbd',
                      'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 's', 'section',
                      'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody',
                      'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul'
                    ],
                    ALLOWED_ATTR: [
                      'alt', 'cite', 'class', 'colspan', 'datetime', 'height', 'href',
                      'id', 'rowspan', 'src', 'style', 'title', 'width'
                    ],
                    ALLOW_DATA_ATTR: false,
                  })
                }}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans">
                {bodyValue.value}
              </pre>
            )}
          </div>
        )}
        
        {/* Attachments */}
        {email.attachments && email.attachments.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              Attachments ({email.attachments.length})
            </h3>
            <div className="space-y-2">
              {email.attachments.map((attachment) => (
                <div
                  key={attachment.partId}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                >
                  <div className="i-lucide:paperclip text-gray-600" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {attachment.name || 'Unnamed attachment'}
                    </div>
                    <div className="text-xs text-gray-600">
                      {(attachment.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                    title="Download"
                  >
                    <div className="i-lucide:download text-gray-600" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* Action Bar */}
      <div className="border-t border-gray-200 p-4 flex gap-3">
        <button className="btn">
          <div className="i-lucide:reply mr-2" />
          Reply
        </button>
        <button className="btn bg-gray-200 text-gray-700 hover:bg-gray-300">
          <div className="i-lucide:reply-all mr-2" />
          Reply All
        </button>
        <button className="btn bg-gray-200 text-gray-700 hover:bg-gray-300">
          <div className="i-lucide:forward mr-2" />
          Forward
        </button>
      </div>
    </div>
  )
}
