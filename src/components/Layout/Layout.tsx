import { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MessageList } from '../Message/MessageList'
import { UnifiedInbox } from '../Message/UnifiedInbox'
import { MessageView } from '../Message/MessageView'
import { InlineComposer } from '../Message/InlineComposer'
import { SettingsPanel } from './SettingsPanel'
import { ResizablePane } from './ResizablePane'
import { useMailStore } from '../../stores/mailStore'
import { useUIStore } from '../../stores/uiStore'
import { MobileBottomNav } from './MobileBottomNav'
import { useDeviceType } from '../../hooks/useDeviceType'
import { useLocalIndex } from '../../hooks/useIndexedDB'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { usePrimaryAccountId } from '../../hooks'
import { toast } from '../../stores/toastStore'
import { AgentChat } from '../Agent/AgentChat'
import { useDraftStore } from '../../stores/draftStore'

interface Composer {
  id: string
  mode: 'compose' | 'reply' | 'replyAll' | 'forward'
  replyTo?: any
  isMinimized: boolean
  initial?: { to?: string; cc?: string; subject?: string; body?: string }
}

// Memoize child components
const MemoizedSidebar = memo(Sidebar)
const MemoizedMessageList = memo(MessageList)
const MemoizedMessageView = memo(MessageView)
const MemoizedSettingsPanel = memo(SettingsPanel)

