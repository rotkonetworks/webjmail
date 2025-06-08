import React from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const viewMode = useUIStore((state) => state.viewMode)
  const setViewMode = useUIStore((state) => state.setViewMode)
  const theme = useUIStore((state) => state.theme)
  const setTheme = useUIStore((state) => state.setTheme)
  const font = useUIStore((state) => state.font)
  const setFont = useUIStore((state) => state.setFont)
  const session = useAuthStore((state) => state.session)
  
  // In row mode, settings panel takes full width
  const isRowMode = viewMode === 'row'
  
  return (
    <>
      {/* Backdrop - only in column mode */}
      {isOpen && !isRowMode && (
        <div 
          className="fixed inset-0 bg-black/20 z-40"
          onClick={onClose}
        />
      )}
      
      {/* Panel */}
      <div className={`
        ${isRowMode ? 'absolute' : 'fixed'} 
        right-0 top-0 bottom-0 
        ${isRowMode ? 'w-full' : 'w-80'}
        bg-[var(--bg-secondary)] border-l border-[var(--border-color)]
        transform transition-transform duration-300 z-50
        ${isOpen ? 'translate-x-0' : 'translate-x-full'}
      `}>
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
            <h2 className="text-lg font-semibold">Settings</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
            >
              <div className="i-lucide:x" />
            </button>
          </div>
          
          {/* Settings content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* View Mode */}
            <div>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                Layout
              </h3>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="viewMode"
                    value="column"
                    checked={viewMode === 'column'}
                    onChange={() => setViewMode('column')}
                  />
                  <div>
                    <div className="font-medium">Column view</div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      Split screen with list and message
                    </div>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="viewMode"
                    value="row"
                    checked={viewMode === 'row'}
                    onChange={() => setViewMode('row')}
                  />
                  <div>
                    <div className="font-medium">Row view</div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      i3wm style - one thing at a time
                    </div>
                  </div>
                </label>
              </div>
            </div>
            
            {/* Theme */}
            <div>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                Theme
              </h3>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <button
                  onClick={() => setTheme('system')}
                  className={`theme-btn ${theme === 'system' ? 'selected' : ''}`}
                  style={{
                    background: 'linear-gradient(135deg, #272822 50%, #ffffff 50%)'
                  }}
                  title="System"
                />
                <button
                  onClick={() => setTheme('dark')}
                  className={`theme-btn ${theme === 'dark' ? 'selected' : ''}`}
                  style={{
                    background: '#272822'
                  }}
                  title="Monokai Dark"
                />
                <button
                  onClick={() => setTheme('light')}
                  className={`theme-btn ${theme === 'light' ? 'selected' : ''}`}
                  style={{
                    background: '#ffffff',
                    border: '2px solid #dce2e9'
                  }}
                  title="Polkadot Light"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="theme"
                    value="system"
                    checked={theme === 'system'}
                    onChange={() => setTheme('system')}
                  />
                  <div>
                    <div className="font-medium">System</div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      Follow system preference
                    </div>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="theme"
                    value="dark"
                    checked={theme === 'dark'}
                    onChange={() => setTheme('dark')}
                  />
                  <div>
                    <div className="font-medium">Monokai</div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      Dark theme with vibrant colors
                    </div>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="theme"
                    value="light"
                    checked={theme === 'light'}
                    onChange={() => setTheme('light')}
                  />
                  <div>
                    <div className="font-medium">Polkadot</div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      Light theme with brand colors
                    </div>
                  </div>
                </label>
              </div>
            </div>
            
            {/* Font */}
            <div>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                Font
              </h3>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="font"
                    value="system"
                    checked={font === 'system'}
                    onChange={() => setFont('system')}
                  />
                  <div>
                    <div className="font-medium">System</div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      Default system font
                    </div>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="font"
                    value="mono"
                    checked={font === 'mono'}
                    onChange={() => setFont('mono')}
                  />
                  <div>
                    <div className="font-medium" style={{ fontFamily: 'monospace' }}>Monospace</div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      JetBrains Mono / Fira Code
                    </div>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors">
                  <input
                    type="radio"
                    name="font"
                    value="serif"
                    checked={font === 'serif'}
                    onChange={() => setFont('serif')}
                  />
                  <div>
                    <div className="font-medium" style={{ fontFamily: 'serif' }}>Serif</div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      Georgia / Times
                    </div>
                  </div>
                </label>
              </div>
            </div>
            
            {/* Density */}
            <div>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                Density
              </h3>
              <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="font-medium">Compact</div>
                <div className="text-sm text-[var(--text-tertiary)]">
                  Optimized for maximum content
                </div>
              </div>
            </div>
            
            {/* Account info */}
            <div>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                Account
              </h3>
              <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="text-sm text-[var(--text-tertiary)]">Signed in as</div>
                <div className="font-medium">{session?.username}</div>
              </div>
            </div>
            
            {/* Advanced */}
            <div>
              <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
                Advanced
              </h3>
              <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="text-sm text-[var(--text-tertiary)]">
                  <p className="mb-2">Keyboard navigation:</p>
                  <ul className="space-y-1 ml-4">
                    <li>• <kbd>Enter</kbd> - Open selected email</li>
                    <li>• <kbd>Cmd/Ctrl + K</kbd> - Focus search</li>
                    <li>• Use Vimium-C for advanced navigation</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
