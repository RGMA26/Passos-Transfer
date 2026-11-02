import { supabase } from './supabase'
import type { Car, DriverPeriod, Profile, Ride, Period, RideExpense, Shift, StatementLines } from './types'
import type { Database } from './database.types'

export type Fuel = 'gasolina' | 'alcool' | 'diesel' | 'gnv' | 'eletrico'

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error, status } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) fail(error, status) // falha de rede vira TypeError (o auth usa o perfil em cache)
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

// ---------- Edição/exclusão dos próprios lançamentos (via fila offline) ----------

const notEditable = () => Object.assign(new Error('NOT_EDITABLE'), { code: 'NOT_EDITABLE' })

/** Corrida Uber/BlaBlaCar de turno ainda não aprovado (RLS). */
export async function updateRide(p: { id: string; amount: number; km: number | null }): Promise<void> {
  const { data, error, status } = await supabase
    .from('rides')
    .update({ amount: p.amount, km: p.km })
    .eq('id', p.id)
    .select('id')
  if (error) fail(error, status)
  if (!data || data.length === 0) throw notEditable()
}

/** Abastecimento ainda pendente de conferência (RLS). */
export async function updateFueling(p: {
  id: string
  amount: number
  quantity: number
  unit_price: number
}): Promise<void> {
  const { data, error, status } = await supabase
    .from('fuelings')
    .update({ amount: p.amount, quantity: p.quantity, unit_price: p.unit_price })
    .eq('id', p.id)
    .select('id')
  if (error) fail(error, status)
  if (!data || data.length === 0) throw notEditable()
}

/** Idempotente: linha que já não existe conta como apagada; linha travada (aprovada) falha. */
async function deleteOwn(table: 'rides' | 'fuelings', id: string): Promise<void> {
  const { data, error, status } = await supabase.from(table).delete().eq('id', id).select('id')
  if (error) fail(error, status)
  if (data && data.length > 0) return
  const still = await supabase.from(table).select('id').eq('id', id).maybeSingle()
  if (still.error) fail(still.error, still.status)
  if (still.data) throw notEditable()
}

export const deleteRide = (p: { id: string }) => deleteOwn('rides', p.id)
export const deleteFueling = (p: { id: string }) => deleteOwn('fuelings', p.id)

export interface TodayEntry {
  kind: 'ride' | 'fueling'
  id: string
  /** Só para corridas. */
  platform?: 'uber' | 'blablacar'
  amount: number
  km: number | null
  /** Só para abastecimentos. */
  fuel?: Fuel
  quantity: number | null
  unit_price: number | null
  /** Corrida: turno não aprovado. Abastecimento: ainda pendente. */
  editable: boolean
}

