import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StatementTab from './StatementTab'
import { makeProfile } from './testUtils'
import * as api from '../lib/api'

let profile = makeProfile()
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile }),
}))
vi.mock('../lib/api', () => ({
  getCurrentPeriod: vi.fn(),
  computeStatement: vi.fn(),
  listMyStatements: vi.fn(),
  listRejectedItems: vi.fn(),
}))
vi.mock('../lib/periods', () => ({ localDate: () => '2026-11-20' }))
const mApi = vi.mocked(api)
const lines = {
  uber_share: 100, transfer_share: 0, fuel_reimbursement: 0, transfer_fuel_reimbursement: 0,
  expense_reimbursement: 0, off_duty_fuel_discount: 0, adjustments: 0, total: 100,
  cost_per_km: null, missing_fuel_price: false, missing_consumption: false,
  km: { total: 1, service: 1, off: 0 }, pending: { fuelings: 0, expenses: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  profile = makeProfile()
  mApi.getCurrentPeriod.mockResolvedValue({
    id: 'p2', start_date: '2026-11-10', end_date: '2026-11-24', status: 'open',
  })
  mApi.computeStatement.mockResolvedValue(lines)
  mApi.listRejectedItems.mockResolvedValue([])
  mApi.listMyStatements.mockResolvedValue([
    { id: 's1', driver_period_id: 'p1', lines: { ...lines, total: 77 }, total: 77, paid_at: null,
      payment_method: null, start_date: '2026-10-26', end_date: '2026-11-09' },
  ])
})

describe('StatementTab', () => {
  it('mostra a quinzena do motorista com dias restantes e as anteriores expansíveis', async () => {
    render(<StatementTab />)
    expect(await screen.findByText('Quinzena 10/11 – 24/11 · faltam 4 dias')).toBeInTheDocument()
    expect(mApi.getCurrentPeriod).toHaveBeenCalledWith('u1', '2026-11-20')
    expect(mApi.computeStatement).toHaveBeenCalledWith('u1', 'p2')
    expect(mApi.listRejectedItems).toHaveBeenCalledWith('u1', '2026-11-10', '2026-11-24')
    expect(screen.getByText('Quinzenas anteriores')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /26\/10 – 09\/11/ }))
    expect(await screen.findByText('Fechado')).toBeInTheDocument()
  })

  it('último dia e 1 dia', async () => {
    mApi.getCurrentPeriod.mockResolvedValueOnce({
      id: 'p2', start_date: '2026-11-06', end_date: '2026-11-20', status: 'open',
    })
    const { unmount } = render(<StatementTab />)
    expect(await screen.findByText('Quinzena 06/11 – 20/11 · último dia')).toBeInTheDocument()
    unmount()
    mApi.getCurrentPeriod.mockResolvedValueOnce({
      id: 'p2', start_date: '2026-11-07', end_date: '2026-11-21', status: 'open',
    })
    render(<StatementTab />)
    expect(await screen.findByText('Quinzena 07/11 – 21/11 · falta 1 dia')).toBeInTheDocument()
  })

  it('avisos de falta de nota e de consumo', async () => {
    mApi.computeStatement.mockResolvedValue({ ...lines, missing_fuel_price: true })
    render(<StatementTab />)
    expect(
      await screen.findByText('Ainda não há nota de abastecimento aprovada para calcular a gasolina'),
    ).toBeInTheDocument()
  })

  it('pausado vê o aviso e o extrato', async () => {
    profile = makeProfile({ paused: true })
    render(<StatementTab />)
    expect(await screen.findByText('Seu cadastro está pausado. Fale com a empresa.')).toBeInTheDocument()
    expect(screen.getByText('Quinzena 10/11 – 24/11 · faltam 4 dias')).toBeInTheDocument()
  })

  it('sem quinzena', async () => {
    mApi.getCurrentPeriod.mockResolvedValue(null)
    render(<StatementTab />)
    expect(await screen.findByText('Nenhuma quinzena aberta.')).toBeInTheDocument()
  })

  it('erro mostra retry', async () => {
    mApi.getCurrentPeriod.mockRejectedValueOnce(new Error('x'))
    render(<StatementTab />)
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText(/Quinzena 10\/11/)).toBeInTheDocument()
  })
})
