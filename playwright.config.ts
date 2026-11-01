import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// E2E contra o Supabase local (npx supabase start) + `npm run dev`.
// O globalSetup roda `npx supabase db reset` para o teste ser repetível.

/** PATH com o Docker Desktop (a CLI do Supabase precisa do `docker`). */
export function envWithDocker(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const dockerBin = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DockerDesktop', 'resources', 'bin')
  if (existsSync(dockerBin)) env.PATH = `${dockerBin}${path.delimiter}${env.PATH ?? ''}`
  return env
}

/** URL e chave anon do Supabase LOCAL, lidas de `supabase status` (nada de chave no repositório). */
function localSupabase(): { url: string; anon: string } {
  const out = execSync('npx supabase status -o env', { env: envWithDocker(), encoding: 'utf8' })
  const get = (k: string) => new RegExp(`^${k}="?([^"\r\n]*)"?`, 'm').exec(out)?.[1] ?? ''
  return { url: get('API_URL'), anon: get('ANON_KEY') }
}

const sb = localSupabase()

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
    // variáveis do processo têm prioridade sobre o .env.local no Vite
    env: { VITE_SUPABASE_URL: sb.url, VITE_SUPABASE_ANON_KEY: sb.anon },
  },
})
