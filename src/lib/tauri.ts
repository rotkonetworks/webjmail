// Thin bridge to the Tauri backend.
//
// `isTauri` is true only when running inside the desktop shell. In a plain web
// build it stays false and none of the invoke() paths are taken, so the same
// bundle still runs in a browser.
import { invoke as tauriInvoke, Channel } from '@tauri-apps/api/core'

export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const invoke = tauriInvoke
// Tauri IPC Channel — streams values from a Rust command back to JS.
export { Channel }
