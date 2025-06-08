import { defineConfig, presetUno, presetIcons, presetTypography } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      collections: {
        lucide: () => import('@iconify-json/lucide/icons.json').then(i => i.default),
        'eos-icons': () => import('@iconify-json/eos-icons/icons.json').then(i => i.default),
      },
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
    }),
    presetTypography(),
  ],
  theme: {
    colors: {
      primary: {
        DEFAULT: '#3a429c',
        dark: '#2a3270',
        light: '#4a52ac',
      },
    },
  },
  shortcuts: {
    'btn': 'px-4 py-2 rounded-md bg-primary text-white hover:bg-primary-dark transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
    'input': 'px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary',
    'card': 'bg-white rounded-lg shadow-md p-4',
  },
})
