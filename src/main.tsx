import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { installDevConsole } from './lib/devConsole'
import 'uno.css'
import './index.css'

// Capture console output + uncaught errors into the in-app console before
// anything else runs (packaged builds have no browser devtools).
installDevConsole()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
