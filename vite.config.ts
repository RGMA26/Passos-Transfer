/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { manifest } from './src/pwaManifest'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon-180.png', 'icons/icon.svg'],
      manifest,
      workbox: {
        // trata o POST /share-target do "Compartilhar" (antes das rotas do Workbox)
        importScripts: ['sw-share.js'],
        // só o app shell (arquivos do próprio site) vai para o cache
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: '/index.html',
        // nunca responder com o index.html para chamadas de API do Supabase
        navigateFallbackDenylist: [/^\/(rest|auth|storage|functions|realtime)\//],
        // sem runtimeCaching: dados e fotos do Supabase (outra origem) nunca são cacheados
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
