/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon-180.png', 'icons/icon.svg'],
      manifest: {
        name: 'Passos Transfer',
        short_name: 'Passos',
        description: 'Corridas, turnos e extrato de repasse dos motoristas da Passos Transfer',
        lang: 'pt-BR',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#1e3a8a',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
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