export function Layout() {
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const unifiedView = useMailStore((state) => state.unifiedView)
  const desktopViewMode = useUIStore((state) => state.viewMode)
  const theme = useUIStore((state) => state.theme)
  const font = useUIStore((state) => state.font)
  const sidebarWidth = useUIStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUIStore((state) => state.setSidebarWidth)
  const messageListWidth = useUIStore((state) => state.messageListWidth)
  const setMessageListWidth = useUIStore((state) => state.setMessageListWidth)
  const agentPanelWidth = useUIStore((state) => state.agentPanelWidth)
  const setAgentPanelWidth = useUIStore((state) => state.setAgentPanelWidth)
  
  const [showComposer, setShowComposer] = useState(false)
  const [composers, setComposers] = useState<Composer[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [showAgent, setShowAgent] = useState(false)
  const isMobile = useDeviceType()
  const accountId = usePrimaryAccountId()

  // The single AI-editable draft (shared with the assistant via draftStore).
  const draftOpen = useDraftStore((s) => s.open)
  const closeDraft = useDraftStore((s) => s.close)

  // Build/maintain the local email index for offline full-text search.
  useLocalIndex()

  // Connectivity awareness: offline banner + a "back online" toast.
  const online = useOnlineStatus()
  const wasOnline = useRef(online)
  useEffect(() => {
    if (online && !wasOnline.current) toast.success('Back online')
    wasOnline.current = online
  }, [online])
  
  // Force row mode on mobile
  const viewMode = isMobile ? 'row' : desktopViewMode
  
  // Apply theme and font to document
  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
    document.documentElement.setAttribute('data-font', font)
  }, [theme, font])
  
  // Memoized callbacks
  const handleEmailSelect = useCallback((emailId: string) => {
    selectEmail(emailId)
  }, [selectEmail])
  
  const handleCloseEmail = useCallback(() => {
    selectEmail(null)
  }, [selectEmail])
  
  const handleCompose = useCallback(() => {
    // Add new inline composer
    const newComposer: Composer = {
      id: `composer-${Date.now()}`,
      mode: 'compose',
      isMinimized: false,
    }
    setComposers(prev => [...prev, newComposer])
  }, [])
  
  const handleReply = useCallback((mode: 'reply' | 'replyAll' | 'forward', replyTo: any) => {
    const newComposer: Composer = {
      id: `composer-${Date.now()}`,
      mode,
      replyTo,
      isMinimized: false,
    }
    setComposers(prev => [...prev, newComposer])
  }, [])
  
  const handleCloseComposer = useCallback((id: string) => {
    setComposers(composers => composers.filter(c => c.id !== id))
  }, [])
  
  const handleMinimizeComposer = useCallback((id: string) => {
    setComposers(composers => composers.map(c => 
      c.id === id ? { ...c, isMinimized: !c.isMinimized } : c
    ))
  }, [])
  
  const toggleSettings = useCallback(() => {
    setShowSettings(prev => !prev)
  }, [])
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + N for new email
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        handleCompose()
      }
      
      // Escape to close all composers
      if (e.key === 'Escape' && composers.length > 0) {
        e.preventDefault()
        setComposers([])
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [composers.length, handleCompose])
  
  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Offline banner */}
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-[var(--accent-orange)]/15 text-[var(--accent-orange)] text-xs py-1 px-3 border-b border-[var(--accent-orange)]/30">
          <div className="i-lucide:wifi-off" />
          <span>You're offline — showing cached mail</span>
        </div>
      )}

      {/* Header */}
      <Header
        onCompose={handleCompose}
        onSettings={toggleSettings}
        onAgent={() => setShowAgent((v) => !v)}
      />
      
      {/* Main Content (hidden, not unmounted, while the narrow assistant is up
          so the mail list keeps its scroll position) */}
      <div className={`flex-1 flex overflow-hidden ${isMobile && showAgent ? 'hidden' : ''}`}>
        {/* Sidebar - hide on mobile */}
        {!isMobile && (
          <ResizablePane
            width={sidebarWidth}
            minWidth={180}
            maxWidth={400}
            onResize={setSidebarWidth}
            direction="right"
          >
            <MemoizedSidebar />
          </ResizablePane>
        )}
        
        {/* Content area based on view mode and screen size */}
        {viewMode === 'column' && !isMobile ? (
          <>
            {/* Column Mode: Split view */}
            <ResizablePane
              width={messageListWidth}
              minWidth={250}
              maxWidth={600}
              onResize={setMessageListWidth}
              direction="right"
              className="bg-[var(--bg-secondary)] border-r border-[var(--border-color)]"
            >
              {unifiedView ? (
                <UnifiedInbox onSelectEmail={handleEmailSelect} />
              ) : (
                <MemoizedMessageList onSelectEmail={handleEmailSelect} />
              )}
            </ResizablePane>
            
            {/* Email view area */}
            <div className="flex-1 min-w-0 bg-[var(--bg-primary)] overflow-hidden relative">
              {selectedEmailId ? (
                <MemoizedMessageView 
                  onReply={handleReply} 
                />
              ) : (
                <div className="h-full flex items-center justify-center">
                  <div className="empty-state">
                    <div className="empty-state-icon i-lucide:mail" />
                    <p className="text-lg mb-2">No conversation selected</p>
                    <p className="text-sm">Choose a conversation from the list to read</p>
                  </div>
                </div>
              )}
              
              {/* Settings Panel overlays on right */}
              {showSettings && (
                <MemoizedSettingsPanel 
                  isOpen={showSettings} 
                  onClose={() => setShowSettings(false)} 
                />
              )}
            </div>
          </>
        ) : (
          <>
            {/* Row Mode or Mobile: Single area that switches between list and email */}
            <div className="flex-1 min-w-0 bg-[var(--bg-secondary)] overflow-hidden relative">
              {selectedEmailId ? (
                // Show email view in the same space
                <MemoizedMessageView
                  onClose={handleCloseEmail}
                  onReply={handleReply}
                />
              ) : (
                // Show message list (unified or single-account)
                unifiedView ? (
                  <UnifiedInbox onSelectEmail={handleEmailSelect} />
                ) : (
                  <MemoizedMessageList viewMode="row" onSelectEmail={handleEmailSelect} />
                )
              )}
              
              {/* Settings Panel overlays on right */}
              {showSettings && (
                <MemoizedSettingsPanel 
                  isOpen={showSettings} 
                  onClose={() => setShowSettings(false)} 
                />
              )}
            </div>
          </>
        )}

        {/* AI email assistant — sits in the content row so it pushes the
            layout (shrinks the message/email area) instead of overlaying it,
            and stays below the header bar. Resizable from its left edge. */}
        {showAgent && !isMobile && (
          <ResizablePane
            width={agentPanelWidth}
            minWidth={320}
            maxWidth={720}
            onResize={setAgentPanelWidth}
            direction="left"
            className="flex-shrink-0"
          >
            <AgentChat
              accountId={accountId}
              onClose={() => setShowAgent(false)}
              onOpenSettings={() => setShowSettings(true)}
            />
          </ResizablePane>
        )}
      </div>

      {/* Narrow layout (mobile / browser-extension side panel): the assistant
          fills the area BELOW the header (in normal flow, so the offline banner
          + header push it down correctly — no magic offset). The header's core
          menus stay visible and clickable. Chat|Draft tabs live inside it; the
          draft is hosted in the Draft tab (no floating card). */}
      {showAgent && isMobile && (
        <div className="flex-1 min-h-0 flex">
          <AgentChat
            narrow
            accountId={accountId}
            onClose={() => setShowAgent(false)}
            onOpenSettings={() => setShowSettings(true)}
          />
        </div>
      )}

      {/* Mobile bottom navigation — hidden while the assistant is open (its
          header provides the core menus; the assistant needs the space). */}
      {isMobile && !selectedEmailId && !showAgent && (
        <MobileBottomNav />
      )}
      
      {/* Inline Composers — docked along the bottom edge and tiled horizontally
          (Gmail-style) instead of stacking on top of each other. Each one is
          offset to the left by the cumulative width of the composers to its
          right. On desktop they also clear the assistant panel when it's open. */}
      {(() => {
        const COMPOSER_W = 500 // matches InlineComposer w-[500px]
        const MIN_W = 320 // matches minimized w-80
        const GAP = 12
        let cursor = 16 + (showAgent && !isMobile ? agentPanelWidth : 0)
        return composers.map((composer, index) => {
          const rightPx = cursor
          cursor += (composer.isMinimized ? MIN_W : COMPOSER_W) + GAP
          return (
            <InlineComposer
              key={composer.id}
              onClose={() => handleCloseComposer(composer.id)}
              onMinimize={() => handleMinimizeComposer(composer.id)}
              isMinimized={composer.isMinimized}
              replyTo={composer.replyTo}
              mode={composer.mode}
              initial={composer.initial}
              isMobile={isMobile}
              rightPx={rightPx}
              bottomPx={0}
              zIndex={100 + index}
            />
          )
        })
      })()}

      {/* Assistant-editable draft — a single composer bound to draftStore so the
          AI can write/revise it live while the user edits by hand. Sits left of
          the assistant panel on desktop; floats above it on mobile (z above the
          mobile assistant overlay). */}
      {/* Floating bound draft — shown except when the narrow assistant is open
          (there the draft lives in its Draft tab). On desktop it sits left of
          the assistant panel; on narrow-without-assistant it's a bottom card. */}
      {draftOpen && !(isMobile && showAgent) && (
        <InlineComposer
          onClose={closeDraft}
          isMobile={isMobile}
          bound
          rightPx={16 + (!isMobile && showAgent ? agentPanelWidth : 0)}
          zIndex={130}
        />
      )}
    </div>
  )
}
