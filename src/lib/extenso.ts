const UNITS = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze',
  'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove',
]
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const HUNDREDS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos',
  'novecentos',
]

/** 1..999 por extenso. */
function below1000(n: number): string {
  if (n === 100) return 'cem'
  const out: string[] = []
  const h = Math.floor(n / 100)
  const r = n % 100
  if (h) out.push(HUNDREDS[h])
  if (r) {
    if (r < 20) out.push(UNITS[r])
    else {
      const t = TENS[Math.floor(r / 10)]
      out.push(r % 10 ? `${t} e ${UNITS[r % 10]}` : t)
    }
  }
  return out.join(' e ')
}

/** Inteiro 0..999.999.999 por extenso. */
function integer(n: number): string {
  if (n === 0) return 'zero'
  const millions = Math.floor(n / 1_000_000)
  const thousands = Math.floor((n % 1_000_000) / 1000)
  const rest = n % 1000
  const parts: { text: string; n: number }[] = []
  if (millions) {
    parts.push({ text: millions === 1 ? 'um milhão' : `${below1000(millions)} milhões`, n: millions })
  }
  if (thousands) {
    parts.push({ text: thousands === 1 ? 'mil' : `${below1000(thousands)} mil`, n: thousands })
  }
  if (rest) parts.push({ text: below1000(rest), n: rest })
  // "e" antes de um grupo só quando ele é menor que 100 ou centena redonda
  return parts.reduce((acc, p, i) => {
    if (i === 0) return p.text
    return `${acc}${p.n < 100 || p.n % 100 === 0 ? ' e ' : ' '}${p.text}`
  }, '')
}

/** Valor em reais por extenso (ex.: 213 -> "duzentos e treze reais"). */
export function valorPorExtenso(value: number): string {
  const cents = Math.round(Math.abs(value) * 100)
  const reais = Math.floor(cents / 100)
  const c = cents % 100
  const parts: string[] = []
  if (reais > 0 || c === 0) {
    const unit = reais === 1 ? 'real' : reais !== 0 && reais % 1_000_000 === 0 ? 'de reais' : 'reais'
    parts.push(reais === 0 ? 'zero reais' : `${integer(reais)} ${unit}`)
  }
  if (c > 0) parts.push(`${integer(c)} ${c === 1 ? 'centavo' : 'centavos'}`)
  return parts.join(' e ')
}
