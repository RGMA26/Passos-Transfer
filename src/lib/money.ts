export function parseBRL(input: string): number | null {
  let s = input.replace(/R\$/gi, '').replace(/\s/g, '')
  if (s === '') return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  // sem vírgula, "1.200" / "12.345.678" é milhar (convenção BR); "1.5" e "12.50" seguem decimais
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : null
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function formatBRL(value: number): string {
  return brl.format(value)
}

/** Número decimal com vírgula ou ponto (ex.: litros "40,5", preço "6.199"), ou null. */
export function parseDecimal(input: string): number | null {
  const t = input.trim().replace(',', '.')
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null
}
