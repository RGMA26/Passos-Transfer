import { execSync } from 'node:child_process'
import { envWithDocker } from '../playwright.config'

/**
 * Recria o banco local com o seed (admin, PASSOS01JOAO, PASSOS02MARIA).
 * Usado antes (teste repetível) e depois do E2E (os testes pgTAP de
 * `npx supabase test db` partem do seed limpo). `--local` garante que nunca mira um projeto linkado.
 */
export default function resetDb() {
  execSync('npx supabase db reset --local', { stdio: 'inherit', env: envWithDocker() })
}
