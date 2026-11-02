// Funções puras (sem imports de Deno) para o estimate-route; testadas pelo Vitest.

export type Addr = { street?: string; district?: string; city?: string; state?: string; zip?: string }

/** "rua, bairro, cidade, UF, CEP" sem partes vazias. */
export function buildQuery(addr: Addr): string {
  return [addr.street, addr.district, addr.city, addr.state, addr.zip]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p !== '')
    .join(', ')
}

/** Primeira rota do OSRM -> km com 1 casa; null se a resposta não for utilizável. */
export function parseRoute(json: unknown): number | null {
  const j = json as { code?: string; routes?: { distance?: unknown }[] } | null
  if (!j || j.code !== 'Ok' || !Array.isArray(j.routes) || j.routes.length === 0) return null
  const dist = j.routes[0]?.distance
  if (typeof dist !== 'number' || !Number.isFinite(dist) || dist < 0) return null
  return Math.round(dist / 100) / 10
}

/** Primeiro resultado do Nominatim -> {lat, lon}; null se vazio/inválido. */
export function parseGeocode(json: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(json) || json.length === 0) return null
  const lat = Number((json[0] as { lat?: unknown })?.lat)
  const lon = Number((json[0] as { lon?: unknown })?.lon)
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
}
