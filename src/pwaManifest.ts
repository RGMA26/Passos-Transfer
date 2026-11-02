import type { ManifestOptions } from 'vite-plugin-pwa'

/** Manifest do PWA (usado pelo vite.config.ts). */
export const manifest: Partial<ManifestOptions> = {
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
  // "Compartilhar" do Android: o service worker (public/sw-share.js) recebe o POST,
  // guarda o arquivo e abre /m/compartilhar
  share_target: {
    action: '/share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
    params: { files: [{ name: 'file', accept: ['image/*', 'application/pdf'] }] },
  },
}
