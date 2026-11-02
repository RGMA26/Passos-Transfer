/** Dígito verificador do CPF para os n primeiros dígitos. */
function checkDigit(d: number[], n: number): number {
  let s = 0
  for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i)
  const r = (s * 10) % 11
  return r === 10 ? 0 : r
}

/** Aceita só 11 dígitos ou a máscara 000.000.000-00; confere os dígitos verificadores. */
export function isValidCpf(s: string): boolean {
  if (typeof s !== 'string') return false
  if (!/^\d{11}$/.test(s) && !/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(s)) return false
  const digits = s.replace(/\D/g, '')
  if (/^(\d)\1{10}$/.test(digits)) return false
  const d = digits.split('').map(Number)
  return checkDigit(d, 9) === d[9] && checkDigit(d, 10) === d[10]
}

/** 11 dígitos -> 000.000.000-00 (outra entrada volta só com os dígitos). */
export function formatCpf(digits: string): string {
  const d = String(digits ?? '').replace(/\D/g, '')
  if (d.length !== 11) return d
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}
