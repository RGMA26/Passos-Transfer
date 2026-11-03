// Substitui o módulo virtual do vite-plugin-pwa nos testes (não existe fora do build).
export function registerSW(): (reload?: boolean) => Promise<void> {
  return async () => {}
}
