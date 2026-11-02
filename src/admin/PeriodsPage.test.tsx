import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PeriodsPage from './PeriodsPage'
import PrintStatementPage from './PrintStatementPage'
import DashboardPage from './DashboardPage'
import * as api from '../lib/api'
import { formatBRL as rawBRL } from '../lib/money'
import type { Period, StatementLines } from '../lib/types'

vi.mock('../lib/api', () => ({
  listPeriods: vi.fn(),
  setReferencePrice: vi.fn(),
  listAdjustments: vi.fn(),
  createAdjustment: vi.fn(),
  deleteAdjustment: vi.fn(),
  periodDriverStatements: vi.fn(),
  closePeriod: vi.fn(),
  markStatementPaid: vi.fn(),
  periodSummary: vi.fn(),
  getStatement: vi.fn(),
  getCurrentPeriod: vi.fn(),
}))
const m = vi.mocked(api)
// o texto do DOM tem o espaço normalizado (R$ + nbsp vira espaço comum)
const formatBRL = (n: number) => rawBRL(n).replace(/\s/g, ' ')

const lines = (over: Partial<StatementLines> = {}): StatementLines => ({
  uber_share: 120,
  transfer_share: 60,
  fuel_reimbursement: 50,
  transfer_fuel_reimbursement: 0,
  expense_reimbursement: 8,
  off_duty_fuel_discount: 12.5,
  adjustments: 5,
  total: 213,
  cost_per_km: 0.625,
  missing_fuel_price: false,
  missing_consumption: false,
  km: { total: 300, service: 250, off: 50 },
  pending: { fuelings: 0, expenses: 0 },
  ...over,
})
const period = (over: Partial<Period> = {}): Period =>
  ({
    id: 'p1',
    start_date: '2026-10-16',
    end_date: '2026-10-31',
    status: 'open',
    reference_fuel_price: 5.5,
    closed_at: null,
    created_at: '',
    ...over,
  }) as Period
const stmt = (over: Partial<api.PeriodDriverStatement> = {}): api.PeriodDriverStatement => ({
  driver_id: 'd1',
  driver_name: 'Maria Souza',
  driver_code: 'M001',
  driver_type: 'company_car',
  lines: lines(),
  total: 213,
  statement_id: null,
  paid_at: null,
  payment_method: null,
  ...over,
})

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listPeriods.mockResolvedValue([
    period(),
    period({ id: 'p0', start_date: '2026-10-01', end_date: '2026-10-15', status: 'closed' }),
  ])
  m.periodDriverStatements.mockResolvedValue([stmt()])
  m.listAdjustments.mockResolvedValue([])
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

const renderPage = () =>
  render(
    <MemoryRouter>
      <PeriodsPage />
    </MemoryRouter>,
  )

async function openExpanded() {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('Maria Souza')
  await user.click(screen.getByRole('button', { name: 'Ver extrato' }))
  return user
}

