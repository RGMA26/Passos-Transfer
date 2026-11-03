import { supabase } from './supabase'
import type { Car, DriverPeriod, Profile, Ride, RideExpense, Shift, StatementLines } from './types'
import type { Database } from './database.types'
import { localDate } from './periods'

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
  /** null = a foto não subiu; vem depois por attachPhoto (pendência 📷 no admin até lá) */
  photo: string | null
}): Promise<void> {
  const { error, status } = await supabase.rpc('start_shift', {
    p_id: a.id,
    p_car_id: a.car_id,
    p_odometer: a.odometer,
    p_photo: a.photo as string,
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
  photo: string | null
  uber_photo?: string | null
}): Promise<EndShiftResult> {
  const { data, error, status } = await supabase.rpc('end_shift', {
    p_shift_id: a.shift_id,
    p_odometer: a.odometer,
    p_photo: a.photo as string,
    // o parâmetro precisa estar sempre no corpo (PostgREST não resolve sem ele); null = sem print
    p_uber_photo: (a.uber_photo ?? null) as string,
  })
  if (error) fail(error, status)
  return data as unknown as EndShiftResult
}

export async function startTransfer(a: { ride_id: string; odometer: number; photo: string | null }): Promise<void> {
  const { error, status } = await supabase.rpc('start_transfer', {
    p_ride_id: a.ride_id,
    p_odometer: a.odometer,
    p_photo: a.photo as string,
  })
  if (error) fail(error, status)
}

export async function completeTransfer(a: { ride_id: string; odometer: number; photo: string | null }): Promise<void> {
  const { error, status } = await supabase.rpc('complete_transfer', {
    p_ride_id: a.ride_id,
    p_odometer: a.odometer,
    p_photo: a.photo as string,
  })
  if (error) fail(error, status)
}

/** Anexa a foto do odômetro / print da Uber que não subiu junto (só preenche se ainda estiver vazia). */
export async function attachPhoto(a: {
  target: 'shift_start' | 'shift_end' | 'shift_uber' | 'transfer_start' | 'transfer_end'
  id: string
  path: string
}): Promise<void> {
  const { error, status } = await supabase.rpc('attach_photo', { p_target: a.target, p_id: a.id, p_path: a.path })
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

const NO_CURRENT_PERIOD = ['DRIVER_PAUSED', 'NO_PERIOD', 'BEFORE_CYCLE_START', 'FUTURE_DATE']

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
  /** Só dígitos (11). */
  cpf: string
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
async function functionErrorCode(error: unknown, fallback = 'CREATE_FAILED'): Promise<string> {
  try {
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context
    const body = await ctx?.json?.()
    if (body?.error) return body.error
  } catch {
    /* corpo ilegível */
  }
  return fallback
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

export interface UpdateDriverInput {
  name: string
  phone: string
  /** Só dígitos (11). */
  cpf: string
  driver_type: 'own_car' | 'company_car'
  uber_pct: number | null
  transfer_pct: number
  car_id: string | null
}

/** Edição completa do motorista (Edge Function update-driver). */
export async function updateDriver(driverId: string, input: UpdateDriverInput): Promise<void> {
  const { error } = await supabase.functions.invoke('update-driver', {
    body: { driver_id: driverId, ...input },
  })
  if (error) {
    const code = await functionErrorCode(error, 'UPDATE_FAILED')
    throw Object.assign(new Error(code), { code })
  }
}

// ---------- Admin: sinais, pausa e documentos ----------

export type DriverSignalRow = Database['public']['Functions']['driver_period_signals']['Returns'][number]
export type DriverPause = Database['public']['Tables']['driver_pauses']['Row']
export type AdminDocument = Database['public']['Tables']['admin_documents']['Row']
export type AdminDocKind = 'payment_proof' | 'signed_receipt' | 'other'

export async function listDriverSignals(): Promise<DriverSignalRow[]> {
  return must(await supabase.rpc('driver_period_signals')) ?? []
}

/** Erro de RPC: a mensagem do Postgres e o codigo (OPEN_SHIFTS, INVALID_DATE, ...). */
function rpcMust(res: { error: { message: string } | null }): void {
  if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.message })
}

export async function pauseDriver(driverId: string, pausedOn: string, reason: string): Promise<void> {
  rpcMust(
    await supabase.rpc('pause_driver', {
      p_driver: driverId,
      p_paused_on: pausedOn,
      p_reason: reason,
    }),
  )
}

export async function resumeDriver(driverId: string, resumeOn: string): Promise<void> {
  rpcMust(await supabase.rpc('resume_driver', { p_driver: driverId, p_resume_on: resumeOn }))
}

export async function listDriverPauses(driverId: string): Promise<DriverPause[]> {
  const res = await supabase
    .from('driver_pauses')
    .select('*')
    .eq('driver_id', driverId)
    .order('paused_on', { ascending: false })
  return must(res) ?? []
}

export const MSG_ADMIN_DOC_TYPE = 'Envie JPG, PNG ou PDF de até 10 MB'
const ADMIN_DOC_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}
const MAX_ADMIN_DOC_BYTES = 10 * 1024 * 1024

