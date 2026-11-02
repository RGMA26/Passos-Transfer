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

/** CPF válido aleatório (só dígitos). */
function genCpf(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
  if (d.every((x) => x === d[0])) d[8] = (d[0] + 1) % 10
  for (const n of [9, 10]) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += d[i] * (n + 1 - i)
    const r = (sum * 10) % 11
    d.push(r === 10 ? 0 : r)
  }
  return d.join('')
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
    const r = await call('create-driver', { cpf: genCpf(), ...body }, adminToken)
    if (r.status === 200) created.push(r.json.driver_id)
    return r
  }

  it('admin cria motorista e consegue logar com o PIN', async () => {
    const r = await create()
    expect(r.status).toBe(200)
    expect(r.json.login_code).toMatch(/^PASSOS\d{2,}JOAO$/)
    expect(r.json.temp_pin).toMatch(/^\d{6}$/)
    expect(await canLogin(r.json.login_code, r.json.temp_pin)).toBe(true)
  })

  it('motorista (não admin) recebe 403', async () => {
    const r = await call('create-driver', { ...valid, cpf: genCpf() }, driverToken)
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

  it('CPF: inválido, ausente, duplicado; aceita máscara e grava só dígitos', async () => {
    expect((await create({ ...valid, cpf: '52998224726' })).json.error).toBe('INVALID_CPF')
    expect((await create({ ...valid, cpf: '11111111111' })).json.error).toBe('INVALID_CPF')
    const r0 = await call('create-driver', valid, adminToken)
    expect(r0.status).toBe(400)
    expect(r0.json.error).toBe('INVALID_CPF')
    const cpf = genCpf()
    const masked = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`
    const ok = await create({ ...valid, cpf: masked })
    expect(ok.status).toBe(200)
    if (SERVICE) {
      const { data } = await createClient(URL_, SERVICE, { auth: { persistSession: false } })
        .from('profiles').select('cpf').eq('id', ok.json.driver_id).single()
      expect(data?.cpf).toBe(cpf)
    }
    const dup = await create({ ...valid, cpf })
    expect(dup.status).toBe(400)
    expect(dup.json.error).toBe('CPF_TAKEN')
    expect((await create({ ...valid, cpf: '529.982.247-25' })).json.error).toBe('CPF_TAKEN') // do seed (João)
  })

  it('valida telefone e carro inexistente', async () => {
    expect((await create({ ...valid, phone: '123' })).json.error).toBe('INVALID_PHONE')
    expect((await create({ ...valid, car_id: '11111111-1111-1111-1111-111111111111' })).json.error).toBe('INVALID_CAR')
  })

  describe.skipIf(!SERVICE)('vínculo de carro', () => {
    const svc = () => createClient(URL_, SERVICE!, { auth: { persistSession: false } })
    const carIds: string[] = []
    async function newCar(ownership: 'own' | 'company') {
      const plate = 'T' + Math.random().toString(36).slice(2, 8).toUpperCase()
      const { data, error } = await svc().from('cars')
        .insert({ model: 'Teste', plate, fuel_type: 'flex', km_per_l_gasolina: 10, ownership }).select('id').single()
      if (error) throw error
      carIds.push(data.id)
      return data.id as string
    }
    afterAll(async () => {
      for (const id of carIds) {
        await svc().from('profiles').update({ current_car_id: null }).eq('current_car_id', id)
      }
      for (const id of created) await svc().auth.admin.deleteUser(id)
      for (const id of carIds) await svc().from('cars').delete().eq('id', id)
      created.length = 0
    })

    it('vincula carro livre e rejeita carro já ocupado', async () => {
      const carId = await newCar('company')
      const r = await create({ ...valid, car_id: carId })
      expect(r.status).toBe(200)
      const { data: car } = await svc().from('cars').select('current_driver_id').eq('id', carId).single()
      const { data: prof } = await svc().from('profiles').select('current_car_id').eq('id', r.json.driver_id).single()
      expect(car?.current_driver_id).toBe(r.json.driver_id)
      expect(prof?.current_car_id).toBe(carId)

      const again = await create({ ...valid, car_id: carId })
      expect(again.status).toBe(400)
      expect(again.json.error).toBe('INVALID_CAR')
      const { data: after } = await svc().from('cars').select('current_driver_id').eq('id', carId).single()
      expect(after?.current_driver_id).toBe(r.json.driver_id)
    })

    it('update-driver: nome, CPF, %, tipo e carro', async () => {
      const c = await create({ ...valid, car_id: await newCar('company') })
      expect(c.status).toBe(200)
      const id = c.json.driver_id as string
      const carA = await newCar('company')
      const carOwn = await newCar('own')
      const row = async () => (await svc().from('profiles').select('*').eq('id', id).single()).data!
      const carRow = async (cid: string) =>
        (await svc().from('cars').select('current_driver_id').eq('id', cid).single()).data!.current_driver_id

      // permissões e alvo
      expect((await call('update-driver', { driver_id: id, name: 'X' }, driverToken)).status).toBe(403)
      expect((await call('update-driver', { driver_id: id, name: 'X' })).status).toBe(401)
      expect((await call('update-driver', { driver_id: '11111111-1111-1111-1111-111111111111', name: 'X' }, adminToken)).status).toBe(404)
      expect((await call('update-driver', { driver_id: '00000000-0000-0000-0000-00000000ad01', name: 'X' }, adminToken)).status).toBe(404)

      // validações
      const bad = async (b: Record<string, unknown>) =>
        (await call('update-driver', { driver_id: id, ...b }, adminToken)).json.error
      expect(await bad({ name: '  ' })).toBe('INVALID_NAME')
      expect(await bad({ phone: '1' })).toBe('INVALID_PHONE')
      expect(await bad({ cpf: '123' })).toBe('INVALID_CPF')
      expect(await bad({ cpf: '52998224725' })).toBe('CPF_TAKEN')
      expect(await bad({ driver_type: 'x' })).toBe('INVALID_DRIVER_TYPE')
      expect(await bad({ transfer_pct: 0 })).toBe('INVALID_PCT')
      expect(await bad({ uber_pct: null })).toBe('INVALID_PCT')
      expect(await bad({ driver_type: 'own_car', uber_pct: 30 })).toBe('INVALID_PCT')
      expect(await bad({ car_id: carOwn })).toBe('INVALID_CAR')
      expect(await bad({ car_id: '00000000-0000-0000-0000-00000000c001' })).toBe('INVALID_CAR') // ocupado
      expect((await row()).name).toBe('João Silva')

      // parcial: só muda o que veio
      const cpf = genCpf()
      const up = await call('update-driver', { driver_id: id, name: ' Novo Nome ', cpf, uber_pct: 55 }, adminToken)
      expect(up.status).toBe(200)
      let r = await row()
      expect(r.name).toBe('Novo Nome')
      expect(r.cpf).toBe(cpf)
      expect(Number(r.uber_pct)).toBe(55)
      expect(Number(r.transfer_pct)).toBe(30)
      expect(r.phone).toBe('11912345678')
      // o mesmo CPF do próprio motorista não conflita
      expect((await call('update-driver', { driver_id: id, cpf }, adminToken)).status).toBe(200)

      // troca de carro: libera o antigo, ocupa o novo
      const oldCar = r.current_car_id as string
      expect((await call('update-driver', { driver_id: id, car_id: carA }, adminToken)).status).toBe(200)
      expect(await carRow(oldCar)).toBeNull()
      expect(await carRow(carA)).toBe(id)
      expect((await row()).current_car_id).toBe(carA)

      // company -> own: limpa uber_pct e desvincula o carro incompatível
      expect((await call('update-driver', { driver_id: id, driver_type: 'own_car', transfer_pct: 25 }, adminToken)).status).toBe(200)
      r = await row()
      expect(r.driver_type).toBe('own_car')
      expect(r.uber_pct).toBeNull()
      expect(Number(r.transfer_pct)).toBe(25)
      expect(r.current_car_id).toBeNull()
      expect(await carRow(carA)).toBeNull()

      // own -> company exige uber_pct
      expect(await bad({ driver_type: 'company_car' })).toBe('INVALID_PCT')
      // vincula carro próprio e desvincula com null
      expect((await call('update-driver', { driver_id: id, car_id: carOwn }, adminToken)).status).toBe(200)
      expect(await carRow(carOwn)).toBe(id)
      expect((await call('update-driver', { driver_id: id, car_id: null }, adminToken)).status).toBe(200)
      expect(await carRow(carOwn)).toBeNull()
      expect((await row()).current_car_id).toBeNull()

      // own com carro próprio -> company: desvincula o carro incompatível
      expect((await call('update-driver', { driver_id: id, car_id: carOwn }, adminToken)).status).toBe(200)
      expect((await call('update-driver', { driver_id: id, driver_type: 'company_car', uber_pct: 35 }, adminToken)).status).toBe(200)
      r = await row()
      expect(r.driver_type).toBe('company_car')
      expect(Number(r.uber_pct)).toBe(35)
      expect(r.current_car_id).toBeNull()
      expect(await carRow(carOwn)).toBeNull()
    })

    it('estimate-route: só admin e nunca lança', async () => {
      expect((await call('estimate-route', {}, driverToken)).status).toBe(403)
      expect((await call('estimate-route', {})).status).toBe(401)
      const r = await call('estimate-route', { origin: {}, destination: {} }, adminToken)
      expect(r.status).toBe(200)
      expect(r.json.km).toBeNull()
      expect(r.json.reason).toBe('NOT_FOUND')
    })

    it('propriedade incompatível com driver_type -> INVALID_CAR', async () => {
      const carId = await newCar('company')
      const r = await create({ name: 'João Silva', phone: '11912345678', driver_type: 'own_car', transfer_pct: 30, car_id: carId })
      expect(r.status).toBe(400)
      expect(r.json.error).toBe('INVALID_CAR')
    })
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
