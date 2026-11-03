/** Número decimal com vírgula ou ponto; null se inválido. */
export function parseDecimal(input: string): number | null {
  const s = input.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Porcentagem válida: 0 < x <= 100. */
export function parsePct(input: string): number | null {
  const n = parseDecimal(input)
  return n !== null && n > 0 && n <= 100 ? n : null
}

export const onlyDigits = (s: string) => s.replace(/\D/g, '')

/** Confirmação de "Desfazer conferência" (Transfers e Conferência). */
export const MSG_CONFIRM_UNDO = 'Desfazer a conferência deste item? Ele volta para a fila de conferência.'
