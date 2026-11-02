import { describe, it, expect, vi } from 'vitest'

const data: Record<string, unknown[]> = {
  fuelings: [{ fueled_on: '2026-10-03', amount: 80, reject_reason: 'Ilegível' }],
  rides: [],
  shifts: [{ start_date: '2026-10-05', reject_reason: 'Km errado' }],
}
const filters: Record<string, unknown[][]> = {}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      filters[table] = []
      const chain: Record<string, unknown> = {}
      for (const fn of ['select', 'eq', 'not', 'gte', 'lte']) {
        chain[fn] = (...args: unknown[]) => {
          filters[table].push([fn, ...args])
          return chain
        }
      }
      chain.then = (res: (v: unknown) => void) => res({ data: data[table], error: null })
      return chain
    },
  },
}))
import { listRejectedItems } from './api'

describe('listRejectedItems', () => {
  it('inclui turnos recusados do período', async () => {
    const out = await listRejectedItems('d1', '2026-10-01', '2026-10-15')
    expect(out).toContainEqual({ kind: 'Turno', date: '2026-10-05', amount: null, reason: 'Km errado' })
    expect(out).toContainEqual({ kind: 'Abastecimento', date: '2026-10-03', amount: 80, reason: 'Ilegível' })
    expect(filters.shifts).toContainEqual(['eq', 'review_status', 'rejected'])
    expect(filters.shifts).toContainEqual(['eq', 'driver_id', 'd1'])
    expect(filters.shifts).toContainEqual(['gte', 'start_date', '2026-10-01'])
  })
})
