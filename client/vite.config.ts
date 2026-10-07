import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Telegram (/telegram) and AutoStore (/webhook) hit the backend directly, not via Vite
      '/api': 'http://localhost:3000',
    }
  },
  build: {
    outDir: '../dist/public',
    emptyOutDir: true
  }
})
