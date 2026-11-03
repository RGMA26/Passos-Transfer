import { formatBRL } from './money'
import type { Fuel } from './api'

export const FUEL_LABEL: Record<Fuel, string> = {
  gasolina: 'Gasolina',
  alcool: 'Álcool',
  diesel: 'Diesel',
  gnv: 'GNV',
  eletrico: 'Elétrico',
}

const ALL: Fuel[] = ['gasolina', 'alcool', 'diesel', 'gnv', 'eletrico']

/** Combustíveis aceitos pelo tipo do carro (spec §9.1); tipo desconhecido → todos. */
export function fuelOptions(fuelType: string | null | undefined): Fuel[] {
  switch (fuelType) {
    case 'flex':
      return ['gasolina', 'alcool']
    case 'hibrido':
      return ['gasolina', 'eletrico']
    case 'gasolina':
    case 'alcool':
    case 'diesel':
    case 'gnv':
    case 'eletrico':
      return [fuelType]
    default:
      return ALL
  }
}

/** Unidade da quantidade: L, m³ (GNV) ou kWh (elétrico). */
export function fuelUnit(fuel: Fuel): string {
  if (fuel === 'gnv') return 'm³'
  if (fuel === 'eletrico') return 'kWh'
  return 'L'
}

/** Quantidade e preço por unidade são gravados com 3 casas (numeric(8,3)/(7,3)). */
export const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Conflito (com os valores já em 3 casas, como o banco): |quantidade × preço − total| > max(R$ 0,10; 0,5% do total). */
export function valuesConflict(quantity: number, unitPrice: number, total: number): boolean {
  return Math.abs(round3(quantity) * round3(unitPrice) - total) > Math.max(0.1, 0.005 * total) + 1e-9
}

const qtyFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const priceFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
})

export const formatQty = (n: number) => qtyFmt.format(n)
export const formatUnitPrice = (n: number) => priceFmt.format(n)

/** Ex.: "40 L × R$ 6,19 = R$ 247,60 ≠ R$ 274,60". */
export function conflictText(quantity: number, unitPrice: number, total: number, fuel: Fuel): string {
  const product = Math.round(quantity * unitPrice * 100) / 100
  return `${formatQty(quantity)} ${fuelUnit(fuel)} × ${formatUnitPrice(unitPrice)} = ${formatBRL(product)} ≠ ${formatBRL(total)}`
}
