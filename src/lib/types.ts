import type { Database } from './database.types'

type Tables = Database['public']['Tables']

export type Profile = Tables['profiles']['Row']
export type Car = Tables['cars']['Row']
export type Shift = Tables['shifts']['Row']
export type Ride = Tables['rides']['Row']
export type RideExpense = Tables['ride_expenses']['Row']
export type Fueling = Tables['fuelings']['Row']
export type DriverPeriod = Tables['driver_periods']['Row']
export type Statement = Tables['statements']['Row']

/** Formato jsonb retornado por compute_statement. */
export interface StatementLines {
  uber_share: number
  transfer_share: number
  fuel_reimbursement: number
  transfer_fuel_reimbursement: number
  expense_reimbursement: number
  off_duty_fuel_discount: number
  adjustments: number
  total: number
  /** Custo por km da quinzena (null = sem nota/consumo). */
  cost_per_km: number | null
  /** Falta nota de abastecimento aprovada para calcular a gasolina. */
  missing_fuel_price: boolean
  /** Falta o consumo do carro para calcular a gasolina. */
  missing_consumption: boolean
  km: { total: number; service: number; off: number }
  pending: { fuelings: number; expenses: number }
}