/** Corridas Uber/BlaBlaCar e abastecimentos do dia, do servidor. */
export async function listTodayEntries(driverId: string, date: string): Promise<TodayEntry[]> {
  const [r, f] = await Promise.all([
    supabase
      .from('rides')
      .select('id, platform, amount, km, shifts(review_status)')
      .eq('driver_id', driverId)
      .eq('ride_date', date)
      .in('platform', ['uber', 'blablacar'])
      .order('created_at'),
    supabase
      .from('fuelings')
      .select('id, amount, fuel, quantity, unit_price, review_status')
      .eq('driver_id', driverId)
      .eq('fueled_on', date)
      .order('created_at'),
  ])
  if (r.error) throw r.error
  if (f.error) throw f.error
  type RideRow = {
    id: string
    platform: 'uber' | 'blablacar'
    amount: number
    km: number | null
    shifts: { review_status: string } | null
  }
  const out: TodayEntry[] = ((r.data ?? []) as unknown as RideRow[]).map((x) => ({
    kind: 'ride',
    id: x.id,
    platform: x.platform,
    amount: Number(x.amount),
    km: x.km === null ? null : Number(x.km),
    quantity: null,
    unit_price: null,
    editable: x.shifts?.review_status !== 'approved',
  }))
  for (const x of f.data ?? []) {
    out.push({
      kind: 'fueling',
      id: x.id,
      amount: Number(x.amount),
      km: null,
      fuel: x.fuel as Fuel,
      quantity: Number(x.quantity),
      unit_price: Number(x.unit_price),
      editable: x.review_status === 'pending',
    })
  }
  return out
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

export async function startTransfer(a: { ride_id: string; odometer: number; photo: string }): Promise<void> {
  const { error, status } = await supabase.rpc('start_transfer', {
    p_ride_id: a.ride_id,
    p_odometer: a.odometer,
    p_photo: a.photo,
  })
  if (error) fail(error, status)
}

export async function completeTransfer(a: { ride_id: string; odometer: number; photo: string }): Promise<void> {
  const { error, status } = await supabase.rpc('complete_transfer', {
    p_ride_id: a.ride_id,
    p_odometer: a.odometer,
    p_photo: a.photo,
  })
  if (error) fail(error, status)
}

export async function getOpenShift(driverId: string): Promise<Shift | null> {
  const { data, error, status } = await supabase
    .from('shifts')
    .select('*')
    .eq('driver_id', driverId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) fail(error, status)
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
  // em aberto primeiro, conferidas por último (ordem por data preservada)
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

export type PeriodInfo = Pick<DriverPeriod, 'id' | 'start_date' | 'end_date' | 'status'>

const NO_CURRENT_PERIOD = ['DRIVER_PAUSED', 'NO_PERIOD', 'BEFORE_CYCLE_START']

/**
 * Quinzena do motorista que contém a data (criada se preciso). Pausado (ou data fora de quinzena):
 * a última quinzena aberta dele; null se não houver.
 */
export async function getCurrentPeriod(driverId: string, date: string): Promise<PeriodInfo | null> {
  const { data, error } = await supabase.rpc('driver_period_for', { p_driver: driverId, p_date: date })
  if (!error && data) return getPeriod(data)
  if (error && !NO_CURRENT_PERIOD.includes(error.message)) throw error
  const res = await supabase
    .from('driver_periods')
    .select('id, start_date, end_date, status')
    .eq('driver_id', driverId)
    .eq('status', 'open')
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (res.error) throw res.error
  return res.data
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
  driver_period_id: string
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
    .select('*, driver_periods!inner(start_date, end_date, status)')
    .eq('driver_id', driverId)
    .eq('driver_periods.status', 'closed')
  if (error) throw error
  return (data ?? [])
    .map((s) => ({
      id: s.id,
      driver_period_id: s.driver_period_id,
      lines: s.lines as unknown as StatementLines,
      total: s.total,
      paid_at: s.paid_at,
      payment_method: s.payment_method,
      start_date: s.driver_periods.start_date,
      end_date: s.driver_periods.end_date,
    }))
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
}

export interface RejectedItem {
  kind: 'Abastecimento' | 'Transfer' | 'Pedágio' | 'Estacionamento' | 'Turno'
  date: string
  /** null para turno (não tem valor próprio). */
  amount: number | null
  reason: string
}

export async function listRejectedItems(
  driverId: string,
  start: string,
  end: string,
): Promise<RejectedItem[]> {
  const [f, r, s] = await Promise.all([
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
    supabase
      .from('shifts')
      .select('start_date, reject_reason')
      .eq('driver_id', driverId)
      .eq('review_status', 'rejected')
      .gte('start_date', start)
      .lte('start_date', end),
  ])
  if (f.error) throw f.error
  if (r.error) throw r.error
  if (s.error) throw s.error
  const out: RejectedItem[] = []
  for (const x of s.data ?? []) {
    out.push({ kind: 'Turno', date: x.start_date, amount: null, reason: x.reject_reason ?? '—' })
  }
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

export async function getPeriod(periodId: string): Promise<PeriodInfo> {
  const { data, error } = await supabase
    .from('driver_periods')
    .select('id, start_date, end_date, status')
    .eq('id', periodId)
    .single()
  if (error) throw error
  return data
}

// ---------- Admin: motoristas e carros ----------

function must<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code })
  return res.data
}

function mustRow<T>(res: { data: T; error: { message: string; code?: string } | null }): NonNullable<T> {
  const row = must(res)
  if (row == null) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' })
  return row as NonNullable<T>
}

export async function listDrivers(): Promise<Profile[]> {
  const res = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'driver')
    .order('seq_number', { ascending: true })
  return must(res) ?? []
}

export interface NewDriverInput {
  name: string
  phone: string
  driver_type: 'own_car' | 'company_car'
  uber_pct?: number
  transfer_pct: number
  car_id?: string
}

