import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Backend dev profile (Properties/launchSettings.json) listens on 5244.
        target: 'http://localhost:5244',
        changeOrigin: true,
      },
      // MCP endpoint lives on the backend; proxy it so the dev-server origin works for agents too.
      '/mcp': {
        target: 'http://localhost:5244',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})

