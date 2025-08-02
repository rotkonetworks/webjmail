// src/components/Layout/Layout.tsx
import { useState, useEffect, useCallback, memo } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MessageList } from '../Message/MessageList'
import { MessageView } from '../Message/MessageView'
import { MessageComposer } from '../Message/MessageComposer'
import { InlineComposer } from '../Message/InlineComposer'
import { SettingsPanel } from './SettingsPanel'
import { ResizablePane } from './ResizablePane'
import { useMailStore } from '../../stores/mailStore'
import { useUIStore } from '../../stores/uiStore'

interface Composer {
  id: string
  mode: 'compose' | 'reply' | 'replyAll' | 'forward'
  replyTo?: any
  isMinimized: boolean
}

// Memoize child components
const MemoizedSidebar = memo(Sidebar)
const MemoizedMessageList = memo(MessageList)
const MemoizedMessageView = memo(MessageView)
const MemoizedSettingsPanel = memo(SettingsPanel)

export function Layout() {
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const viewMode = useUIStore((state) => state.viewMode)
  const theme = useUIStore((state) => state.theme)
  const font = useUIStore((state) => state.font)
  const sidebarWidth = useUIStore((state) => state.sidebarWidth)
  const setSidebarWidth = useUIStore((state) => state.setSidebarWidth)
  const messageListWidth = useUIStore((state) => state.messageListWidth)
  const setMessageListWidth = useUIStore((state) => state.setMessageListWidth)
  
  const [showComposer, setShowComposer] = useState(false)
  const [composers, setComposers] = useState<Composer[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isTablet, setIsTablet] = useState(false)
  
  // Apply theme and font to document
  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
    document.documentElement.setAttribute('data-font', font)
  }, [theme, font])
  
  // Responsive design detection
  useEffect(() => {
    const checkScreenSize = () => {
      const width = window.innerWidth
      setIsMobile(width < 768)
      setIsTablet(width >= 768 && width < 1024)
    }
    
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])
  
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
      {/* Header */}
      <Header
        onCompose={handleCompose}
        onSettings={toggleSettings}
      />
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - responsive visibility */}
        {(!isMobile || viewMode === 'column') && (
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
              <MemoizedMessageList 
                onSelectEmail={handleEmailSelect}
              />
            </ResizablePane>
            
            {/* Email view area */}
            <div className="flex-1 bg-[var(--bg-primary)] overflow-hidden relative">
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
            <div className="flex-1 bg-[var(--bg-secondary)] overflow-hidden relative">
              {selectedEmailId ? (
                // Show email view in the same space
                <div className="h-full bg-[var(--bg-primary)]">
                  <MemoizedMessageView 
                    onClose={handleCloseEmail} 
                    onReply={handleReply}
                  />
                </div>
              ) : (
                // Show message list
                <MemoizedMessageList
                  viewMode="row"
                  onSelectEmail={handleEmailSelect}
                />
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
      </div>
      
      {/* Inline Composers - responsive positioning */}
      {composers.map((composer, index) => (
        <div
          key={composer.id}
          style={{
            bottom: composer.isMinimized ? `${index * 50}px` : `${index * 100}px`,
            right: isMobile ? '8px' : `${(index * 20) + 16}px`,
            left: isMobile ? '8px' : 'auto',
            zIndex: 100 + index,
          }}
          className="fixed"
        >
          <InlineComposer
            onClose={() => handleCloseComposer(composer.id)}
            onMinimize={() => handleMinimizeComposer(composer.id)}
            isMinimized={composer.isMinimized}
            replyTo={composer.replyTo}
            mode={composer.mode}
            isMobile={isMobile}
          />
        </div>
      ))}
    </div>
  )
}