export async function listAdminDocuments(
  filter: { driverId?: string; statementId?: string } = {},
): Promise<AdminDocument[]> {
  let q = supabase.from('admin_documents').select('*')
  if (filter.driverId) q = q.eq('driver_id', filter.driverId)
  if (filter.statementId) q = q.eq('statement_id', filter.statementId)
  return must(await q.order('created_at', { ascending: false })) ?? []
}

export async function uploadAdminDocument(a: {
  driverId: string
  statementId?: string | null
  kind: AdminDocKind
  description?: string | null
  file: File | Blob
}): Promise<void> {
  const ext = ADMIN_DOC_TYPES[a.file.type]
  if (!ext || a.file.size <= 0 || a.file.size > MAX_ADMIN_DOC_BYTES) {
    throw Object.assign(new Error('INVALID_FILE'), { code: 'INVALID_FILE' })
  }
  const path = `${a.driverId}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from('admin-docs').upload(path, a.file, { contentType: a.file.type })
  if (up.error) throw Object.assign(new Error(up.error.message), { code: 'UPLOAD_FAILED' })
  const res = await supabase.from('admin_documents').insert({
    driver_id: a.driverId,
    statement_id: a.statementId ?? null,
    kind: a.kind,
    description: a.description?.trim() || null,
    file_path: path,
    mime_type: a.file.type,
    size_bytes: a.file.size,
  })
  if (res.error) {
    await supabase.storage.from('admin-docs').remove([path])
    throw Object.assign(new Error(res.error.message), { code: res.error.code })
  }
}

export async function deleteAdminDocument(doc: Pick<AdminDocument, 'id' | 'file_path'>): Promise<void> {
  must(await supabase.from('admin_documents').delete().eq('id', doc.id))
  await supabase.storage.from('admin-docs').remove([doc.file_path])
}

export async function adminDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('admin-docs').createSignedUrl(path, 600)
  if (error || !data) throw new Error('DOCUMENT_UNAVAILABLE')
  return data.signedUrl
}

// ---------- Admin: gastos dos carros da empresa ----------

export type CarExpense = Database['public']['Tables']['car_expenses']['Row']
export type CarExpenseKind = 'maintenance' | 'insurance' | 'tax' | 'other'
export type CarExpenseMode = 'single' | 'installments' | 'recurring'

export interface NewCarExpenseInput {
  car_id: string
  kind: CarExpenseKind
  description: string | null
  mode: CarExpenseMode
  amount: number
  installments: number | null
  start_date: string
}

export async function listCarExpenses(carId: string): Promise<CarExpense[]> {
  const res = await supabase
    .from('car_expenses')
    .select('*')
    .eq('car_id', carId)
    .order('start_date', { ascending: false })
  return must(res) ?? []
}

export async function createCarExpense(input: NewCarExpenseInput): Promise<void> {
  must(await supabase.from('car_expenses').insert(input))
}

export async function updateCarExpense(
  id: string,
  patch: Partial<Omit<NewCarExpenseInput, 'car_id'>>,
): Promise<void> {
  must(await supabase.from('car_expenses').update(patch).eq('id', id))
}

/** lastMonth: qualquer data do último mês que conta (grava o dia 1 do mês). */
export async function finishCarExpense(id: string, lastMonth: string): Promise<void> {
  must(
    await supabase
      .from('car_expenses')
      .update({ end_date: `${lastMonth.slice(0, 7)}-01`, finished: true })
      .eq('id', id),
  )
}

export async function deleteCarExpense(id: string): Promise<void> {
  must(await supabase.from('car_expenses').update({ deleted_on: localDate() }).eq('id', id))
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

export interface AddressInput {
  street: string
  district: string
  city: string
  state: string
  zip?: string | null
  ref?: string | null
}

export interface NewTransferInput {
  driver_id: string
  client_name: string
  scheduled_at: string
  ride_date: string
  origin: AddressInput
  destination: AddressInput
  amount: number
  /** Km estimado pela rota (null = não calculado). */
  estimated_km?: number | null
}

/** "Rua X, 10 – Centro, Cidade/UF" para exibição. */
export function formatAddress(a: AddressInput): string {
  const place = [a.district, a.city && a.state ? `${a.city}/${a.state}` : a.city || a.state].filter(Boolean).join(', ')
  return [a.street, place].filter(Boolean).join(' – ')
}

/** Km estimado entre origem e destino (Edge Function estimate-route); null se não conseguir. */
export async function estimateRoute(origin: AddressInput, destination: AddressInput): Promise<number | null> {
  try {
    const pick = (a: AddressInput) => ({
      street: a.street,
      district: a.district,
      city: a.city,
      state: a.state,
      zip: a.zip ?? '',
    })
    const { data, error } = await supabase.functions.invoke('estimate-route', {
      body: { origin: pick(origin), destination: pick(destination) },
    })
    if (error) return null
    const km = (data as { km?: unknown } | null)?.km
    return typeof km === 'number' && Number.isFinite(km) ? km : null
  } catch {
    return null
  }
}

export async function createTransfer(input: NewTransferInput): Promise<void> {
  const { origin, destination, estimated_km, ...rest } = input
  const { error } = await supabase.from('rides').insert({
    id: crypto.randomUUID(),
    platform: 'transfer',
    transfer_status: 'assigned',
    ...rest,
    origin: formatAddress(origin),
    origin_street: origin.street,
    origin_district: origin.district,
    origin_city: origin.city,
    origin_state: origin.state,
    origin_zip: origin.zip?.trim() || null,
    origin_ref: origin.ref?.trim() || null,
    destination: formatAddress(destination),
    dest_street: destination.street,
    dest_district: destination.district,
    dest_city: destination.city,
    dest_state: destination.state,
    dest_zip: destination.zip?.trim() || null,
    dest_ref: destination.ref?.trim() || null,
    estimated_km: estimated_km ?? null,
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
  fuel: Fuel
  quantity: number
  unit_price: number
  values_conflict: boolean
  photo_path: string
}
export interface PendingExpense {
  id: string
  kind: string
  amount: number
  review_status: string
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
  /** Corridas do turno, cada uma com o comprovante (foto ou PDF), na ordem de lançamento. */
  rides: PendingShiftRide[]
}
export interface PendingShiftRide {
  id: string
  platform: 'uber' | 'blablacar' | 'transfer'
  ride_date: string
  amount: number
  km: number | null
  receipt_path: string | null
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
  /** Km real (odômetro final − inicial). */
  km: number | null
  estimated_km: number | null
  scheduled_at: string | null
  origin: string | null
  destination: string | null
  odometer_start: number | null
  odometer_end: number | null
  odometer_start_photo: string | null
  odometer_end_photo: string | null
  /** Pedágios e estacionamentos do Transfer (aprovados junto com ele). */
  expenses: PendingExpense[]
}
export interface PendingReview {
  fuelings: PendingFueling[]
  shifts: PendingShift[]
  transfers: PendingTransfer[]
}

const emptyTotals = (): ShiftTotals => ({
  uber: { amount: 0, km: 0 },
  blablacar: { amount: 0, km: 0 },
  transfer_km: 0,
})

/** Soma por turno do que foi lançado: Uber/BlaBlaCar (valor e km) e km de transfers concluídos. */
async function shiftTotals(
  shiftIds: string[],
): Promise<{ totals: Map<string, ShiftTotals>; rides: Map<string, PendingShiftRide[]> }> {
  const out = new Map<string, ShiftTotals>()
  const rides = new Map<string, PendingShiftRide[]>()
  if (shiftIds.length === 0) return { totals: out, rides }
  const rows =
    must(
      await supabase
        .from('rides')
        .select('id, shift_id, platform, amount, km, transfer_status, ride_date, receipt_path, created_at')
        .in('shift_id', shiftIds)
        .order('created_at'),
    ) ?? []
  for (const r of rows) {
    if (!r.shift_id) continue
    if (r.platform !== 'transfer' || r.transfer_status === 'completed' || r.transfer_status === 'checked') {
      const list = rides.get(r.shift_id) ?? []
      list.push({
        id: r.id,
        platform: r.platform as PendingShiftRide['platform'],
        ride_date: r.ride_date,
        amount: Number(r.amount),
        km: r.km === null || r.km === undefined ? null : Number(r.km),
        receipt_path: r.receipt_path ?? null,
      })
      rides.set(r.shift_id, list)
    }
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
  return { totals: out, rides }
}

export async function listPendingReview(): Promise<PendingReview> {
  const [f, s, t, names] = await Promise.all([
    supabase.from('fuelings').select('*').eq('review_status', 'pending').order('fueled_on'),
    supabase
      .from('shifts')
      .select('*')
      .in('review_status', ['pending', 'rejected'])
      .not('ended_at', 'is', null)
      .order('started_at'),
    supabase
      .from('rides')
      .select('*, ride_expenses(*)')
      .eq('platform', 'transfer')
      .eq('transfer_status', 'completed')
      .order('scheduled_at'),
    driverNames(),
  ])
  const n = (id: string) => names.get(id) ?? '—'
  const num = (v: number | null) => (v === null || v === undefined ? null : Number(v))
  const shiftRows = must(s) ?? []
  const { totals, rides: shiftRides } = await shiftTotals(shiftRows.map((x) => x.id))
  type TransferJoined = Ride & { ride_expenses: RideExpense[] | null }
  return {
    fuelings: (must(f) ?? []).map((x) => ({
      id: x.id,
      driver_id: x.driver_id,
      driver_name: n(x.driver_id),
      fueled_on: x.fueled_on,
      amount: Number(x.amount),
      fuel: x.fuel as Fuel,
      quantity: Number(x.quantity),
      unit_price: Number(x.unit_price),
      values_conflict: x.values_conflict,
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
      rides: shiftRides.get(x.id) ?? [],
    })),
    transfers: ((must(t) ?? []) as unknown as TransferJoined[]).map((x) => ({
      id: x.id,
      driver_name: n(x.driver_id),
      client_name: x.client_name,
      amount: Number(x.amount),
      km: num(x.km),
      estimated_km: num(x.estimated_km),
      scheduled_at: x.scheduled_at,
      origin: x.origin,
      destination: x.destination,
      odometer_start: num(x.odometer_start),
      odometer_end: num(x.odometer_end),
      odometer_start_photo: x.odometer_start_photo,
      odometer_end_photo: x.odometer_end_photo,
      expenses: (x.ride_expenses ?? []).map((e) => ({
        id: e.id,
        kind: e.kind,
        amount: Number(e.amount),
        review_status: e.review_status,
        photo_path: e.photo_path,
      })),
    })),
  }
}

export async function reviewItem(
  kind: 'fueling' | 'shift' | 'transfer',
  id: string,
  approved: boolean,
  reason: string | null,
  /** Transfer: despesas que o admin viu; havendo outra pendente, o servidor responde NEW_EXPENSES. */
  expenseIds?: string[],
): Promise<void> {
  const { error } = await supabase.rpc('review_item', {
    p_kind: kind,
    p_id: id,
    p_approved: approved,
    p_reason: reason as string,
    ...(expenseIds ? { p_expense_ids: expenseIds } : {}),
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

export type { DriverPeriod }

/** Quinzenas do motorista, da mais recente para a mais antiga. */
export async function listDriverPeriods(driverId: string): Promise<DriverPeriod[]> {
  const res = await supabase
    .from('driver_periods')
    .select('*')
    .eq('driver_id', driverId)
    .order('start_date', { ascending: false })
  return must(res) ?? []
}

export interface PeriodOverviewRow {
  driver_id: string
  driver_name: string
  paused: boolean
  /** false = motorista inativo que ainda tem quinzena aberta ou extrato não pago. */
  active: boolean
  signal: 'red' | 'yellow' | null
  period_id: string | null
  start_date: string | null
  end_date: string | null
  /** Total estimado da quinzena atual (null se não houver). */
  total: number | null
}

/**
 * Motoristas ativos, e inativos que ainda têm quinzena aberta ou extrato não pago, com a
 * quinzena atual, o sinal e o total estimado.
 */
export async function listPeriodOverview(): Promise<PeriodOverviewRow[]> {
  const [signals, drivers] = await Promise.all([listDriverSignals(), listDrivers()])
  const byId = new Map(drivers.map((d) => [d.id, d]))
  return Promise.all(
    signals.map(async (s) => {
      let total: number | null = null
      if (s.current_period_id) {
        try {
          total = Number((await computeStatement(s.driver_id, s.current_period_id)).total)
        } catch {
          total = null
        }
      }
      return {
        driver_id: s.driver_id,
        driver_name: s.name ?? byId.get(s.driver_id)?.name ?? '—',
        paused: s.paused,
        active: s.active ?? byId.get(s.driver_id)?.active ?? true,
        signal: (s.signal === 'red' || s.signal === 'yellow' ? s.signal : null) as 'red' | 'yellow' | null,
        period_id: s.current_period_id,
        start_date: s.start_date,
        end_date: s.end_date,
        total,
      }
    }),
  )
}

export interface PeriodStatement {
  period: DriverPeriod
  driver: { id: string; name: string; login_code: string; driver_type: string | null }
  lines: StatementLines
  total: number
  /** null enquanto a quinzena está aberta (valor estimado). */
  statement_id: string | null
  paid_at: string | null
  payment_method: string | null
}

/** Extrato da quinzena: o congelado se fechada, senão o estimado (compute_statement). */
export async function driverPeriodStatement(periodId: string): Promise<PeriodStatement> {
  const period = mustRow(await supabase.from('driver_periods').select('*').eq('id', periodId).maybeSingle())
  const drv = mustRow(
    await supabase
      .from('profiles')
      .select('id, name, login_code, driver_type')
      .eq('id', period.driver_id)
      .maybeSingle(),
  )
  const driver = { id: drv.id, name: drv.name ?? '—', login_code: drv.login_code ?? '', driver_type: drv.driver_type }
  if (period.status === 'closed') {
    const s = mustRow(
      await supabase.from('statements').select('*').eq('driver_period_id', periodId).maybeSingle(),
    )
    const lines = s.lines as unknown as StatementLines
    return {
      period,
      driver,
      lines,
      total: Number(s.total ?? lines.total),
      statement_id: s.id,
      paid_at: s.paid_at,
      payment_method: s.payment_method,
    }
  }
  const lines = await computeStatement(period.driver_id, periodId)
  return {
    period,
    driver,
    lines,
    total: Number(lines.total),
    statement_id: null,
    paid_at: null,
    payment_method: null,
  }
}

/** `force` fecha antes do fim da quinzena; `allowMissingFuelPrice` aceita gasolina a R$ 0,00. */
export async function closeDriverPeriod(
  periodId: string,
  opts: { force?: boolean; allowMissingFuelPrice?: boolean } = {},
): Promise<string> {
  const { data, error } = await supabase.rpc('close_driver_period', {
    p_period: periodId,
    p_force: opts.force ?? false,
    p_allow_missing_fuel_price: opts.allowMissingFuelPrice ?? false,
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

// ---------- Admin: pendências e balanço mensal ----------

export type PendencyCategory = 'white' | 'yellow' | 'red' | 'orange'
export type Pendency = Omit<
  Database['public']['Functions']['admin_pendencies']['Returns'][number],
  'category' | 'item_type'
> & { category: PendencyCategory; item_type: 'fueling' | 'shift' | 'transfer' | 'period' }

export async function listPendencies(): Promise<Pendency[]> {
  return (must(await supabase.rpc('admin_pendencies')) ?? []) as Pendency[]
}

export interface BalanceCarExpense {
  expense_id: string
  car_id: string
  plate: string
  model: string
  kind: string
  description: string | null
  mode: string
  installment_no: number | null
  installments: number | null
  amount: number
}

export interface MonthlyBalance {
  month: string
  estimated: boolean
  result: {
    revenue: { uber: number; transfer: number; blablacar: number; total: number }
    owed: {
      total: number
      uber_share: number
      transfer_share: number
      fuel_reimbursement: number
      transfer_fuel: number
      expense_reimbursement: number
      /** vem positivo; é um desconto */
      off_duty_discount: number
      adjustments: number
      by_driver: { driver_id: string; name: string; total: number }[]
    }
    car_expenses: {
      total: number
      by_kind: { maintenance: number; insurance: number; tax: number; other: number }
      items: BalanceCarExpense[]
    }
    company_result: number
    previous_company_result: number
    diff: number
    diff_pct: number | null
  }
  cash: {
    total: number
    items: {
      statement_id: string
      driver_id: string
      name: string
      period_start: string
      period_end: string
      total: number
      paid_at: string
      payment_method: string | null
      has_payment_proof: boolean
      has_signed_receipt: boolean
    }[]
  }
  payable: {
    total: number
    items: { driver_id: string; name: string; closed_unpaid: number; open_estimate: number }[]
  }
  off_km_ranking: {
    by_driver: { driver_id: string; name: string; km_off: number }[]
    by_car: { car_id: string; plate: string; model: string; km_off: number }[]
  }
}

export async function monthlyBalance(month: string): Promise<MonthlyBalance> {
  return mustRow(await supabase.rpc('monthly_balance', { p_month: month })) as unknown as MonthlyBalance
}

export type MonthlyDetailRow = Database['public']['Functions']['monthly_detail']['Returns'][number]

export async function monthlyDetail(month: string): Promise<MonthlyDetailRow[]> {
  return must(await supabase.rpc('monthly_detail', { p_month: month })) ?? []
}

export interface FullStatement {
  id: string
  lines: StatementLines
  total: number
  paid_at: string | null
  payment_method: string | null
  driver: { name: string; cpf: string | null; login_code: string; driver_type: string | null }
  period: { start_date: string; end_date: string }
}

export async function getStatement(id: string): Promise<FullStatement> {
  const s = mustRow(await supabase.from('statements').select('*').eq('id', id).maybeSingle())
  const [d, p] = await Promise.all([
    supabase.from('profiles').select('name, cpf, login_code, driver_type').eq('id', s.driver_id).single(),
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
    driver: { name: drv.name ?? '—', cpf: drv.cpf, login_code: drv.login_code ?? '', driver_type: drv.driver_type },
    period: per,
  }
}
