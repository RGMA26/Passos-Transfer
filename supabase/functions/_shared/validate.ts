// Validações compartilhadas de motorista (sem dependências de Deno).

export const pctOk = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100

/** CPF com máscara 000.000.000-00 ou só dígitos; devolve os 11 dígitos ou null. */
export function normalizeCpf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!/^\d{11}$/.test(s) && !/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(s)) return null
  const d = s.replace(/\D/g, '')
  if (/^(\d)\1{10}$/.test(d)) return null
  const n = d.split('').map(Number)
  const dv = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += n[i] * (len + 1 - i)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === n[9] && dv(10) === n[10] ? d : null
}

export function normalizePhone(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const p = String(v).replace(/\D/g, '')
  return p.length >= 10 && p.length <= 11 ? p : null
}
