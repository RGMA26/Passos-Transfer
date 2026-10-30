import { describe, it, expect, vi, beforeEach } from 'vitest'

type Op = { table: string; op: string; values?: unknown; filters: [string, unknown][] }
let ops: Op[]
let handler: (o: Op) => { data?: unknown; error?: { message: string; code?: string } | null }
let invoke: ReturnType<typeof vi.fn<(...a: unknown[]) => unknown>>

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (table: string) => {
      const o: Op = { table, op: 'select', filters: [] }
      const b: Record<string, unknown> = {}
      const chain = () => b
      for (const m of ['select', 'order']) b[m] = chain
      for (const m of ['insert', 'update']) {
        b[m] = (v: unknown) => {
          o.op = m
          o.values = v
          return b
        }
      }
      b.eq = (k: string, v: unknown) => {
        o.filters.push([k, v])
        return b
      }
      b.single = chain
      b.then = (res: (v: unknown) => unknown) => {
        ops.push(o)
        const r = handler(o)
        return Promise.resolve({ data: null, error: null, ...r }).then(res)
      }
      return b
    },
  },
}))
import { assignCar, createCar, createDriver, driverAccess } from './api'

beforeEach(() => {
  ops = []
  invoke = vi.fn()
})

const base = { name: 'A', phone: '1', driver_type: 'own_car' as const, transfer_pct: 10 }

describe('createDriver / driverAccess', () => {
  it('devolve código e PIN', async () => {
    invoke.mockResolvedValue({ data: { driver_id: 'd', login_code: 'PASSOS01', temp_pin: '123456' }, error: null })
    expect(await createDriver(base)).toMatchObject({ login_code: 'PASSOS01' })
  })

  it('mapeia o código do corpo do erro HTTP', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ error: 'INVALID_CAR' }) } },
    })
    await expect(createDriver(base)).rejects.toMatchObject({ code: 'INVALID_CAR' })
  })

  it('corpo ilegível vira CREATE_FAILED', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })
    await expect(createDriver(base)).rejects.toMatchObject({ code: 'CREATE_FAILED' })
  })

  it('driverAccess envia ação e devolve PIN', async () => {
    invoke.mockResolvedValue({ data: { temp_pin: '654321' }, error: null })
    expect(await driverAccess('d1', 'reset_password')).toEqual({ temp_pin: '654321' })
    expect(invoke).toHaveBeenCalledWith('driver-access', { body: { driver_id: 'd1', action: 'reset_password' } })
  })
})

describe('createCar', () => {
  it('23505 vira PLATE_TAKEN', async () => {
    handler = () => ({ error: { message: 'dup', code: '23505' } })
    await expect(
      createCar({ model: 'X', plate: 'AAA1A11', consumption_km_l: 10, ownership: 'own' }),
    ).rejects.toMatchObject({ code: 'PLATE_TAKEN' })
  })
})

describe('assignCar', () => {
  const car = { id: 'c1', ownership: 'company', current_driver_id: 'old' }
  it('recusa tipo incompatível sem escrever nada', async () => {
    handler = (o) =>
      o.table === 'cars'
        ? { data: car }
        : { data: { id: 'd2', driver_type: 'own_car', current_car_id: null } }
    await expect(assignCar('c1', 'd2')).rejects.toMatchObject({ code: 'TYPE_MISMATCH' })
    expect(ops.some((o) => o.op === 'update')).toBe(false)
  })

  it('mantém os dois lados coerentes', async () => {
    handler = (o) =>
      o.op !== 'select'
        ? {}
        : o.table === 'cars'
          ? { data: car }
          : { data: { id: 'd2', driver_type: 'company_car', current_car_id: 'c0' } }
    await assignCar('c1', 'd2')
    const upd = ops.filter((o) => o.op === 'update').map((o) => [o.table, o.values, o.filters])
    expect(upd).toEqual([
      ['profiles', { current_car_id: null }, [['id', 'old']]],
      ['cars', { current_driver_id: null }, [['id', 'c0']]],
      ['cars', { current_driver_id: 'd2' }, [['id', 'c1']]],
      ['profiles', { current_car_id: 'c1' }, [['id', 'd2']]],
    ])
  })

  it('desvincular limpa só o motorista anterior', async () => {
    handler = (o) => (o.op !== 'select' ? {} : { data: car })
    await assignCar('c1', null)
    expect(ops.filter((o) => o.op === 'update').map((o) => [o.table, o.values])).toEqual([
      ['profiles', { current_car_id: null }],
      ['cars', { current_driver_id: null }],
    ])
  })
})