export interface DriverAccess {
  driver_id: string
  login_code: string
  temp_pin: string
}

/** Lê o código do corpo JSON de um erro HTTP da Edge Function. */
async function functionErrorCode(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context
    const body = await ctx?.json?.()
    if (body?.error) return body.error
  } catch {
    /* corpo ilegível */
  }
  return 'CREATE_FAILED'
}

export async function createDriver(input: NewDriverInput): Promise<DriverAccess> {
  const { data, error } = await supabase.functions.invoke('create-driver', { body: input })
  if (error) {
    const code = await functionErrorCode(error)
    throw Object.assign(new Error(code), { code })
  }
  return data as DriverAccess
}

export async function driverAccess(
  driverId: string,
  action: 'reset_password' | 'deactivate' | 'reactivate',
): Promise<{ temp_pin?: string }> {
  const { data, error } = await supabase.functions.invoke('driver-access', {
    body: { driver_id: driverId, action },
  })
  if (error) {
    const code = await functionErrorCode(error)
    throw Object.assign(new Error(code), { code })
  }
  return (data ?? {}) as { temp_pin?: string }
}

export async function updateDriverPcts(
  id: string,
  uber_pct: number | null,
  transfer_pct: number,
): Promise<void> {
  must(await supabase.from('profiles').update({ uber_pct, transfer_pct }).eq('id', id))
}

export async function listCars(): Promise<Car[]> {
  const res = await supabase.from('cars').select('*').order('plate', { ascending: true })
  return must(res) ?? []
}

export type CarFuelType = 'gnv' | 'diesel' | 'gasolina' | 'alcool' | 'flex' | 'eletrico' | 'hibrido'

/** Consumos por combustível (todos opcionais; null = não cadastrado). */
export interface CarConsumption {
  km_per_l_gasolina?: number | null
  km_per_l_alcool?: number | null
  km_per_l_diesel?: number | null
  km_per_m3_gnv?: number | null
  km_per_kwh?: number | null
}

export interface NewCarInput extends CarConsumption {
  model: string
  plate: string
  fuel_type: CarFuelType
  ownership: 'own' | 'company'
}

function carError(error: { message: string; code?: string }): never {
  if (error.code === '23505') throw Object.assign(new Error('PLATE_TAKEN'), { code: 'PLATE_TAKEN' })
  throw Object.assign(new Error(error.message), { code: error.code })
}

export async function createCar(input: NewCarInput): Promise<void> {
  const { error } = await supabase.from('cars').insert(input)
  if (error) carError(error)
}

export async function updateCar(
  id: string,
  patch: { model?: string; fuel_type?: CarFuelType } & CarConsumption,
): Promise<void> {
  const { error } = await supabase.from('cars').update(patch).eq('id', id)
  if (error) carError(error)
}

/** Vincula (ou desvincula, com null) mantendo cars.current_driver_id e profiles.current_car_id coerentes. */
export async function assignCar(carId: string, driverId: string | null): Promise<void> {
  const car = mustRow(await supabase.from('cars').select('*').eq('id', carId).single())
  let driverCarId: string | null = null
  if (driverId) {
    const drv = mustRow(
      await supabase.from('profiles').select('id, driver_type, current_car_id').eq('id', driverId).single(),
    )
    const expected = car.ownership === 'company' ? 'company_car' : 'own_car'
    if (drv.driver_type !== expected) {
      throw Object.assign(new Error('TYPE_MISMATCH'), { code: 'TYPE_MISMATCH' })
    }
    driverCarId = drv.current_car_id
  }
  const prevDriver = car.current_driver_id
  if (prevDriver && prevDriver !== driverId) {
    must(await supabase.from('profiles').update({ current_car_id: null }).eq('id', prevDriver))
  }
  if (driverId && driverCarId && driverCarId !== carId) {
    must(await supabase.from('cars').update({ current_driver_id: null }).eq('id', driverCarId))
  }
  must(await supabase.from('cars').update({ current_driver_id: driverId }).eq('id', carId))
  if (driverId) {
    must(await supabase.from('profiles').update({ current_car_id: carId }).eq('id', driverId))
  }
}

// ---------- Admin: transfers e conferência ----------

