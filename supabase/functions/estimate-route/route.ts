// Funções puras (sem imports de Deno) para o estimate-route; testadas pelo Vitest.

export type Addr = { street?: string; district?: string; city?: string; state?: string; zip?: string }

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

// ---------- Geocodificação em tentativas ----------
// O Nominatim falha com abreviações ("Av.") e com bairro/CEP no texto livre. Tentamos, em ordem:
// (1) rua expandida com número + cidade + UF; (2) idem + bairro; (3) CEP (busca estruturada);
// (4) bairro + cidade + UF (aproximado). Máx. 4 chamadas por endereço, 1,1 s entre elas (política
// do Nominatim: 1 req/s).

const ABBREVIATIONS: [RegExp, string][] = [
  [/^Av\.?\s+/i, 'Avenida '],
  [/^R\.?\s+/i, 'Rua '],
  [/^Rod\.?\s+/i, 'Rodovia '],
  [/^Trav\.?\s+/i, 'Travessa '],
  [/^Al\.?\s+/i, 'Alameda '],
  [/^(Pça|Pca|Pç)\.?\s+/i, 'Praça '],
  [/^Est\.?\s+/i, 'Estrada '],
]

/** Expande o tipo de logradouro abreviado no início e "Dr." em qualquer posição. */
export function expandStreet(street: string): string {
  let s = street.trim().replace(/\s+/g, ' ')
  for (const [re, full] of ABBREVIATIONS) {
    if (re.test(s)) {
      s = s.replace(re, full)
      break
    }
  }
  return s.replace(/(^|\s)Dr\.?\s+/g, '$1Doutor ')
}

export type GeoQuery = { q: string } | { postalcode: string; country: string }

const clean = (v?: string) => (typeof v === 'string' ? v.trim() : '')

/** Até 4 buscas para o endereço, da mais precisa para a aproximada (sem repetidas). */
export function candidateQueries(addr: Addr): GeoQuery[] {
  const street = clean(addr.street) ? expandStreet(clean(addr.street)).replace(/,\s*(\d)/, ' $1') : ''
  const district = clean(addr.district)
  const city = clean(addr.city)
  const state = clean(addr.state)
  const digits = clean(addr.zip).replace(/\D/g, '')
  const join = (...p: string[]) => p.filter((x) => x !== '').join(', ')
  const out: GeoQuery[] = []
  const add = (g: GeoQuery) => {
    if ('q' in g && (g.q === '' || out.some((o) => 'q' in o && o.q === g.q))) return
    out.push(g)
  }
  if (street) add({ q: join(street, city, state) })
  if (street && district) add({ q: join(street, district, city, state) })
  if (digits.length === 8) add({ postalcode: `${digits.slice(0, 5)}-${digits.slice(5)}`, country: 'Brasil' })
  if (district) add({ q: join(district, city, state) })
  return out.slice(0, 4)
}

export const NOMINATIM_SPACING_MS = 1100

/**
 * Primeira busca com resultado. Nunca lança: erro numa tentativa passa para a próxima.
 * Para antes de estourar o prazo (deadline, no relógio de `now`).
 */
export async function geocodeFirst(
  candidates: GeoQuery[],
  fetchJson: (params: Record<string, string>) => Promise<unknown>,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  deadline: number = now() + 20_000,
): Promise<{ lat: number; lon: number } | null> {
  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) {
      if (now() + NOMINATIM_SPACING_MS > deadline) return null
      await sleep(NOMINATIM_SPACING_MS)
    }
    try {
      const hit = parseGeocode(await fetchJson(candidates[i] as Record<string, string>))
      if (hit) return hit
    } catch {
      // tenta a próxima
    }
  }
  return null
}
