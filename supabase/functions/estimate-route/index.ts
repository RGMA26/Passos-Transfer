import { corsHeaders, json, readBody, requireAdmin } from '../_shared/admin.ts'
import { type Addr, buildQuery, parseGeocode, parseRoute } from './route.ts'

const UA = 'PassosTransfer/1.0'
const TIMEOUT_MS = 8000

async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  try {
    const body = (await readBody(req)) ?? {}
    const origin = asAddr(body.origin)
    const destination = asAddr(body.destination)
    const qo = origin ? buildQuery(origin) : ''
    const qd = destination ? buildQuery(destination) : ''
    if (!qo || !qd) return json({ km: null, reason: 'NOT_FOUND' })

    // Nominatim: uma requisição por vez (sequencial)
    const geocode = async (q: string) =>
      parseGeocode(await getJson(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=${encodeURIComponent(q)}`,
      ))
    let a, b
    try {
      a = await geocode(qo)
      b = await geocode(qd)
    } catch {
      return json({ km: null, reason: 'NOT_FOUND' })
    }
    if (!a || !b) return json({ km: null, reason: 'NOT_FOUND' })

    try {
      const route = await getJson(
        `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`,
      )
      const km = parseRoute(route)
      return km === null ? json({ km: null, reason: 'ROUTE_FAILED' }) : json({ km })
    } catch {
      return json({ km: null, reason: 'ROUTE_FAILED' })
    }
  } catch {
    return json({ km: null, reason: 'ROUTE_FAILED' })
  }
})
