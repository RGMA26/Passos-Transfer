const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function localDate(d: Date = new Date()): string {
  return dateFmt.format(d)
}

export function periodBounds(date: string): { start: string; end: string } {
  const [y, m, d] = date.split('-').map(Number)
  const ym = date.slice(0, 7)
  if (d <= 15) return { start: `${ym}-01`, end: `${ym}-15` }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { start: `${ym}-16`, end: `${ym}-${String(last).padStart(2, '0')}` }
}
