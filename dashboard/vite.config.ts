/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Explicit IPv4, not the 'localhost' default: on a machine where
    // 'localhost' resolves IPv6-first (common on Windows), Node's dev server
    // binds only [::1], and the Electron shell's hardcoded
    // http://127.0.0.1:5173 (electron-main/index.ts) then gets
    // ERR_CONNECTION_REFUSED against a socket that was never listening on
    // the IPv4 loopback at all -- a blank/dead window with no error visible
    // anywhere but the main process's own stderr. Pinning the bind address
    // keeps it deterministic across machines instead of racing DNS order.
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'electron-main/**/*.test.ts'],
  },
})
