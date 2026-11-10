const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** 10102500 → "10.102.500". */
export const fmtInt = (n: number) => intFmt.format(Number(n))

/** Acima disso (km) em relação à última leitura conhecida, o app pede para conferir. */
export const SUSPECT_KM = 1000

export const MSG_ODO_INTEGER = 'Digite só números, sem ponto ou vírgula'

/** Leitura digitada: só inteiro (sem ponto, vírgula ou letra), ou null. */
export function parseOdometerText(text: string): number | null {
  const t = text.trim()
  return /^\d+$/.test(t) ? Number(t) : null
}

/** "10.102.500 km" embaixo do campo (null se ainda não é um inteiro). */
export function odometerEcho(text: string): string | null {
  const n = parseOdometerText(text)
  return n === null ? null : `${fmtInt(n)} km`
}

/** Mensagem de confirmação se a leitura passa mais de 1.000 km da referência; senão null. */
export function checkReading(reading: number, reference: number | null | undefined): string | null {
  if (reference == null || reading - reference <= SUSPECT_KM) return null
  return `Confira a leitura: ${fmtInt(reading)} km (${fmtInt(reading - reference)} km acima da última). Está certa?`
}

/** Confirma (window.confirm) leitura fora do normal; true = pode enviar. */
export function confirmReading(reading: number, reference: number | null | undefined): boolean {
  const msg = checkReading(reading, reference)
  return msg === null || window.confirm(msg)
}

const key = (uid: string) => `passos.lastOdometer.${uid}`

/** Última leitura que este aparelho enviou para o motorista (referência offline). */
export function lastReading(uid: string): number | null {
  try {
    const raw = localStorage.getItem(key(uid))
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function rememberReading(uid: string, reading: number) {
  try {
    // a última, não a maior: uma leitura errada confirmada não envenena as próximas
    localStorage.setItem(key(uid), String(reading))
  } catch {
    /* armazenamento indisponível */
  }
}

/** Maior entre as referências conhecidas (ignora nulas). */
export function maxReading(...xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? Math.max(...v) : null
}
