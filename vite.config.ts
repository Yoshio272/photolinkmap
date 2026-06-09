import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // /viewer パスをindex.htmlにフォールバック（SPA routing）
  build: {
    rollupOptions: {
      input: { main: './index.html' }
    }
  },
})
