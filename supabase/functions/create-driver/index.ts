import { corsHeaders, json, randomPin, readBody, requireAdmin } from '../_shared/admin.ts'
import { normalizeCpf, pctOk } from '../_shared/validate.ts'

/** Id do usuário de login com este e-mail (a API admin não busca por e-mail: percorre as páginas). */
// deno-lint-ignore no-explicit-any
async function findAuthUserId(admin: any, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) return null
    const u = data.users.find((x: { email?: string }) => x.email?.toLowerCase() === email)
    if (u) return u.id
    if (data.users.length < 200) return null
  }
  return null
}

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

    const cpf = normalizeCpf(body.cpf)
    if (!cpf) return json({ error: 'INVALID_CPF' }, 400)
    {
      const { data: dup, error: dupErr } = await admin.from('profiles').select('id').eq('cpf', cpf).maybeSingle()
      if (dupErr) return json({ error: 'CREATE_FAILED' }, 500)
      if (dup) return json({ error: 'CPF_TAKEN' }, 400)
    }

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

    // O número do código é o menor livre (números de motoristas excluídos voltam). Dois cadastros
    // ao mesmo tempo podem receber o mesmo número: o segundo colide no seq_number e tenta de novo.
    const pin = randomPin()
    let code = ''
    let userId = ''
    let orphanCleaned = false
    for (let attempt = 0; ; attempt++) {
      if (attempt >= 3) return json({ error: 'CREATE_FAILED' }, 500)
      const { data: gen, error: codeErr } = await admin.rpc('generate_login_code', { p_name: name })
      if (codeErr || typeof gen !== 'string') {
        const invalid = codeErr?.message?.includes('INVALID_NAME')
        return invalid ? json({ error: 'INVALID_NAME' }, 400) : json({ error: 'CREATE_FAILED' }, 500)
      }
      code = gen
      const seq = Number(/^PASSOS(\d+)/.exec(code)?.[1])

      const { data: created, error: userErr } = await admin.auth.admin.createUser({
        email: `${code.toLowerCase()}@login.passostransfer.app`,
        password: pin,
        email_confirm: true,
      })
      if (userErr || !created.user) {
        if (!/already|registered|exists/i.test(userErr?.message ?? '')) return json({ error: 'CREATE_FAILED' }, 500)
        // mesmo e-mail: se é login órfão (sem perfil, ex.: cadastro antigo que falhou no meio),
        // apaga e tenta de novo uma vez; se tem perfil, é um cadastro concorrente: outro número
        if (!orphanCleaned) {
          const email = `${code.toLowerCase()}@login.passostransfer.app`
          const orphanId = await findAuthUserId(admin, email)
          if (orphanId) {
            const { data: prof } = await admin.from('profiles').select('id').eq('id', orphanId).maybeSingle()
            if (!prof) {
              orphanCleaned = true
              const { error: delErr } = await admin.auth.admin.deleteUser(orphanId)
              if (delErr) return json({ error: 'CREATE_FAILED' }, 500)
            }
          }
        }
        continue
      }
      userId = created.user.id

      const { error: profErr } = await admin.from('profiles').insert({
        id: userId,
        role: 'driver',
        login_code: code,
        seq_number: seq,
        name,
        phone,
        cpf,
        driver_type: driverType,
        uber_pct: driverType === 'company_car' ? body.uber_pct : null,
        transfer_pct: body.transfer_pct,
        must_change_password: true,
      })
      if (!profErr) break
      await admin.auth.admin.deleteUser(userId)
      const detail = `${profErr.message} ${profErr.details ?? ''}`
      if (profErr.code === '23505' && /cpf/i.test(detail)) return json({ error: 'CPF_TAKEN' }, 400)
      if (profErr.code === '23505' && /seq_number|login_code/i.test(detail)) continue
      return json({ error: 'CREATE_FAILED' }, 500)
    }

    const rollback = async () => {
      await admin.auth.admin.deleteUser(userId)
      return json({ error: 'CREATE_FAILED' }, 500)
    }

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
