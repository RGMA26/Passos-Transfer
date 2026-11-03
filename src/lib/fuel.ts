import { formatBRL } from './money'
import type { Fuel } from './api'

export const FUEL_LABEL: Record<Fuel, string> = {
  gasolina: 'Gasolina',
  alcool: 'Álcool',
  diesel: 'Diesel',
  gnv: 'GNV',
  eletrico: 'Elétrico',
}

/** Ordem fixa dos combustíveis (a mesma do banco). */
export const ALL_FUELS: Fuel[] = ['gasolina', 'alcool', 'diesel', 'gnv', 'eletrico']
const ALL = ALL_FUELS

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

/** Ordem fixa, sem repetidos, só combustíveis conhecidos. */
export function normalizeFuels(fuels: readonly string[]): Fuel[] {
  return ALL_FUELS.filter((f) => fuels.includes(f))
}

/**
 * Combustíveis do carro (cars.fuels). Carro lido antes da 0017 (sem fuels) usa o tipo antigo;
 * carro desconhecido → todos.
 */
export function carFuels(car: { fuels?: readonly string[] | null; fuel_type?: string | null } | null | undefined): Fuel[] {
  const own = Array.isArray(car?.fuels) ? normalizeFuels(car.fuels) : []
  return own.length > 0 ? own : fuelOptions(car?.fuel_type)
}

/** Rótulo curto: "Flex", "Flex + GNV", "Híbrido", "Diesel + GNV"… */
export function fuelsLabel(fuels: readonly string[]): string {
  const f = normalizeFuels(fuels)
  if (f.length === 2 && f[0] === 'gasolina' && f[1] === 'eletrico') return 'Híbrido'
  const parts: string[] = []
  const flex = f.includes('gasolina') && f.includes('alcool')
  if (flex) parts.push('Flex')
  for (const x of f) if (!(flex && (x === 'gasolina' || x === 'alcool'))) parts.push(FUEL_LABEL[x])
  return parts.join(' + ')
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
