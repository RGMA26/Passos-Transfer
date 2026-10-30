import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatementTab from './StatementTab'
import { makeProfile } from './testUtils'
import * as api from '../lib/api'

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile: makeProfile() }),
}))
vi.mock('../lib/api', () => ({
  getCurrentPeriodId: vi.fn(),
  computeStatement: vi.fn(),
  listMyStatements: vi.fn(),
  listRejectedItems: vi.fn(),
  getPeriod: vi.fn(),
}))
const mApi = vi.mocked(api)
const lines = {
  uber_share: 100, transfer_share: 0, fuel_reimbursement: 0, transfer_fuel_reimbursement: 0,
  expense_reimbursement: 0, off_duty_fuel_discount: 0, adjustments: 0, total: 100,
  avg_fuel_price: null, missing_reference_price: false,
  km: { total: 1, service: 1, off: 0 }, pending: { fuelings: 0, expenses: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mApi.getCurrentPeriodId.mockResolvedValue('p2')
  mApi.getPeriod.mockResolvedValue({ start_date: '2026-10-16', end_date: '2026-10-31' } as never)
  mApi.computeStatement.mockResolvedValue(lines)
  mApi.listRejectedItems.mockResolvedValue([])
  mApi.listMyStatements.mockResolvedValue([
    { id: 's1', period_id: 'p1', lines: { ...lines, total: 77 }, total: 77, paid_at: null,
      payment_method: null, start_date: '2026-10-01', end_date: '2026-10-15' },
  ])
})

describe('StatementTab', () => {
  it('mostra quinzena atual e anteriores expansíveis', async () => {
    render(<StatementTab />)
    expect(await screen.findByText(/Quinzena atual/)).toBeInTheDocument()
    expect(screen.getByText(/16\/10 – 31\/10/)).toBeInTheDocument()
    expect(screen.getByText('Quinzenas anteriores')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /01\/10 – 15\/10/ }))
    expect(await screen.findByText('Fechado')).toBeInTheDocument()
  })

  it('erro mostra retry', async () => {
    mApi.getCurrentPeriodId.mockRejectedValueOnce(new Error('x'))
    render(<StatementTab />)
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText(/Quinzena atual/)).toBeInTheDocument()
  })
})
