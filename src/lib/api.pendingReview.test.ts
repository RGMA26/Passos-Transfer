import { describe, it, expect, vi } from 'vitest'

// Mock por tabela: a consulta de corridas do turno usa .in('shift_id', …); a de Transfers
// concluídos usa .eq('platform', 'transfer').
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const used: string[] = []
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'not', 'order']) {
        b[m] = (...args: unknown[]) => (used.push(`${m}:${String(args[0])}`), b)
      }
      const data = () => {
        if (table === 'fuelings') return []
        if (table === 'profiles') return [{ id: 'd1', name: 'Ana' }]
        if (table === 'shifts')
          return [
            {
              id: 's1', driver_id: 'd1', start_date: '2026-11-02', odometer_start: 100, odometer_end: 200,
              odometer_start_photo: 'a.jpg', odometer_end_photo: 'b.jpg', uber_earnings_photo: null,
              review_status: 'pending', reject_reason: null,
            },
          ]
        if (used.includes('in:shift_id'))
          return [
            { id: 'r1', shift_id: 's1', platform: 'uber', amount: 30, km: 12.5, transfer_status: null,
              ride_date: '2026-11-02', receipt_path: 'd1/r1.jpg', created_at: '1' },
            { id: 'r2', shift_id: 's1', platform: 'blablacar', amount: 50, km: null, transfer_status: null,
              ride_date: '2026-11-02', receipt_path: 'd1/r2.pdf', created_at: '2' },
            { id: 'r3', shift_id: 's1', platform: 'transfer', amount: 90, km: 20, transfer_status: 'in_progress',
              ride_date: '2026-11-02', receipt_path: null, created_at: '3' },
          ]
        return []
      }
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(res)
      return b
    },
  },
}))
import { listPendingReview } from './api'

describe('listPendingReview — corridas do turno', () => {
  it('lista as corridas do turno com o comprovante (Transfer ainda em andamento fica de fora)', async () => {
    const q = await listPendingReview()
    expect(q.shifts[0].rides).toEqual([
      { id: 'r1', platform: 'uber', ride_date: '2026-11-02', amount: 30, km: 12.5, receipt_path: 'd1/r1.jpg' },
      { id: 'r2', platform: 'blablacar', ride_date: '2026-11-02', amount: 50, km: null, receipt_path: 'd1/r2.pdf' },
    ])
    expect(q.shifts[0].totals.uber).toEqual({ amount: 30, km: 12.5 })
  })
})
