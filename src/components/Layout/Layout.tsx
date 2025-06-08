import React from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useUIStore } from '../../stores/uiStore'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <div
          className={`
            transition-all duration-300 bg-white border-r border-gray-200
            ${sidebarOpen ? 'w-64' : 'w-0'}
          `}
        >
          <Sidebar />
        </div>
        <main className="flex-1 flex overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
