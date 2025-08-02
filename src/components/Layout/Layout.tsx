// src/components/Layout/Layout.tsx
import React, { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MessageList } from '../Message/MessageList'
import { MessageView } from '../Message/MessageView'
import { MessageComposer } from '../Message/MessageComposer'
import { InlineComposer } from '../Message/InlineComposer'
import { SettingsPanel } from './SettingsPanel'
import { useMailStore } from '../../stores/mailStore'
import { useUIStore } from '../../stores/uiStore'

interface Composer {
  id: string
  mode: 'compose' | 'reply' | 'replyAll' | 'forward'
  replyTo?: any
  isMinimized: boolean
}

export function Layout() {
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const viewMode = useUIStore((state) => state.viewMode)
  const theme = useUIStore((state) => state.theme)
  const font = useUIStore((state) => state.font)
  const composerMode = useUIStore((state) => state.composerMode)
  
  const [showComposer, setShowComposer] = useState(false)
  const [composers, setComposers] = useState<Composer[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  
  // Apply theme and font to document
  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
    document.documentElement.setAttribute('data-font', font)
  }, [theme, font])
  
  const handleEmailSelect = (emailId: string) => {
    selectEmail(emailId)
  }
  
  const handleCloseEmail = () => {
    selectEmail(null)
  }
  
  const handleCompose = () => {
    if (composerMode === 'popup') {
      setShowComposer(true)
    } else {
      // Add new inline composer
      const newComposer: Composer = {
        id: `composer-${Date.now()}`,
        mode: 'compose',
        isMinimized: false,
      }
      setComposers([...composers, newComposer])
    }
  }
  
  const handleReply = (mode: 'reply' | 'replyAll' | 'forward', replyTo: any) => {
    if (composerMode === 'popup') {
      // Will be handled by MessageView component
    } else {
      const newComposer: Composer = {
        id: `composer-${Date.now()}`,
        mode,
        replyTo,
        isMinimized: false,
      }
      setComposers([...composers, newComposer])
    }
  }
  
  const handleCloseComposer = (id: string) => {
    setComposers(composers.filter(c => c.id !== id))
  }
  
  const handleMinimizeComposer = (id: string) => {
    setComposers(composers.map(c => 
      c.id === id ? { ...c, isMinimized: !c.isMinimized } : c
    ))
  }
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + N for new email
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        handleCompose()
      }
      
      // Escape to close all composers when using inline mode
      if (e.key === 'Escape' && composerMode !== 'popup' && composers.length > 0) {
        e.preventDefault()
        setComposers([])
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [composerMode, composers])
  
  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onCompose={handleCompose}
        onSettings={() => setShowSettings(!showSettings)}
      />
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - always visible */}
        <Sidebar />
        
        {/* Content area based on view mode */}
        {viewMode === 'column' ? (
          <>
            {/* Column Mode: Split view */}
            <div className="w-[400px] bg-[var(--bg-secondary)] border-r border-[var(--border-color)] overflow-hidden">
              <MessageList searchQuery={searchQuery} onSelectEmail={handleEmailSelect} />
            </div>
            
            {/* Email view area */}
            <div className="flex-1 bg-[var(--bg-primary)] overflow-hidden relative">
              {selectedEmailId ? (
                <MessageView onReply={composerMode === 'inline' ? handleReply : undefined} />
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
                <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
              )}
            </div>
          </>
        ) : (
          <>
            {/* Row Mode: Single area that switches between list and email */}
            <div className="flex-1 bg-[var(--bg-secondary)] overflow-hidden relative">
              {selectedEmailId ? (
                // Show email view in the same space
                <div className="h-full bg-[var(--bg-primary)]">
                  <MessageView 
                    onClose={handleCloseEmail} 
                    onReply={composerMode === 'inline' ? handleReply : undefined}
                  />
                </div>
              ) : (
                // Show message list
                <MessageList
                  searchQuery={searchQuery}
                  viewMode="row"
                  onSelectEmail={handleEmailSelect}
                />
              )}
              
              {/* Settings Panel overlays on right */}
              {showSettings && (
                <SettingsPanel isOpen={showSettings} onClose={() => setShowSettings(false)} />
              )}
            </div>
          </>
        )}
      </div>
      
      {/* Popup Composer Modal */}
      {showComposer && composerMode === 'popup' && (
        <MessageComposer onClose={() => setShowComposer(false)} />
      )}
      
      {/* Inline Composers */}
      {composerMode === 'inline' && composers.map((composer, index) => (
        <div
          key={composer.id}
          style={{
            bottom: composer.isMinimized ? `${index * 50}px` : `${index * 100}px`,
            right: `${(index * 20) + 16}px`,
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
          />
        </div>
      ))}
      
      {/* Facebook-style chat heads (future implementation) */}
      {composerMode === 'facebook' && composers.length > 0 && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2">
          {composers.map((composer) => (
            <div
              key={composer.id}
              className="w-14 h-14 bg-[var(--primary-color)] rounded-full flex items-center justify-center text-white font-bold cursor-pointer shadow-lg hover:scale-110 transition-transform"
              onClick={() => handleMinimizeComposer(composer.id)}
              title={composer.mode === 'compose' ? 'New Message' : composer.replyTo?.subject}
            >
              <div className="i-lucide:message-circle text-xl" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
