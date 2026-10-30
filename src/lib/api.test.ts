import { describe, it, expect, vi } from 'vitest'

let result: { error: { message: string; code?: string }; status: number }
vi.mock('./supabase', () => ({
  supabase: {
    rpc: async () => result,
    from: () => ({ upsert: async () => result }),
  },
}))
import { completeTransfer, insertRide } from './api'

async function caught(): Promise<unknown> {
  try {
    await completeTransfer({ ride_id: 'r', km: 1 })
  } catch (e) {
    return e
  }
}

describe('classificação de erros em api.ts', () => {
  it.each([
    [{ message: 'TypeError: Load failed', code: '' }, 0],
    [{ message: '<html>Bad Gateway</html>', code: '' }, 502],
    [{ message: 'JWT expired', code: 'PGRST301' }, 401],
    [{ message: 'JWT expired', code: 'PGRST303' }, 400],
  ])('%j status %i é transitório', async (error, status) => {
    result = { error, status }
    expect(await caught()).toBeInstanceOf(TypeError)
  })

  it('PERIOD_CLOSED é permanente e carrega o código', async () => {
    result = { error: { message: 'PERIOD_CLOSED', code: 'P0001' }, status: 400 }
    const e = (await caught()) as Error & { code: string }
    expect(e).not.toBeInstanceOf(TypeError)
    expect(e.code).toBe('P0001')
    expect(e.message).toBe('PERIOD_CLOSED')
  })

  it('inserts também classificam', async () => {
    result = { error: { message: 'x', code: '' }, status: 503 }
    await expect(insertRide({} as never)).rejects.toBeInstanceOf(TypeError)
  })
})
