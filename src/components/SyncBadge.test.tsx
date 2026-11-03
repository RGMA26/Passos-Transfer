import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SyncBadge, { opLabel } from './SyncBadge'
import { discardOp, listOps } from '../lib/offline/queue'
import type { QueuedOp } from '../lib/offline/queue'

vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }))
vi.mock('../lib/offline/queue', () => ({
  listOps: vi.fn(),
  onQueueChange: vi.fn(() => () => {}),
  retryOp: vi.fn(),
  discardOp: vi.fn(async () => {}),
}))

const failed = (over: Partial<QueuedOp> = {}): QueuedOp => ({
  id: 'o1',
  kind: 'insert_fueling',
  ownerId: 'u1',
  payload: { id: 'f1', amount: 200, liters: 40, fueled_on: '2026-10-30' },
  photos: [],
  status: 'failed',
  error: 'Não enviado: quinzena fechada',
  createdAt: Date.parse('2026-10-30T12:00:00Z') * 1000,
  ...over,
})

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

describe('SyncBadge: Descartar', () => {
  it('pede confirmação nomeando o item e descarta', async () => {
    vi.mocked(listOps).mockResolvedValue([failed()])
    render(<SyncBadge />)
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^Descartar Abastecimento R\$\s200,00 de 30\/10\? Ele não será enviado\.$/),
    )
    expect(discardOp).toHaveBeenCalledWith('o1')
  })

  it('cancelar a confirmação mantém o item', async () => {
    confirmSpy.mockReturnValue(false)
    vi.mocked(listOps).mockResolvedValue([failed()])
    render(<SyncBadge />)
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(discardOp).not.toHaveBeenCalled()
  })
})

describe('opLabel', () => {
  it.each([
    [{ kind: 'insert_ride', payload: { platform: 'uber', amount: 50, ride_date: '2026-10-29' } }, /^Uber R\$\s50,00 de 29\/10$/],
    [{ kind: 'insert_expense', payload: { kind: 'toll', amount: 15 } }, /^Pedágio R\$\s15,00 de 30\/10$/],
    [{ kind: 'start_shift', payload: { odometer: 1000 } }, /^Início de turno \(odômetro 1000\) de 30\/10$/],
    [{ kind: 'end_shift', payload: { odometer: 1100 } }, /^Encerramento de turno \(odômetro 1100\) de 30\/10$/],
    [{ kind: 'complete_transfer', payload: { ride_id: 'r', odometer: 5042 } }, /^Conclusão de Transfer \(odômetro 5042\) de 30\/10$/],
    [{ kind: 'start_transfer', payload: { ride_id: 'r', odometer: 5000 } }, /^Início de Transfer \(odômetro 5000\) de 30\/10$/],
    [{ kind: 'attach_photo', payload: { target: 'shift_start', id: 's' } }, /^Foto do odômetro \(início do turno\) de 30\/10$/],
    [{ kind: 'attach_photo', payload: { target: 'shift_uber', id: 's' } }, /^Print da Uber do turno de 30\/10$/],
    [{ kind: 'attach_photo', payload: { target: 'transfer_end', id: 'r' } }, /^Foto do odômetro \(fim do Transfer\) de 30\/10$/],
  ] as const)('%j', (over, re) => {
    expect(opLabel(failed(over as Partial<QueuedOp>))).toMatch(re)
  })
})
