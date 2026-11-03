import { corsHeaders, json, readBody, requireAdmin } from '../_shared/admin.ts'
import { type Addr, candidateQueries, geocodeAddress, PHOTON_SPACING_MS, parseRoute } from './route.ts'

const UA = 'PassosTransfer/1.0'
const TIMEOUT_MS = 6000
/** Tudo (geocodificação + rota) termina antes disto; o cliente não espera mais que ~25 s. */
const BUDGET_MS = 22_000
const ROUTE_RESERVE_MS = 4000

async function getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), Math.max(500, timeoutMs))
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

const asAddr = (v: unknown): Addr | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Addr) : null

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  try {
    const started = Date.now()
    const deadline = started + BUDGET_MS - ROUTE_RESERVE_MS
    const body = (await readBody(req)) ?? {}
    const origin = asAddr(body.origin)
    const destination = asAddr(body.destination)
    const co = origin ? candidateQueries(origin) : []
    const cd = destination ? candidateQueries(destination) : []
    if (co.length === 0 || cd.length === 0) return json({ km: null, reason: 'NOT_FOUND' })

    // Photon primeiro (o Nominatim dá 403 no Supabase Edge); Nominatim só como última tentativa
    const timeout = () => Math.min(TIMEOUT_MS, deadline - Date.now())
    const fetchers = {
      photon: (text: string) =>
        getJson(`https://photon.komoot.io/api/?${new URLSearchParams({ q: text, limit: '5' })}`, timeout()),
      nominatim: (params: Record<string, string>) =>
        getJson(
          `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
            format: 'json',
            countrycodes: 'br',
            limit: '1',
            ...params,
          })}`,
          timeout(),
        ),
    }
    const a = await geocodeAddress(co, fetchers, sleep, Date.now, deadline)
    if (!a) return json({ km: null, reason: 'NOT_FOUND', matched: { origin: null, destination: null } })
    const matchedOrigin = { source: a.source, query: a.query }
    if (Date.now() + PHOTON_SPACING_MS > deadline) {
      return json({ km: null, reason: 'NOT_FOUND', matched: { origin: matchedOrigin, destination: null } })
    }
    await sleep(PHOTON_SPACING_MS)
    const b = await geocodeAddress(cd, fetchers, sleep, Date.now, deadline)
    if (!b) return json({ km: null, reason: 'NOT_FOUND', matched: { origin: matchedOrigin, destination: null } })
    const matched = { origin: matchedOrigin, destination: { source: b.source, query: b.query } }

    try {
      const route = await getJson(
        `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`,
        Math.min(TIMEOUT_MS, started + BUDGET_MS - Date.now()),
      )
      const km = parseRoute(route)
      return km === null ? json({ km: null, reason: 'ROUTE_FAILED', matched }) : json({ km, matched })
    } catch {
      return json({ km: null, reason: 'ROUTE_FAILED', matched })
    }
  } catch {
    return json({ km: null, reason: 'ROUTE_FAILED' })
  }
})