describe('quinzenas', () => {
  it('lista motoristas com total e status Estimado, e seletor com status', async () => {
    renderPage()
    expect(await screen.findByText('Maria Souza')).toBeInTheDocument()
    expect(screen.getByText(formatBRL(213))).toBeInTheDocument()
    expect(screen.getByText('Estimado')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '16/10 – 31/10/2026 · Aberta' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '01/10 – 15/10/2026 · Fechada' })).toBeInTheDocument()
  })

  it('expande o extrato do motorista', async () => {
    await openExpanded()
    expect(screen.getByText('A receber (estimado)', { selector: '.badge' })).toBeInTheDocument()
  })

  it('salva o preço de referência (vírgula decimal)', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Maria Souza')
    const input = screen.getByLabelText('Preço de referência do litro')
    await user.clear(input)
    await user.type(input, '5,899')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.setReferencePrice).toHaveBeenCalledWith('p1', 5.899))
  })

  it('rejeita preço inválido', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Maria Souza')
    const input = screen.getByLabelText('Preço de referência do litro')
    await user.clear(input)
    await user.type(input, '0')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe um preço válido')).toBeInTheDocument()
    expect(m.setReferencePrice).not.toHaveBeenCalled()
  })

  it('Fechar quinzena pede confirmação e fecha', async () => {
    const user = userEvent.setup()
    m.closePeriod.mockResolvedValue('s1')
    renderPage()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Fechar quinzena' }))
    expect(confirmSpy).toHaveBeenCalledWith('Fechar a quinzena 16/10 – 31/10? Os valores serão congelados.')
    await waitFor(() => expect(m.closePeriod).toHaveBeenCalledWith('p1', false))
  })

  it('quinzena atual (ainda não terminou) pergunta antes e fecha com force', async () => {
    const user = userEvent.setup()
    m.listPeriods.mockResolvedValue([period({ end_date: '2099-12-31' })])
    m.closePeriod.mockResolvedValue('s1')
    renderPage()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Fechar quinzena' }))
    await waitFor(() => expect(m.closePeriod).toHaveBeenCalledWith('p1', true))
    expect(confirmSpy).toHaveBeenLastCalledWith('A quinzena ainda não terminou. Fechar mesmo assim?')
    expect(m.closePeriod).toHaveBeenCalledTimes(1)
  })

  it('PERIOD_NOT_ENDED do servidor pede segunda confirmação e fecha com force', async () => {
    const user = userEvent.setup()
    m.closePeriod.mockRejectedValueOnce(new Error('PERIOD_NOT_ENDED')).mockResolvedValueOnce('s1')
    renderPage()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Fechar quinzena' }))
    await waitFor(() => expect(m.closePeriod).toHaveBeenCalledWith('p1', true))
    expect(confirmSpy).toHaveBeenLastCalledWith('A quinzena ainda não terminou. Fechar mesmo assim?')
    expect(m.closePeriod).toHaveBeenNthCalledWith(1, 'p1', false)
  })

  it('cancelar a segunda confirmação não fecha', async () => {
    const user = userEvent.setup()
    m.closePeriod.mockRejectedValueOnce(new Error('PERIOD_NOT_ENDED'))
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false)
    renderPage()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Fechar quinzena' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
    expect(m.closePeriod).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('A quinzena ainda não terminou')).toBeNull()
  })

  it('não fecha se o usuário cancelar', async () => {
    const user = userEvent.setup()
    confirmSpy.mockReturnValue(false)
    renderPage()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Fechar quinzena' }))
    expect(m.closePeriod).not.toHaveBeenCalled()
  })

  it.each([
    ['OPEN_SHIFTS', 'Há turnos abertos'],
    ['ASSIGNED_TRANSFERS', 'Há transfers não concluídos'],
    ['PENDING_REVIEW', 'Há itens aguardando conferência'],
    ['SHIFTS_NOT_APPROVED', 'Há turnos não aprovados'],
    ['MISSING_REFERENCE_PRICE', 'Defina o preço de referência do litro'],
    ['OTHER', 'Não foi possível fechar a quinzena'],
  ])('erro %s -> %s', async (code, msg) => {
    const user = userEvent.setup()
    m.closePeriod.mockRejectedValue(new Error(code))
    renderPage()
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Fechar quinzena' }))
    expect(await screen.findByText(msg)).toBeInTheDocument()
  })

  it('Multa digitada positiva é salva negativa', async () => {
    const user = await openExpanded()
    await user.selectOptions(screen.getByLabelText('Tipo'), 'fine')
    await user.type(screen.getByLabelText('Valor'), '30,50')
    await user.type(screen.getByLabelText('Descrição'), 'Multa de trânsito')
    await user.click(screen.getByRole('button', { name: 'Adicionar ajuste' }))
    await waitFor(() =>
      expect(m.createAdjustment).toHaveBeenCalledWith({
        driver_id: 'd1',
        period_id: 'p1',
        kind: 'fine',
        amount: -30.5,
        description: 'Multa de trânsito',
      }),
    )
  })

  it('Vale -> negativo, Bônus -> positivo, Correção aceita "-"', async () => {
    const user = await openExpanded()
    const add = async (kind: string, value: string, desc: string) => {
      await user.selectOptions(screen.getByLabelText('Tipo'), kind)
      await user.type(screen.getByLabelText('Valor'), value)
      await user.type(screen.getByLabelText('Descrição'), desc)
      await user.click(screen.getByRole('button', { name: 'Adicionar ajuste' }))
    }
    await add('advance', '100', 'Vale')
    await waitFor(() =>
      expect(m.createAdjustment).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'advance', amount: -100 })),
    )
    await add('bonus', '40', 'Bônus')
    await waitFor(() =>
      expect(m.createAdjustment).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'bonus', amount: 40 })),
    )
    await add('correction', '-15', 'Acerto')
    await waitFor(() =>
      expect(m.createAdjustment).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'correction', amount: -15 })),
    )
  })

  it('exige descrição do ajuste', async () => {
    const user = await openExpanded()
    await user.type(screen.getByLabelText('Valor'), '10')
    await user.click(screen.getByRole('button', { name: 'Adicionar ajuste' }))
    expect(screen.getByText('Informe a descrição')).toBeInTheDocument()
    expect(m.createAdjustment).not.toHaveBeenCalled()
  })

  it('lista e exclui ajustes', async () => {
    m.listAdjustments.mockResolvedValue([
      { id: 'a1', driver_id: 'd1', driver_period_id: 'p1', effective_date: '2026-10-20', kind: 'fine', amount: -30, description: 'Multa X', created_at: '' },
    ])
    const user = await openExpanded()
    expect(screen.getByText(/Multa X/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(m.deleteAdjustment).toHaveBeenCalledWith('a1'))
  })
})