async function driverNames(): Promise<Map<string, string>> {
  const rows = must(await supabase.from('profiles').select('id, name').eq('role', 'driver')) ?? []
  return new Map(rows.map((p) => [p.id, p.name ?? '—']))
}

export type TransferRow = Ride & { driver_name: string }

export async function listTransfers(opts: { status?: string } = {}): Promise<TransferRow[]> {
  let q = supabase.from('rides').select('*').eq('platform', 'transfer')
  if (opts.status) q = q.eq('transfer_status', opts.status)
  const [rides, names] = await Promise.all([
    q.order('scheduled_at', { ascending: false }),
    driverNames(),
  ])
  return (must(rides) ?? []).map((r) => ({ ...r, driver_name: names.get(r.driver_id) ?? '—' }))
}

export interface NewTransferInput {
  driver_id: string
  client_name: string
  scheduled_at: string
  ride_date: string
  origin?: string | null
  destination?: string | null
  amount: number
}

export async function createTransfer(input: NewTransferInput): Promise<void> {
  const { error } = await supabase.from('rides').insert({
    id: crypto.randomUUID(),
    platform: 'transfer',
    transfer_status: 'assigned',
    ...input,
  })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}

export async function reassignTransfer(id: string, driverId: string): Promise<void> {
  const res = await supabase
    .from('rides')
    .update({ driver_id: driverId })
    .eq('id', id)
    .eq('transfer_status', 'assigned')
    .select('id')
  const rows = must(res) ?? []
  if (rows.length === 0) {
    throw Object.assign(new Error('Este transfer não pode mais ser alterado'), { code: 'NOT_CHANGEABLE' })
  }
}

export const MSG_TRANSFER_NOT_DELETABLE = 'Este transfer não pode mais ser excluído'

export async function deleteTransfer(id: string): Promise<void> {
  const res = await supabase
    .from('rides')
    .delete()
    .eq('id', id)
    .eq('transfer_status', 'assigned')
    .select('id')
  const rows = must(res) ?? []
  if (rows.length === 0) throw Object.assign(new Error(MSG_TRANSFER_NOT_DELETABLE), { code: 'NOT_DELETABLE' })
}

export interface PendingFueling {
  id: string
  driver_id: string
  driver_name: string
  fueled_on: string
  amount: number
  liters: number
  photo_path: string
}
export interface PendingExpense {
  id: string
  ride_id: string
  driver_name: string
  client_name: string | null
  ride_date: string
  kind: string
  amount: number
  photo_path: string
}
export interface PendingShift {
  id: string
  driver_id: string
  driver_name: string
  start_date: string
  odometer_start: number
  odometer_end: number | null
  odometer_start_photo: string | null
  odometer_end_photo: string | null
  uber_earnings_photo: string | null
  review_status: 'pending' | 'rejected'
  reject_reason: string | null
  /** O que o motorista lançou no turno (para conferir com o print da Uber). */
  totals: ShiftTotals
}
export interface ShiftTotals {
  uber: { amount: number; km: number }
  blablacar: { amount: number; km: number }
  transfer_km: number
}
export interface PendingTransfer {
  id: string
  driver_name: string
  client_name: string | null
  amount: number
  km: number | null
  scheduled_at: string | null
}
export interface PendingReview {
  fuelings: PendingFueling[]
  expenses: PendingExpense[]
  shifts: PendingShift[]
  transfers: PendingTransfer[]
}

const emptyTotals = (): ShiftTotals => ({
  uber: { amount: 0, km: 0 },
  blablacar: { amount: 0, km: 0 },
  transfer_km: 0,
})

/** Soma por turno do que foi lançado: Uber/BlaBlaCar (valor e km) e km de transfers concluídos. */
async function shiftTotals(shiftIds: string[]): Promise<Map<string, ShiftTotals>> {
  const out = new Map<string, ShiftTotals>()
  if (shiftIds.length === 0) return out
  const rows =
    must(
      await supabase
        .from('rides')
        .select('shift_id, platform, amount, km, transfer_status')
        .in('shift_id', shiftIds),
    ) ?? []
  for (const r of rows) {
    if (!r.shift_id) continue
    const t = out.get(r.shift_id) ?? emptyTotals()
    const km = Number(r.km ?? 0)
    if (r.platform === 'uber' || r.platform === 'blablacar') {
      t[r.platform].amount += Number(r.amount)
      t[r.platform].km += km
    } else if (r.transfer_status === 'completed' || r.transfer_status === 'checked') {
      t.transfer_km += km
    }
    out.set(r.shift_id, t)
  }
  return out
}

