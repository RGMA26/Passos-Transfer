import { registerSW } from 'virtual:pwa-register'

// Atualização do app instalado (PWA).
// Ao abrir: se há versão nova, aplica na hora (ninguém está preenchendo nada ainda).
// Com o app já em uso: só avisa (banner) — recarregar sozinho apagaria um formulário
// ou uma foto escolhida pela metade.

type Listener = (ready: boolean) => void

const OPEN_WINDOW_MS = 15_000
const CHECK_EVERY_MS = 30 * 60_000

const listeners = new Set<Listener>()
let ready = false
let apply: ((reload?: boolean) => Promise<void>) | null = null
const loadedAt = Date.now()

export function startSwUpdates(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (Date.now() - loadedAt < OPEN_WINDOW_MS) {
        void apply?.(true)
        return
      }
      ready = true
      listeners.forEach((l) => l(true))
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      setInterval(() => {
        void registration.update()
      }, CHECK_EVERY_MS)
    },
  })
}

export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener)
  listener(ready)
  return () => {
    listeners.delete(listener)
  }
}

export function applyUpdate(): void {
  void apply?.(true)
}
