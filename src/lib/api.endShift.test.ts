import { describe, it, expect, vi } from 'vitest'

const rpc = vi.fn(async (..._a: unknown[]) => ({ data: {}, error: null, status: 200 }))
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
import { endShift } from './api'

describe('endShift', () => {
  it('sempre envia p_uber_photo (null sem print)', async () => {
    await endShift({ shift_id: 's', odometer: 10, photo: 'p' })
    const args = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(rpc.mock.calls[0][0]).toBe('end_shift')
    expect('p_uber_photo' in args).toBe(true)
    expect(args.p_uber_photo).toBeNull()
  })
})
