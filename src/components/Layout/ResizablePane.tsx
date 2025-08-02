// src/components/Layout/ResizablePane.tsx
import { useState, useCallback, useRef, useEffect } from 'react'

interface ResizablePaneProps {
  children: React.ReactNode
  width: number
  minWidth: number
  maxWidth: number
  onResize: (width: number) => void
  direction?: 'left' | 'right'
  className?: string
}

export function ResizablePane({
  children,
  width,
  minWidth,
  maxWidth,
  onResize,
  direction = 'right',
  className = '',
}: ResizablePaneProps) {
  const [isResizing, setIsResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = width
  }, [width])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return

      const deltaX = direction === 'right' 
        ? e.clientX - startXRef.current
        : startXRef.current - e.clientX
      
      const newWidth = Math.min(
        maxWidth,
        Math.max(minWidth, startWidthRef.current + deltaX)
      )
      
      onResize(newWidth)
    },
    [isResizing, direction, minWidth, maxWidth, onResize]
  )

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  return (
    <div className={`relative flex ${className}`} style={{ width }}>
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
      
      {/* Resize handle */}
      <div
        className={`
          absolute top-0 bottom-0 w-1 cursor-col-resize z-10
          hover:bg-[var(--primary-color)] transition-colors
          ${direction === 'right' ? 'right-0' : 'left-0'}
          ${isResizing ? 'bg-[var(--primary-color)]' : 'bg-transparent'}
        `}
        onMouseDown={handleMouseDown}
      >
        {/* Visual indicator */}
        <div className={`
          absolute top-1/2 transform -translate-y-1/2
          ${direction === 'right' ? 'right-0' : 'left-0'}
          w-1 h-8 bg-[var(--border-color)] rounded-full
          opacity-0 hover:opacity-100 transition-opacity
        `} />
      </div>
    </div>
  )
}