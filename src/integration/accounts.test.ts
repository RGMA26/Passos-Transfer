// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loginToEmail } from '../lib/loginCode'

const URL_ = process.env.SUPABASE_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

function client() {
  return createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function tokenFor(email: string, password: string) {
  const { data, error } = await client().auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`login falhou: ${error?.message}`)
  return data.session.access_token
}

async function call(fn: string, body: unknown, token?: string) {
  const res = await fetch(`${URL_}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: ANON,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json()) as Record<string, any> }
}

async function canLogin(login: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email: loginToEmail(login), password })
  return !error
}

describe.skipIf(!URL_)('edge functions de contas', () => {
  let adminToken = ''
  let driverToken = ''
  const created: string[] = []
  const valid = { name: 'João Silva', phone: '(11) 91234-5678', driver_type: 'company_car', uber_pct: 40, transfer_pct: 30 }

  beforeAll(async () => {
    adminToken = await tokenFor('admin@passostransfer.app', 'admin123')
    driverToken = await tokenFor('passos01joao@login.passostransfer.app', 'senha123')
  })

  afterAll(async () => {
    if (!SERVICE || created.length === 0) return
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })
    for (const id of created) await admin.auth.admin.deleteUser(id)
  })

  async function create(body: Record<string, unknown> = valid) {
    const r = await call('create-driver', body, adminToken)
    if (r.status === 200) created.push(r.json.driver_id)
    return r
  }

  it('admin cria motorista e consegue logar com o PIN', async () => {
    const r = await create()
    expect(r.status).toBe(200)
    expect(r.json.login_code).toMatch(/^PASSOS\d{2}JOAO$/)
    expect(r.json.temp_pin).toMatch(/^\d{6}$/)
    expect(await canLogin(r.json.login_code, r.json.temp_pin)).toBe(true)
  })

  it('motorista (não admin) recebe 403', async () => {
    const r = await call('create-driver', valid, driverToken)
    expect(r.status).toBe(403)
    expect(r.json.error).toBe('FORBIDDEN')
  })

  it('sem token recebe 401', async () => {
    const r = await call('create-driver', valid)
    expect(r.status).toBe(401)
    expect(r.json.error).toBe('UNAUTHORIZED')
  })

  it('own_car com uber_pct recebe 400 INVALID_PCT', async () => {
    const r = await create({ ...valid, driver_type: 'own_car' })
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('INVALID_PCT')
  })

  it('valida telefone e carro inexistente', async () => {
    expect((await create({ ...valid, phone: '123' })).json.error).toBe('INVALID_PHONE')
    expect((await create({ ...valid, car_id: '11111111-1111-1111-1111-111111111111' })).json.error).toBe('INVALID_CAR')
  })

  it('deactivate bloqueia o login e reactivate libera', async () => {
    const c = await create()
    const { login_code, temp_pin, driver_id } = c.json
    expect((await call('driver-access', { driver_id, action: 'deactivate' }, adminToken)).status).toBe(200)
    expect(await canLogin(login_code, temp_pin)).toBe(false)
    expect((await call('driver-access', { driver_id, action: 'reactivate' }, adminToken)).status).toBe(200)
    expect(await canLogin(login_code, temp_pin)).toBe(true)
  })

  it('reset_password invalida o PIN antigo e o novo funciona', async () => {
    const c = await create()
    const { login_code, temp_pin, driver_id } = c.json
    const r = await call('driver-access', { driver_id, action: 'reset_password' }, adminToken)
    expect(r.status).toBe(200)
    expect(r.json.temp_pin).toMatch(/^\d{6}$/)
    expect(await canLogin(login_code, temp_pin)).toBe(r.json.temp_pin === temp_pin)
    expect(await canLogin(login_code, r.json.temp_pin)).toBe(true)
  })

  it('driver-access: não-admin 403, alvo inexistente 404, ação inválida 400', async () => {
    const id = created[0]
    expect((await call('driver-access', { driver_id: id, action: 'deactivate' }, driverToken)).status).toBe(403)
    const nf = await call('driver-access', { driver_id: '11111111-1111-1111-1111-111111111111', action: 'deactivate' }, adminToken)
    expect(nf.status).toBe(404)
    expect(nf.json.error).toBe('NOT_FOUND')
    const bad = await call('driver-access', { driver_id: id, action: 'explode' }, adminToken)
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe('INVALID_ACTION')
  })
})
