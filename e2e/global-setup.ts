import { execSync } from 'node:child_process'
import { envWithDocker } from '../playwright.config'

/** Recria o banco local com o seed (admin, PASSOS01JOAO, PASSOS02MARIA). */
export default function globalSetup() {
  execSync('npx supabase db reset', { stdio: 'inherit', env: envWithDocker() })
}