export async function listPendingReview(): Promise<PendingReview> {
  const [f, e, s, t, names] = await Promise.all([
    supabase.from('fuelings').select('*').eq('review_status', 'pending').order('fueled_on'),
    supabase
      .from('ride_expenses')
      .select('*, rides!inner(driver_id, client_name, ride_date)')
      .eq('review_status', 'pending')
      .order('created_at'),
    supabase
      .from('shifts')
      .select('*')
      .in('review_status', ['pending', 'rejected'])
      .not('ended_at', 'is', null)
      .order('started_at'),
    supabase
      .from('rides')
      .select('*')
      .eq('platform', 'transfer')
      .eq('transfer_status', 'completed')
      .order('scheduled_at'),
    driverNames(),
  ])
  const n = (id: string) => names.get(id) ?? '—'
  const shiftRows = must(s) ?? []
  const totals = await shiftTotals(shiftRows.map((x) => x.id))
  type ExpJoined = RideExpense & {
    rides: { driver_id: string; client_name: string | null; ride_date: string }
  }
  return {
    fuelings: (must(f) ?? []).map((x) => ({
      id: x.id,
      driver_id: x.driver_id,
      driver_name: n(x.driver_id),
      fueled_on: x.fueled_on,
      amount: Number(x.amount),
      liters: Number(x.quantity),
      photo_path: x.photo_path,
    })),
    expenses: ((must(e) ?? []) as unknown as ExpJoined[]).map((x) => ({
      id: x.id,
      ride_id: x.ride_id,
      driver_name: n(x.rides.driver_id),
      client_name: x.rides.client_name,
      ride_date: x.rides.ride_date,
      kind: x.kind,
      amount: Number(x.amount),
      photo_path: x.photo_path,
    })),
    shifts: shiftRows.map((x) => ({
      id: x.id,
      driver_id: x.driver_id,
      driver_name: n(x.driver_id),
      start_date: x.start_date,
      odometer_start: Number(x.odometer_start),
      odometer_end: x.odometer_end === null ? null : Number(x.odometer_end),
      odometer_start_photo: x.odometer_start_photo,
      odometer_end_photo: x.odometer_end_photo,
      uber_earnings_photo: x.uber_earnings_photo,
      review_status: x.review_status === 'rejected' ? 'rejected' : 'pending',
      reject_reason: x.reject_reason,
      totals: totals.get(x.id) ?? emptyTotals(),
    })),
    transfers: (must(t) ?? []).map((x) => ({
      id: x.id,
      driver_name: n(x.driver_id),
      client_name: x.client_name,
      amount: Number(x.amount),
      km: x.km === null ? null : Number(x.km),
      scheduled_at: x.scheduled_at,
    })),
  }
}

export async function reviewItem(
  kind: 'fueling' | 'expense' | 'shift' | 'transfer',
  id: string,
  approved: boolean,
  reason: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('review_item', {
    p_kind: kind,
    p_id: id,
    p_approved: approved,
    p_reason: reason as string,
  })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}

export interface AdminAlert {
  kind: 'HIGH_OFF_KM' | 'NEGATIVE_OFF_KM' | 'SHIFT_OPEN_24H'
  driver_id: string
  driver_name: string
  shift_id: string
  detail: { km_total?: number; km_service?: number; km_off?: number; started_at?: string }
}

export async function listAlerts(): Promise<AdminAlert[]> {
  const [res, names] = await Promise.all([supabase.rpc('admin_alerts'), driverNames()])
  return (must(res) ?? []).map((a) => ({
    kind: a.kind as AdminAlert['kind'],
    driver_id: a.driver_id,
    driver_name: names.get(a.driver_id) ?? '—',
    shift_id: a.shift_id,
    detail: (a.detail ?? {}) as AdminAlert['detail'],
  }))
}

export async function signedPhotoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('photos').createSignedUrl(path, 600)
  if (error || !data) throw new Error('PHOTO_UNAVAILABLE')
  return data.signedUrl
}

