import React, { useRef, useEffect, useState, memo, useCallback } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useManualRefresh } from '../../hooks'
import { useSearchStore } from '../../stores/searchStore'
import { useDeviceType } from '../../hooks/useDeviceType'
import { config } from '../../config'

interface HeaderProps {
  onCompose: () => void
  onSettings: () => void
}

export const Header = memo(function Header({ onCompose, onSettings }: HeaderProps) {
  const session = useAuthStore((state) => state.session)
  const searchRef = useRef<HTMLInputElement>(null)
  const manualRefresh = useManualRefresh()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const isMobile = useDeviceType()
  
  // Use search store
  const searchQuery = useSearchStore((state) => state.query)
  const setSearchQuery = useSearchStore((state) => state.setQuery)

  // Focus search on Cmd/Ctrl + K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
      
      // Add Cmd/Ctrl + R for manual refresh
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault()
        handleManualRefresh()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true)
    console.log('[Header] Manual refresh triggered')
    manualRefresh()
    
    // Visual feedback
    setTimeout(() => {
      setIsRefreshing(false)
    }, 1000)
  }, [manualRefresh])

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }, [setSearchQuery])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
  }, [setSearchQuery])

  const username = session?.username || 'User'
  const firstLetter = username.charAt(0).toUpperCase()

  if (isMobile) {
    // Simplified mobile header
    return (
      <header className="h-14 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between px-3">
        {/* Logo only */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[var(--proton-purple)] rounded-lg flex items-center justify-center">
            <div className="i-lucide:mail text-white text-base" />
          </div>
          <span className="font-semibold">{config.appName}</span>
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <div className={`i-lucide:refresh-cw text-sm ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={onCompose}
            className="p-2 hover:bg-white/10 rounded-lg bg-[var(--primary-color)]"
          >
            <div className="i-lucide:edit-3 text-white text-sm" />
          </button>

          <button onClick={onSettings} className="p-2 hover:bg-white/10 rounded-lg" title="Settings">
            <div className="i-lucide:settings text-sm" />
          </button>
        </div>
      </header>
    )
  }

  // Desktop header
  return (
    <header className="h-[var(--header-height)] bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center px-4 gap-4">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-[var(--proton-purple)] rounded-lg flex items-center justify-center">
          <div className="i-lucide:mail text-white text-lg" />
        </div>
        <span className="font-semibold text-lg">{config.appName}</span>
      </div>

      {/* Search Bar - Central and prominent */}
      <div className="flex-1 max-w-2xl mx-auto">
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 i-lucide:search text-[var(--text-tertiary)]" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search messages... (⌘K)"
            className="search-input w-full pl-10 pr-4 py-2 rounded-lg text-sm"
          />
          {searchQuery && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded"
            >
              <div className="i-lucide:x text-sm" />
            </button>
          )}
        </div>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-2">
        {/* Manual Refresh Button */}
        <button
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh emails (⌘R)"
        >
          <div className={`i-lucide:refresh-cw ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>

        {/* Compose Button */}
        <button
          onClick={onCompose}
          className="compose-btn px-4 py-2 rounded-lg flex items-center gap-2"
        >
          <div className="i-lucide:edit-3" />
          <span>New message</span>
        </button>

        {/* User Menu */}
        <div className="flex items-center gap-3 ml-4">
          <div className="w-8 h-8 bg-[var(--primary-color)] rounded-full flex items-center justify-center text-sm font-medium">
            {firstLetter}
          </div>
          <span className="text-sm text-[var(--text-secondary)]">{username}</span>
        </div>

        {/* Settings */}
        <button onClick={onSettings} className="settings-btn p-2 rounded-lg ml-2" title="Settings">
          <div className="i-lucide:settings" />
        </button>
      </div>
    </header>
  )
})
