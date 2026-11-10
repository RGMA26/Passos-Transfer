import { describe, it, expect } from 'vitest'
import { deriveShift } from './useShift'
import { failedStartShift } from './shiftOps'
import type { QueuedOp } from '../lib/offline/queue'

const op = (over: Partial<QueuedOp>): QueuedOp => ({
  id: 'o1',
  kind: 'start_shift',
  ownerId: 'u1',
  payload: { id: 's1', car_id: 'c1', odometer: 100 },
  photos: [],
  status: 'pending',
  createdAt: 1_000_000,
  ...over,
})
const server = { id: 'sv', odometer_start: 50, started_at: '2026-11-10T10:00:00Z', ended_at: null } as never

describe('deriveShift', () => {
  it('start_shift pendente conta como turno aberto', () => {
    expect(deriveShift(null, [op({})])).toMatchObject({ id: 's1', odometerStart: 100 })
  })
  it('start_shift failed NÃO conta como turno aberto', () => {
    expect(deriveShift(null, [op({ status: 'failed', error: 'x' })])).toBeNull()
  })
  it('end_shift pendente esconde o turno aberto', () => {
    expect(deriveShift(server, [op({ kind: 'end_shift', payload: { shift_id: 'sv', odometer: 9 } })])).toBeNull()
  })
  it('end_shift failed não faz o turno parecer encerrado', () => {
    const e = op({ kind: 'end_shift', status: 'failed', payload: { shift_id: 'sv', odometer: 9 } })
    expect(deriveShift(server, [e])).toMatchObject({ id: 'sv' })
  })
})

describe('failedStartShift', () => {
  it('devolve o start_shift failed mais recente', () => {
    const a = op({ id: 'a', status: 'failed', createdAt: 1 })
    const b = op({ id: 'b', status: 'failed', createdAt: 2 })
    expect(failedStartShift([a, b])?.id).toBe('b')
  })
  it('null sem falha', () => {
    expect(failedStartShift([op({})])).toBeNull()
  })
})