export async function updateShiftOdometers(id: string, start: number, end: number): Promise<void> {
  must(await supabase.from('shifts').update({ odometer_start: start, odometer_end: end }).eq('id', id))
}

// ---------- Admin: quinzenas, extratos e painel ----------

/** Quinzenas globais deixaram de existir (0010); a tela é refeita por motorista (Task 9). */
function notAvailable(): never {
  throw Object.assign(new Error('NOT_AVAILABLE'), { code: 'NOT_AVAILABLE' })
}

export async function listPeriods(): Promise<Period[]> {
  return notAvailable()
}

export async function setReferencePrice(_periodId: string, _value: number): Promise<void> {
  return notAvailable()
}

export type AdjustmentKind = 'advance' | 'fine' | 'bonus' | 'correction'
export type Adjustment = Database['public']['Tables']['adjustments']['Row']

export async function listAdjustments(periodId: string): Promise<Adjustment[]> {
  const res = await supabase
    .from('adjustments')
    .select('*')
    .eq('driver_period_id', periodId)
    .order('created_at', { ascending: true })
  return must(res) ?? []
}

export interface NewAdjustmentInput {
  driver_id: string
  period_id: string
  kind: AdjustmentKind
  amount: number
  description: string
}

export async function createAdjustment(input: NewAdjustmentInput): Promise<void> {
  const { period_id, ...rest } = input
  must(
    await supabase
      .from('adjustments')
      .insert({ id: crypto.randomUUID(), ...rest, driver_period_id: period_id }),
  )
}

export async function deleteAdjustment(id: string): Promise<void> {
  must(await supabase.from('adjustments').delete().eq('id', id))
}

export interface PeriodDriverStatement {
  driver_id: string
  driver_name: string
  driver_code: string
  driver_type: string | null
  lines: StatementLines
  total: number
  /** null enquanto a quinzena está aberta (valor estimado). */
  statement_id: string | null
  paid_at: string | null
  payment_method: string | null
}

export async function periodDriverStatements(_periodId: string): Promise<PeriodDriverStatement[]> {
  return notAvailable()
}

/** `force` fecha antes do fim da quinzena (senão o servidor responde PERIOD_NOT_ENDED). */
export async function closePeriod(
  periodId: string,
  force = false,
  allowMissingFuelPrice = false,
): Promise<string> {
  const { data, error } = await supabase.rpc('close_driver_period', {
    p_period: periodId,
    p_force: force,
    p_allow_missing_fuel_price: allowMissingFuelPrice,
  })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data
}

export async function markStatementPaid(statementId: string, paidAt: string, method: string): Promise<void> {
  const { error } = await supabase.rpc('mark_statement_paid', {
    p_statement: statementId,
    p_paid_at: paidAt,
    p_method: method,
  })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}

export interface PeriodSummary {
  revenue: { uber: number; transfer: number; blablacar: number }
  drivers_share: number
  company_share: number
  fuel_reimbursed: number
  fuel_discounted: number
  off_km_ranking: { driver_id: string; name: string; km_off: number }[]
}

export async function periodSummary(_periodId: string): Promise<PeriodSummary> {
  return notAvailable()
}

export interface FullStatement {
  id: string
  lines: StatementLines
  total: number
  paid_at: string | null
  payment_method: string | null
  driver: { name: string; login_code: string; driver_type: string | null }
  period: { start_date: string; end_date: string }
}

export async function getStatement(id: string): Promise<FullStatement> {
  const s = mustRow(await supabase.from('statements').select('*').eq('id', id).maybeSingle())
  const [d, p] = await Promise.all([
    supabase.from('profiles').select('name, login_code, driver_type').eq('id', s.driver_id).single(),
    supabase.from('driver_periods').select('start_date, end_date').eq('id', s.driver_period_id).single(),
  ])
  const drv = mustRow(d)
  const per = mustRow(p)
  const lines = s.lines as unknown as StatementLines
  return {
    id: s.id,
    lines,
    total: Number(s.total ?? lines.total),
    paid_at: s.paid_at,
    payment_method: s.payment_method,
    driver: { name: drv.name ?? '—', login_code: drv.login_code ?? '', driver_type: drv.driver_type },
    period: per,
  }
}
