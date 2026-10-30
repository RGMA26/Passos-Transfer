const needsQuotes = /[;"\r\n]/

function cell(v: string | number): string {
  if (typeof v === 'number') return v.toFixed(2).replace('.', ',')
  return needsQuotes.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** CSV para Excel pt-BR: separador `;`, BOM UTF-8, números com vírgula decimal. */
export function toCSV(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return '\uFEFF'
  const keys = Object.keys(rows[0])
  const lines = [keys.map(cell).join(';'), ...rows.map((r) => keys.map((k) => cell(r[k] ?? '')).join(';'))]
  return '\uFEFF' + lines.join('\r\n')
}
