import { corsHeaders, json, randomPin, readBody, requireAdmin } from '../_shared/admin.ts'

const ACTIONS = ['reset_password', 'deactivate', 'reactivate']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return auth.response
    const admin = auth.admin

    const body = (await readBody(req)) ?? {}
    const action = body.action
    if (typeof action !== 'string' || !ACTIONS.includes(action)) {
      return json({ error: 'INVALID_ACTION' }, 400)
    }
    const id = body.driver_id
    if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'NOT_FOUND' }, 404)

    const { data: target } = await admin
      .from('profiles').select('id, role').eq('id', id).maybeSingle()
    if (!target || target.role !== 'driver') return json({ error: 'NOT_FOUND' }, 404)

    if (action === 'reset_password') {
      const pin = randomPin()
      const { error } = await admin.auth.admin.updateUserById(id, { password: pin })
      if (error) return json({ error: 'ACCESS_FAILED' }, 500)
      const { error: pErr } = await admin.from('profiles').update({ must_change_password: true }).eq('id', id)
      if (pErr) return json({ error: 'ACCESS_FAILED' }, 500)
      return json({ temp_pin: pin })
    }

    const deactivate = action === 'deactivate'
    const { error: pErr } = await admin.from('profiles').update({ active: !deactivate }).eq('id', id)
    if (pErr) return json({ error: 'ACCESS_FAILED' }, 500)
    const { error } = await admin.auth.admin.updateUserById(id, {
      ban_duration: deactivate ? '876000h' : 'none',
    })
    if (error) return json({ error: 'ACCESS_FAILED' }, 500)
    return json({})
  } catch (_e) {
    return json({ error: 'ACCESS_FAILED' }, 500)
  }
})
