const intFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

/** 10102500 → "10.102.500". */
export const fmtInt = (n: number) => intFmt.format(Number(n))
