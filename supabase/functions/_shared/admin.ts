import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

/** PIN numérico de 6 dígitos (pode começar com 0), via CSPRNG sem viés de módulo. */
export function randomPin(): string {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000
  let n: number
  do {
    crypto.getRandomValues(buf)
    n = buf[0]
  } while (n >= limit)
  return String(n % 1_000_000).padStart(6, '0')
}

export type AdminCheck = { ok: true; admin: SupabaseClient } | { ok: false; response: Response }

/** Exige chamador autenticado, com profile admin ativo. */
export async function requireAdmin(req: Request): Promise<AdminCheck> {
  const header = req.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) return { ok: false, response: json({ error: 'UNAUTHORIZED' }, 401) }

  const admin = serviceClient()
  const { data, error } = await admin.auth.getUser(match[1])
  if (error || !data.user) return { ok: false, response: json({ error: 'UNAUTHORIZED' }, 401) }

  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('role, active')
    .eq('id', data.user.id)
    .maybeSingle()
  if (pErr || !profile || profile.role !== 'admin' || profile.active !== true) {
    return { ok: false, response: json({ error: 'FORBIDDEN' }, 403) }
  }
  return { ok: true, admin }
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}
