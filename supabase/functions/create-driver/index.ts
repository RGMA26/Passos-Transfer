import { corsHeaders, json, randomPin, readBody, requireAdmin } from '../_shared/admin.ts'

const pctOk = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return auth.response
    const admin = auth.admin

    const body = (await readBody(req)) ?? {}
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return json({ error: 'INVALID_NAME' }, 400)

    const phone = typeof body.phone === 'string' || typeof body.phone === 'number'
      ? String(body.phone).replace(/\D/g, '')
      : ''
    if (phone.length < 10 || phone.length > 11) return json({ error: 'INVALID_PHONE' }, 400)

    const driverType = body.driver_type
    if (driverType !== 'own_car' && driverType !== 'company_car') {
      return json({ error: 'INVALID_DRIVER_TYPE' }, 400)
    }

    if (!pctOk(body.transfer_pct)) return json({ error: 'INVALID_PCT' }, 400)
    const hasUber = body.uber_pct !== undefined && body.uber_pct !== null
    if (driverType === 'company_car' ? !pctOk(body.uber_pct) : hasUber) {
      return json({ error: 'INVALID_PCT' }, 400)
    }

    const carId = body.car_id === undefined || body.car_id === null ? null : body.car_id
    if (carId !== null) {
      if (typeof carId !== 'string') return json({ error: 'INVALID_CAR' }, 400)
      const { data: car, error } = await admin
        .from('cars').select('id, ownership, current_driver_id').eq('id', carId).maybeSingle()
      const expected = driverType === 'own_car' ? 'own' : 'company'
      if (error || !car || car.ownership !== expected || car.current_driver_id !== null) {
        return json({ error: 'INVALID_CAR' }, 400)
      }
    }

    const { data: code, error: codeErr } = await admin.rpc('generate_login_code', { p_name: name })
    if (codeErr || typeof code !== 'string') {
      const invalid = codeErr?.message?.includes('INVALID_NAME')
      return invalid ? json({ error: 'INVALID_NAME' }, 400) : json({ error: 'CREATE_FAILED' }, 500)
    }
    const seq = Number(/^PASSOS(\d+)/.exec(code)?.[1])
    const pin = randomPin()

    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email: `${code.toLowerCase()}@login.passostransfer.app`,
      password: pin,
      email_confirm: true,
    })
    if (userErr || !created.user) return json({ error: 'CREATE_FAILED' }, 500)
    const userId = created.user.id

    const rollback = async () => {
      await admin.auth.admin.deleteUser(userId)
      return json({ error: 'CREATE_FAILED' }, 500)
    }

    const { error: profErr } = await admin.from('profiles').insert({
      id: userId,
      role: 'driver',
      login_code: code,
      seq_number: seq,
      name,
      phone,
      driver_type: driverType,
      uber_pct: driverType === 'company_car' ? body.uber_pct : null,
      transfer_pct: body.transfer_pct,
      must_change_password: true,
    })
    if (profErr) return await rollback()

    if (carId !== null) {
      const { error: e1 } = await admin.from('profiles').update({ current_car_id: carId }).eq('id', userId)
      if (e1) return await rollback()
      const { data: linked, error: e2 } = await admin.from('cars')
        .update({ current_driver_id: userId })
        .eq('id', carId)
        .is('current_driver_id', null)
        .select('id')
      if (e2 || !linked || linked.length !== 1) return await rollback()
    }

    return json({ driver_id: userId, login_code: code, temp_pin: pin })
  } catch (_e) {
    return json({ error: 'CREATE_FAILED' }, 500)
  }
})
