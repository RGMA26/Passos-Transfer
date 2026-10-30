import { supabase } from './supabase'
import type { Car, Profile, Ride, Period, RideExpense, Shift, Statement, StatementLines } from './types'
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
  uber_photo?: string | null
}): Promise<EndShiftResult> {
  const { data, error, status } = await supabase.rpc('end_shift', {
    p_shift_id: a.shift_id,
    p_odometer: a.odometer,
    p_photo: a.photo,
    // o parâmetro precisa estar sempre no corpo (PostgREST não resolve sem ele); null = sem print
    p_uber_photo: (a.uber_photo ?? null) as string,
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

export async function getOpenShift(driverId: string): Promise<Shift | null> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('driver_id', driverId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getShiftRides(shiftId: string): Promise<Ride[]> {
  const { data, error } = await supabase.from('rides').select('*').eq('shift_id', shiftId)
  if (error) throw error
  return data ?? []
}

export interface TodaySummary {
  byPlatform: { uber: number; blablacar: number; transfer: number }
  kmService: number
  fueled: number
}

export async function getTodaySummary(driverId: string, date: string): Promise<TodaySummary> {
  const [rides, fuelings] = await Promise.all([
    supabase.from('rides').select('platform, amount, km').eq('driver_id', driverId).eq('ride_date', date),
    supabase.from('fuelings').select('amount').eq('driver_id', driverId).eq('fueled_on', date),
  ])
  if (rides.error) throw rides.error
  if (fuelings.error) throw fuelings.error
  const out: TodaySummary = {
    byPlatform: { uber: 0, blablacar: 0, transfer: 0 },
    kmService: 0,
    fueled: 0,
  }
  for (const r of rides.data ?? []) {
    if (r.platform === 'uber' || r.platform === 'blablacar' || r.platform === 'transfer') {
      out.byPlatform[r.platform] += Number(r.amount)
    }
    out.kmService += Number(r.km ?? 0)
  }
  for (const f of fuelings.data ?? []) out.fueled += Number(f.amount)
  return out
}

export async function getCar(carId: string): Promise<Car | null> {
  const { data, error } = await supabase.from('cars').select('*').eq('id', carId).maybeSingle()
  if (error) throw error
  return data
}

export async function listMyTransfers(driverId: string): Promise<Ride[]> {
  const { data, error } = await supabase
    .from('rides')
    .select('*')
    .eq('driver_id', driverId)
    .eq('platform', 'transfer')
    .order('scheduled_at', { ascending: true })
  if (error) throw error
  const rows = data ?? []
  // atribuídas/concluídas primeiro, conferidas por último (ordem por data preservada)
  const rank = (r: Ride) => (r.transfer_status === 'checked' ? 1 : 0)
  return [...rows].sort((a, b) => rank(a) - rank(b))
}

export async function listExpenses(rideIds: string[]): Promise<RideExpense[]> {
  if (rideIds.length === 0) return []
  const { data, error } = await supabase
    .from('ride_expenses')
    .select('*')
    .in('ride_id', rideIds)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function getCurrentPeriodId(date: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('period_for_date', { d: date })
  if (error) throw error
  return (data as string | null) ?? null
}

export async function computeStatement(
  driverId: string,
  periodId: string,
): Promise<StatementLines> {
  const { data, error } = await supabase.rpc('compute_statement', {
    p_driver: driverId,
    p_period: periodId,
  })
  if (error) throw error
  return data as unknown as StatementLines
}

export interface StatementRow {
  id: string
  period_id: string
  lines: StatementLines
  total: number | null
  paid_at: string | null
  payment_method: string | null
  start_date: string
  end_date: string
}

export async function listMyStatements(driverId: string): Promise<StatementRow[]> {
  const { data, error } = await supabase
    .from('statements')
    .select('*, periods!inner(start_date, end_date, status)')
    .eq('driver_id', driverId)
    .eq('periods.status', 'closed')
  if (error) throw error
  type Joined = Statement & { periods: { start_date: string; end_date: string } }
  return ((data ?? []) as unknown as Joined[])
    .map((s) => ({
      id: s.id,
      period_id: s.period_id,
      lines: s.lines as unknown as StatementLines,
      total: s.total,
      paid_at: s.paid_at,
      payment_method: s.payment_method,
      start_date: s.periods.start_date,
      end_date: s.periods.end_date,
    }))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
}

export interface RejectedItem {
  kind: 'Abastecimento' | 'Transfer' | 'Pedágio' | 'Estacionamento'
  date: string
  amount: number
  reason: string
}

export async function listRejectedItems(
  driverId: string,
  start: string,
  end: string,
): Promise<RejectedItem[]> {
  const [f, r] = await Promise.all([
    supabase
      .from('fuelings')
      .select('fueled_on, amount, reject_reason')
      .eq('driver_id', driverId)
      .not('reject_reason', 'is', null)
      .gte('fueled_on', start)
      .lte('fueled_on', end),
    supabase
      .from('rides')
      .select('id, ride_date, amount, reject_reason, ride_expenses(kind, amount, reject_reason)')
      .eq('driver_id', driverId)
      .gte('ride_date', start)
      .lte('ride_date', end),
  ])
  if (f.error) throw f.error
  if (r.error) throw r.error
  const out: RejectedItem[] = []
  for (const x of f.data ?? []) {
    out.push({ kind: 'Abastecimento', date: x.fueled_on, amount: Number(x.amount), reason: x.reject_reason! })
  }
  type RideJoined = {
    ride_date: string
    amount: number
    reject_reason: string | null
    ride_expenses: { kind: string; amount: number; reject_reason: string | null }[]
  }
  for (const x of (r.data ?? []) as unknown as RideJoined[]) {
    if (x.reject_reason) {
      out.push({ kind: 'Transfer', date: x.ride_date, amount: Number(x.amount), reason: x.reject_reason })
    }
    for (const e of x.ride_expenses ?? []) {
      if (e.reject_reason) {
        out.push({
          kind: e.kind === 'toll' ? 'Pedágio' : 'Estacionamento',
          date: x.ride_date,
          amount: Number(e.amount),
          reason: e.reject_reason,
        })
      }
    }
  }
  return out
}

export async function getPeriod(periodId: string): Promise<Pick<Period, 'start_date' | 'end_date' | 'status'>> {
  const { data, error } = await supabase
    .from('periods')
    .select('start_date, end_date, status')
    .eq('id', periodId)
    .single()
  if (error) throw error
  return data
}
