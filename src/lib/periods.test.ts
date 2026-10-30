import { describe, expect, it } from 'vitest'
import { localDate, periodBounds } from './periods'

describe('periodBounds', () => {
  it('computes fortnight', () => {
    expect(periodBounds('2026-11-15')).toEqual({ start: '2026-11-01', end: '2026-11-15' })
    expect(periodBounds('2026-11-16')).toEqual({ start: '2026-11-16', end: '2026-11-30' })
    expect(periodBounds('2027-02-20')).toEqual({ start: '2027-02-16', end: '2027-02-28' })
  })
})

describe('localDate', () => {
  it('uses Sao Paulo timezone', () => {
    expect(localDate(new Date('2026-11-16T02:30:00Z'))).toBe('2026-11-15')
  })
})
