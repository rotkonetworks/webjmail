import React, { useRef, useEffect } from 'react'

interface Props {
  onClose: () => void
}

export function CommandBar({ onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [command, setCommand] = React.useState('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Handle commands
    switch (command) {
      case 'q':
      case 'quit':
        window.close()
        break
      case 'compose':
      case 'c':
        // Open compose
        break
      // Add more commands
    }

    onClose()
  }

  return (
    <div className="border-t border-bright-black px-4 py-1">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <span className="text-primary">:</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
          className="flex-1 bg-transparent outline-none"
          placeholder="Enter command..."
        />
      </form>
    </div>
  )
}
