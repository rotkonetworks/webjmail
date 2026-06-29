import { useState, useEffect } from 'react'

// Tracks connectivity via the browser/webview online/offline events. Works in
// both the web build and the Tauri webview. Pairs with the offline-first local
// index: when offline, cached mail + local search still work.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
