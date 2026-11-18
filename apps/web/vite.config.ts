import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const apiPort = process.env.STUDIO_API_PORT ?? '8787'
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
    },
  },
})
