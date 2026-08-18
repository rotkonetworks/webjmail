/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV: string
  readonly VITE_JMAP_URL: string
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}