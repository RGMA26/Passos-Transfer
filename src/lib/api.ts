import { supabase } from './supabase'
import type { Profile } from './types'
import type { Database } from './database.types'

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function clearMustChangePassword(): Promise<void> {
  const { error } = await supabase.rpc('clear_must_change_password')
  if (error) throw error
}

/** Erro do servidor: `message` do PostgREST é o código (ex.: PERIOD_CLOSED). */
function fail(error: { message: string; code?: string }, status?: number): never {
  const code = error.code || undefined
  const clientError = status !== undefined && status >= 400 && status < 500
  const transient =
    status === 0 || // falha de rede (ex.: "TypeError: Load failed" no iOS)
    status === 401 || // JWT expirado: o auth renova e a fila tenta depois
    (status !== undefined && status >= 500) ||
    code === 'PGRST301' ||
    code === 'PGRST303' ||
    (!code && !clientError) // sem código do servidor e sem 4xx: rede/gateway
  // transitório vira TypeError, que a fila trata como "tentar depois"
  if (transient) throw new TypeError(error.message)
  throw Object.assign(new Error(error.message), { code, status })
}

type Tables = Database['public']['Tables']

export async function insertRide(row: Tables['rides']['Insert']): Promise<void> {
  const { error, status } = await supabase
    .from('rides')
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
  if (error) fail(error, status)
}

export async function insertFueling(row: Tables['fuelings']['Insert']): Promise<void> {
  const { error, status } = await supabase
    .from('fuelings')
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
  if (error) fail(error, status)
}

export async function insertExpense(row: Tables['ride_expenses']['Insert']): Promise<void> {
  const { error, status } = await supabase
    .from('ride_expenses')
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true })
  if (error) fail(error, status)
}

export async function startShift(a: {
  id: string
  car_id: string
  odometer: number
  photo: string
}): Promise<void> {
  const { error, status } = await supabase.rpc('start_shift', {
    p_id: a.id,
    p_car_id: a.car_id,
    p_odometer: a.odometer,
    p_photo: a.photo,
  })
  if (error) fail(error, status)
}

export interface EndShiftResult {
  km_total: number
  km_service: number
  km_off: number
  off_discount_estimate: number
}

export async function endShift(a: {
  shift_id: string
  odometer: number
  photo: string
  uber_photo: string
}): Promise<EndShiftResult> {
  const { data, error, status } = await supabase.rpc('end_shift', {
    p_shift_id: a.shift_id,
    p_odometer: a.odometer,
    p_photo: a.photo,
    p_uber_photo: a.uber_photo,
  })
  if (error) fail(error, status)
  return data as unknown as EndShiftResult
}

export async function completeTransfer(a: { ride_id: string; km: number }): Promise<void> {
  const { error, status } = await supabase.rpc('complete_transfer', {
    p_ride_id: a.ride_id,
    p_km: a.km,
  })
  if (error) fail(error, status)
}
