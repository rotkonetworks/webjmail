import React, { useState, useEffect } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { MessageList } from '../Message/MessageList'
import { MessageView } from '../Message/MessageView'
import { MessageComposer } from '../Message/MessageComposer'
import { SettingsPanel } from './SettingsPanel'
import { useMailStore } from '../../stores/mailStore'
import { useUIStore } from '../../stores/uiStore'

export function Layout() {
  const selectedEmailId = useMailStore((state) => state.selectedEmailId)
  const selectEmail = useMailStore((state) => state.selectEmail)
  const viewMode = useUIStore((state) => state.viewMode)
  const theme = useUIStore((state) => state.theme)
  const font = useUIStore((state) => state.font)
  const [showComposer, setShowComposer] = useState(false)
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

  // Handle Enter key for opening emails
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && selectedEmailId && viewMode === 'column') {
        // Enter key behavior handled by MessageList component
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedEmailId, viewMode])

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <Header 
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onCompose={() => setShowComposer(true)}
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
              <MessageList 
                searchQuery={searchQuery} 
                onSelectEmail={handleEmailSelect}
              />
            </div>
            
            {/* Email view area */}
            <div className="flex-1 bg-[var(--bg-primary)] overflow-hidden relative">
              {selectedEmailId ? (
                <MessageView />
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
                <SettingsPanel 
                  isOpen={showSettings} 
                  onClose={() => setShowSettings(false)} 
                />
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
                  <MessageView onClose={handleCloseEmail} />
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
                <SettingsPanel 
                  isOpen={showSettings} 
                  onClose={() => setShowSettings(false)} 
                />
              )}
            </div>
          </>
        )}
      </div>
      
      {/* Composer Modal */}
      {showComposer && (
        <MessageComposer onClose={() => setShowComposer(false)} />
      )}
    </div>
  )
}