describe('quinzena fechada', () => {
  beforeEach(() => {
    m.periodDriverStatements.mockResolvedValue([
      stmt({ statement_id: 's1' }),
      stmt({
        driver_id: 'd2',
        driver_name: 'João Lima',
        driver_code: 'J002',
        statement_id: 's2',
        paid_at: '2026-10-20',
        payment_method: 'Pix',
        total: 100,
      }),
    ])
  })
  async function openClosed() {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Maria Souza')
    await user.selectOptions(screen.getByLabelText('Quinzena'), 'p0')
    await waitFor(() => expect(m.periodDriverStatements).toHaveBeenLastCalledWith('p0'))
    return user
  }

  it('mostra A pagar / Pago em dd/mm, sem Fechar quinzena nem Salvar preço', async () => {
    await openClosed()
    expect(await screen.findByText('A pagar')).toBeInTheDocument()
    expect(screen.getByText('Pago em 20/10')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fechar quinzena' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
    const links = screen.getAllByRole('link', { name: 'Imprimir / PDF' })
    expect(links[0]).toHaveAttribute('href', '/admin/extrato/s1')
  })

  it('Marcar como pago exige data e forma', async () => {
    const user = await openClosed()
    await screen.findByText('A pagar')
    await user.click(screen.getAllByRole('button', { name: 'Ver extrato' })[0])
    await user.click(screen.getByRole('button', { name: 'Marcar como pago' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    expect(screen.getByText('Informe data e forma de pagamento')).toBeInTheDocument()
    expect(m.markStatementPaid).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByLabelText('Forma'), 'Pix')
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    await waitFor(() =>
      expect(m.markStatementPaid).toHaveBeenCalledWith('s1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 'Pix'),
    )
  })

  it('Exportar CSV baixa passos-quinzena-<início>.csv', async () => {
    const user = await openClosed()
    await screen.findByText('A pagar')
    const create = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
    const downloads: string[] = []
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    })
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    expect(create).toHaveBeenCalledTimes(1)
    const blob = (create.mock.calls[0] as unknown as [Blob])[0]
    const text = await new Promise<string>((res) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.readAsText(blob)
    })
    expect(text).toContain('motorista;codigo;parte_uber;parte_transfer;reembolsos;desconto_gasolina;ajustes;total;pago_em')
    expect(text).toContain('João Lima;J002')
    expect(downloads).toEqual(['passos-quinzena-2026-10-01.csv'])
    spy.mockRestore()
  })
})

describe('erro de carregamento', () => {
  it('mostra mensagem', async () => {
    m.listPeriods.mockRejectedValue(new Error('x'))
    renderPage()
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
  })
})

describe('PrintStatementPage', () => {
  it('chama window.print() uma vez após carregar', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    m.getStatement.mockResolvedValue({
      id: 's1',
      lines: lines(),
      total: 213,
      paid_at: null,
      payment_method: null,
      driver: { name: 'Maria Souza', login_code: 'M001', driver_type: 'company_car' },
      period: { start_date: '2026-10-01', end_date: '2026-10-15' },
    })
    render(
      <MemoryRouter initialEntries={['/admin/extrato/s1']}>
        <Routes>
          <Route path="/admin/extrato/:statementId" element={<PrintStatementPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Passos Transfer — Extrato')).toBeInTheDocument()
    expect(screen.getByText(/Maria Souza/)).toBeInTheDocument()
    expect(screen.getByText('Voltar')).toBeInTheDocument()
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1))
    expect(m.getStatement).toHaveBeenCalledWith('s1')
    printSpy.mockRestore()
  })
})

describe('DashboardPage', () => {
  it('mostra os números do período atual e o ranking de km por fora', async () => {
    m.periodSummary.mockResolvedValue({
      revenue: { uber: 1000, transfer: 500, blablacar: 200 },
      drivers_share: 900,
      company_share: 800,
      fuel_reimbursed: 150,
      fuel_discounted: 40,
      off_km_ranking: [{ driver_id: 'd1', name: 'Maria Souza', km_off: 77 }],
    })
    render(<DashboardPage />)
    expect(await screen.findByText('Faturamento')).toBeInTheDocument()
    expect(screen.getByText(formatBRL(1700))).toBeInTheDocument()
    expect(screen.getByText(`Uber: ${formatBRL(1000)}`)).toBeInTheDocument()
    expect(screen.getByText(`Transfer: ${formatBRL(500)}`)).toBeInTheDocument()
    expect(screen.getByText(`BlaBlaCar: ${formatBRL(200)}`)).toBeInTheDocument()
    const part = screen.getByText('Parte dos motoristas').parentElement!
    expect(within(part).getByText(formatBRL(900))).toBeInTheDocument()
    const comp = screen.getByText('Parte da empresa').parentElement!
    expect(within(comp).getByText(formatBRL(800))).toBeInTheDocument()
    const gr = screen.getByText('Gasolina reembolsada').parentElement!
    expect(within(gr).getByText(formatBRL(150))).toBeInTheDocument()
    const gd = screen.getByText('Gasolina descontada').parentElement!
    expect(within(gd).getByText(formatBRL(40))).toBeInTheDocument()
    expect(screen.getByText('Km por fora — ranking')).toBeInTheDocument()
    expect(screen.getByText('Maria Souza — 77 km')).toBeInTheDocument()
  })

  it('erro de carregamento', async () => {
    m.periodSummary.mockRejectedValue(new Error('x'))
    render(<DashboardPage />)
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
  })
})
