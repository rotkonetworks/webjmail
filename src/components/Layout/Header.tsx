import React, { useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { config } from '../../config'
import { MessageComposer } from '../Message/MessageComposer'

export function Header() {
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const { session, logout } = useAuthStore()
  const username = session?.username || 'User'
  const [showComposer, setShowComposer] = useState(false)

  return (
    <>
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <button
            onClick={toggleSidebar}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title="Toggle sidebar"
          >
            <div className="i-lucide:menu text-gray-600" />
          </button>
          
          <div className="flex items-center gap-2">
            <div className="i-lucide:mail text-primary text-xl" />
            <h1 className="text-lg font-semibold text-gray-900">{config.appName}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Search">
            <div className="i-lucide:search text-gray-600" />
          </button>
          
          <button 
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors" 
            title="Compose"
            onClick={() => setShowComposer(true)}
          >
            <div className="i-lucide:edit text-gray-600" />
          </button>
          
          <div className="h-6 w-px bg-gray-200" />
          
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium">
              {username.charAt(0).toUpperCase()}
            </div>
            <button
              onClick={logout}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      
      {showComposer && (
        <MessageComposer onClose={() => setShowComposer(false)} />
      )}
    </>
  )
}
