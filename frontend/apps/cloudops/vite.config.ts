import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const appRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: appRoot,
  envDir: resolve(appRoot, '../..'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(appRoot, 'src') },
  },
  build: {
    outDir: resolve(appRoot, '../../dist/cloudops'),
    emptyOutDir: true,
  },
})
