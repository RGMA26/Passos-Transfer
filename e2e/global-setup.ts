import { execSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import { envWithDocker, localApiUrl } from '../playwright.config'

/**
 * Antes do E2E:
 * 1. recria o banco local com o seed (admin, PASSOS01JOAO, PASSOS02MARIA) — teste repetível;
 * 2. garante as Edge Functions locais (create-driver, update-driver, estimate-route…): se o
 *    `supabase start` não as serve, sobe `npx supabase functions serve` em segundo plano e o
 *    encerra no fim (a função devolvida aqui é o teardown dela).
 * `--local` garante que nunca mira um projeto linkado.
 */
export function resetDb() {
  execSync('npx supabase db reset --local', { stdio: 'inherit', env: envWithDocker() })
}

/** As funções respondem (qualquer status do próprio runtime; 502/503/504 = gateway sem runtime). */
async function functionsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${localApiUrl()}/functions/v1/estimate-route`, {
      method: 'POST',
      signal: AbortSignal.timeout(3_000),
    })
    return r.status < 500
  } catch {
    return false
  }
}

/** Contêiner do runtime que o `functions serve` cria (some sozinho num Ctrl+C, não num kill). */
function edgeContainer(): string {
  const id = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync('supabase/config.toml', 'utf8'))?.[1]
  return `supabase_edge_runtime_${id ?? ''}`
}

function stop(child: ChildProcess) {
  try {
    killTree(child)
  } finally {
    try {
      execSync(`docker rm -f ${edgeContainer()}`, { stdio: 'ignore', env: envWithDocker() })
    } catch {
      /* já removido */
    }
  }
}

function killTree(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') {
    // npx → supabase → docker: derruba a árvore inteira
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      /* já terminou */
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGINT')
    } catch {
      /* já terminou */
    }
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  resetDb()
  if (await functionsUp()) return async () => {}

  const child = spawn('npx supabase functions serve', {
    env: envWithDocker(),
    shell: true,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  const deadline = Date.now() + 180_000
  while (!(await functionsUp())) {
    if (child.exitCode !== null) throw new Error('`npx supabase functions serve` terminou antes de subir')
    if (Date.now() > deadline) {
      stop(child)
      throw new Error('As Edge Functions locais não responderam em 3 min')
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return async () => stop(child)
}
