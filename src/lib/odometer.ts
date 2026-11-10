const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** 10102500 → "10.102.500". */
export const fmtInt = (n: number) => intFmt.format(Number(n))

/** Acima disso (km) em relação à última leitura conhecida, o app pede para conferir. */
export const SUSPECT_KM = 1000

export const MSG_ODO_INTEGER = 'Digite só números, sem ponto ou vírgula'
export const MSG_ODO_INVALID = 'Leitura inválida'
/** Teto do odômetro (o servidor recusa acima disso com INVALID_ODOMETER). */
export const MAX_ODOMETER = 9_999_999

/** Leitura digitada: só inteiro (sem ponto, vírgula ou letra) até 9.999.999, ou null. */
export function parseOdometerText(text: string): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n <= MAX_ODOMETER ? n : null
}

/** Erro da leitura digitada (vazio = sem erro aqui; o formulário pede "Informe…"). */
export function odometerTextError(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (!/^\d+$/.test(t)) return MSG_ODO_INTEGER
  return Number(t) <= MAX_ODOMETER ? null : MSG_ODO_INVALID
}

/** "10.102.500 km" embaixo do campo (null se ainda não é um inteiro). */
export function odometerEcho(text: string): string | null {
  const n = parseOdometerText(text)
  return n === null ? null : `${fmtInt(n)} km`
}

/** Mensagem de confirmação se a leitura passa mais de `limit` km (1.000) da referência; senão null. */
export function checkReading(
  reading: number,
  reference: number | null | undefined,
  limit: number = SUSPECT_KM,
): string | null {
  if (reference == null || reading - reference <= limit) return null
  return `Confira a leitura: ${fmtInt(reading)} km (${fmtInt(reading - reference)} km acima da última). Está certa?`
}

/** Confirma (window.confirm) leitura fora do normal; true = pode enviar. */
export function confirmReading(
  reading: number,
  reference: number | null | undefined,
  limit: number = SUSPECT_KM,
): boolean {
  const msg = checkReading(reading, reference, limit)
  return msg === null || window.confirm(msg)
}

const key = (uid: string) => `passos.lastOdometer.${uid}`

/** Última leitura deste motorista que o servidor aceitou (gravada pela fila offline). */
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
