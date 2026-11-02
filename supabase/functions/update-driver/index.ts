import { corsHeaders, json, readBody, requireAdmin } from '../_shared/admin.ts'
import { normalizeCpf, normalizePhone, pctOk } from '../_shared/validate.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const has = (b: Record<string, unknown>, k: string) => b[k] !== undefined

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return auth.response
    const admin = auth.admin

    const body = (await readBody(req)) ?? {}
    const driverId = body.driver_id
    if (typeof driverId !== 'string' || !UUID.test(driverId)) return json({ error: 'NOT_FOUND' }, 404)

    const { data: cur, error: curErr } = await admin
      .from('profiles')
      .select('id, role, driver_type, uber_pct, transfer_pct, current_car_id')
      .eq('id', driverId)
      .maybeSingle()
    if (curErr) return json({ error: 'UPDATE_FAILED' }, 500)
    if (!cur || cur.role !== 'driver') return json({ error: 'NOT_FOUND' }, 404)

    const patch: Record<string, unknown> = {}

    if (has(body, 'name')) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return json({ error: 'INVALID_NAME' }, 400)
      patch.name = name
    }
    if (has(body, 'phone')) {
      const phone = normalizePhone(body.phone)
      if (!phone) return json({ error: 'INVALID_PHONE' }, 400)
      patch.phone = phone
    }
    if (has(body, 'cpf')) {
      const cpf = normalizeCpf(body.cpf)
      if (!cpf) return json({ error: 'INVALID_CPF' }, 400)
      const { data: dup, error: dupErr } = await admin
        .from('profiles').select('id').eq('cpf', cpf).neq('id', driverId).maybeSingle()
      if (dupErr) return json({ error: 'UPDATE_FAILED' }, 500)
      if (dup) return json({ error: 'CPF_TAKEN' }, 400)
      patch.cpf = cpf
    }

    // Tipo e porcentagens
    let type: string = cur.driver_type
    if (has(body, 'driver_type')) {
      if (body.driver_type !== 'own_car' && body.driver_type !== 'company_car') {
        return json({ error: 'INVALID_DRIVER_TYPE' }, 400)
      }
      type = body.driver_type
    }
    const typeChanged = type !== cur.driver_type
    if (has(body, 'transfer_pct')) {
      if (!pctOk(body.transfer_pct)) return json({ error: 'INVALID_PCT' }, 400)
      patch.transfer_pct = body.transfer_pct
    }
    const uberGiven = body.uber_pct !== undefined && body.uber_pct !== null
    if (type === 'company_car') {
      if (typeChanged || has(body, 'uber_pct')) {
        if (!pctOk(body.uber_pct)) return json({ error: 'INVALID_PCT' }, 400)
        patch.uber_pct = body.uber_pct
      }
    } else {
      if (uberGiven) return json({ error: 'INVALID_PCT' }, 400)
      if (typeChanged || has(body, 'uber_pct')) patch.uber_pct = null
    }
    if (typeChanged) patch.driver_type = type

    // Carro: só mexe se car_id veio ou se o tipo mudou e o carro atual ficou incompatível
    const expected = type === 'own_car' ? 'own' : 'company'
    let newCarId: string | null = cur.current_car_id
    let claim: string | null = null // carro novo a reservar
    if (has(body, 'car_id')) {
      if (body.car_id === null) {
        newCarId = null
      } else {
        if (typeof body.car_id !== 'string' || !UUID.test(body.car_id)) return json({ error: 'INVALID_CAR' }, 400)
        const { data: car, error } = await admin
          .from('cars').select('id, ownership, current_driver_id').eq('id', body.car_id).maybeSingle()
        if (error || !car || car.ownership !== expected ||
            (car.current_driver_id !== null && car.current_driver_id !== driverId)) {
          return json({ error: 'INVALID_CAR' }, 400)
        }
        newCarId = car.id
        if (car.current_driver_id !== driverId) claim = car.id
      }
    } else if (typeChanged && cur.current_car_id) {
      const { data: car } = await admin.from('cars').select('ownership').eq('id', cur.current_car_id).maybeSingle()
      if (!car || car.ownership !== expected) newCarId = null
    }
    if (newCarId !== cur.current_car_id) patch.current_car_id = newCarId

    if (claim) {
      const { data: got, error } = await admin.from('cars')
        .update({ current_driver_id: driverId }).eq('id', claim).is('current_driver_id', null).select('id')
      if (error || !got || got.length !== 1) return json({ error: 'INVALID_CAR' }, 400)
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await admin.from('profiles').update(patch).eq('id', driverId)
      if (error) {
        if (claim) await admin.from('cars').update({ current_driver_id: null }).eq('id', claim).eq('current_driver_id', driverId)
        if (error.code === '23505' && /cpf/i.test(`${error.message} ${error.details ?? ''}`)) {
          return json({ error: 'CPF_TAKEN' }, 400)
        }
        return json({ error: 'UPDATE_FAILED' }, 500)
      }
    }

    // Solta o carro antigo, se o motorista deixou de usá-lo
    if (cur.current_car_id && cur.current_car_id !== newCarId) {
      const { error } = await admin.from('cars')
        .update({ current_driver_id: null }).eq('id', cur.current_car_id).eq('current_driver_id', driverId)
      if (error) return json({ error: 'UPDATE_FAILED' }, 500)
    }

    return json({})
  } catch (_e) {
    return json({ error: 'UPDATE_FAILED' }, 500)
  }
})
