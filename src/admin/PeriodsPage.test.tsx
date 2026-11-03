import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PeriodsPage from './PeriodsPage'
import PrintStatementPage from './PrintStatementPage'
import PrintReceiptPage from './PrintReceiptPage'
import * as api from '../lib/api'
import { formatBRL as rawBRL } from '../lib/money'
import type { DriverPeriod, StatementLines } from '../lib/types'

vi.mock('../lib/api', () => ({
  listPeriodOverview: vi.fn(),
  listDriverPeriods: vi.fn(),
  driverPeriodStatement: vi.fn(),
  closeDriverPeriod: vi.fn(),
  markStatementPaid: vi.fn(),
  listAdjustments: vi.fn(),
  createAdjustment: vi.fn(),
  deleteAdjustment: vi.fn(),
  listAdminDocuments: vi.fn(),
  uploadAdminDocument: vi.fn(),
  deleteAdminDocument: vi.fn(),
  adminDocumentUrl: vi.fn(),
  getStatement: vi.fn(),
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
const period = (over: Partial<DriverPeriod> = {}): DriverPeriod => ({
  id: 'p1',
  driver_id: 'd1',
  start_date: '2026-10-16',
  end_date: '2026-10-30',
  status: 'open',
  closed_at: null,
  created_at: '',
  missing_fuel_price: false,
  ...over,
})
const stmt = (over: Partial<api.PeriodStatement> = {}): api.PeriodStatement => ({
  period: period(),
  driver: { id: 'd1', name: 'Maria Souza', login_code: 'M001', driver_type: 'company_car' },
  lines: lines(),
  total: 213,
  statement_id: null,
  paid_at: null,
  payment_method: null,
  ...over,
})
const overview = (over: Partial<api.PeriodOverviewRow> = {}): api.PeriodOverviewRow => ({
  driver_id: 'd1',
  driver_name: 'Maria Souza',
  paused: false,
  signal: null,
  period_id: 'p1',
  start_date: '2026-10-16',
  end_date: '2026-10-30',
  total: 213,
  ...over,
})

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listPeriodOverview.mockResolvedValue([
    overview(),
    overview({ driver_id: 'd2', driver_name: 'João Lima', signal: 'red', period_id: 'q1', total: 0 }),
    overview({ driver_id: 'd3', driver_name: 'Ana Dias', signal: 'yellow', period_id: 'r1' }),
  ])
  m.listDriverPeriods.mockResolvedValue([
    period(),
    period({ id: 'p0', start_date: '2026-10-01', end_date: '2026-10-15', status: 'closed' }),
  ])
  m.driverPeriodStatement.mockResolvedValue(stmt())
  m.listAdjustments.mockResolvedValue([])
  m.listAdminDocuments.mockResolvedValue([])
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

const renderPage = () =>
  render(
    <MemoryRouter>
      <PeriodsPage />
    </MemoryRouter>,
  )

async function openDriver(name = 'Maria Souza') {
  const user = userEvent.setup()
  renderPage()
  const row = (await screen.findByText(name)).closest('tr')!
  await user.click(within(row).getByRole('button', { name: 'Abrir' }))
  await screen.findByRole('heading', { name: new RegExp(name) })
  return user
}

async function expandFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await screen.findAllByRole('button', { name: 'Ver extrato' }))[0])
}

describe('lista por motorista', () => {
  it('mostra quinzena atual, sinal e total de cada motorista', async () => {
    renderPage()
    const maria = (await screen.findByText('Maria Souza')).closest('tr')!
    expect(within(maria).getByText('16/10 – 30/10')).toBeInTheDocument()
    expect(within(maria).getByText(formatBRL(213))).toBeInTheDocument()
    const joao = screen.getByText('João Lima').closest('tr')!
    expect(within(joao).getByLabelText('Quinzena terminada sem fechamento')).toBeInTheDocument()
    const ana = screen.getByText('Ana Dias').closest('tr')!
    expect(within(ana).getByLabelText('Quinzena termina em até 5 dias')).toBeInTheDocument()
  })

  it('não tem campo de preço de referência', async () => {
    await openDriver()
    expect(screen.queryByLabelText(/preço de referência/i)).toBeNull()
    expect(screen.queryByText(/preço de referência/i)).toBeNull()
  })

  it('erro de carregamento mostra mensagem e tenta de novo', async () => {
    m.listPeriodOverview.mockRejectedValueOnce(new Error('x'))
    renderPage()
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText('Maria Souza')).toBeInTheDocument()
  })
})

describe('quinzenas do motorista', () => {
  it('lista atual e anteriores; ❗ com title só nas fechadas sem nota', async () => {
    m.listDriverPeriods.mockResolvedValue([
      period(),
      period({ id: 'p0', start_date: '2026-10-01', end_date: '2026-10-15', status: 'closed', missing_fuel_price: true }),
      period({ id: 'pz', start_date: '2026-09-16', end_date: '2026-09-30', status: 'closed' }),
    ])
    await openDriver()
    expect(m.listDriverPeriods).toHaveBeenCalledWith('d1')
    expect(await screen.findByText('16/10 – 30/10/2026 · Aberta')).toBeInTheDocument()
    const closedMissing = screen.getByText('01/10 – 15/10/2026 · Fechada').closest('li')!
    const mark = within(closedMissing).getByTitle('Fechada sem nota de abastecimento')
    expect(mark).toHaveTextContent('❗')
    const closedOk = screen.getByText('16/09 – 30/09/2026 · Fechada').closest('li')!
    expect(within(closedOk).queryByTitle('Fechada sem nota de abastecimento')).toBeNull()
  })

  it('expande o extrato estimado da quinzena aberta', async () => {
    const user = await openDriver()
    await expandFirst(user)
    expect(m.driverPeriodStatement).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('A receber (estimado)', { selector: '.badge' })).toBeInTheDocument()
  })
})

describe('fechar quinzena', () => {
  async function startClose(over: Partial<DriverPeriod> = {}) {
    if (Object.keys(over).length) m.listDriverPeriods.mockResolvedValue([period(over)])
    const user = await openDriver()
    await user.click(await screen.findByRole('button', { name: 'Fechar quinzena' }))
    return user
  }
  const ended = { end_date: '2026-10-30' }

  it('quinzena terminada: confirma e fecha sem force', async () => {
    m.closeDriverPeriod.mockResolvedValue('s1')
    await startClose(ended)
    expect(confirmSpy).toHaveBeenCalledWith('Fechar a quinzena 16/10 – 30/10? Os valores serão congelados.')
    await waitFor(() => expect(m.closeDriverPeriod).toHaveBeenCalledWith('p1', { force: false, allowMissingFuelPrice: false }))
  })

  it('ainda não terminou: pergunta antes e fecha com force', async () => {
    m.closeDriverPeriod.mockResolvedValue('s1')
    await startClose({ end_date: '2099-12-31' })
    await waitFor(() => expect(m.closeDriverPeriod).toHaveBeenCalledWith('p1', { force: true, allowMissingFuelPrice: false }))
    expect(confirmSpy).toHaveBeenLastCalledWith('A quinzena ainda não terminou. Fechar mesmo assim?')
    expect(m.closeDriverPeriod).toHaveBeenCalledTimes(1)
  })

  it('PERIOD_NOT_ENDED do servidor pede confirmação e reenvia com force', async () => {
    m.closeDriverPeriod.mockRejectedValueOnce(new Error('PERIOD_NOT_ENDED')).mockResolvedValueOnce('s1')
    await startClose(ended)
    await waitFor(() => expect(m.closeDriverPeriod).toHaveBeenCalledTimes(2))
    expect(m.closeDriverPeriod).toHaveBeenNthCalledWith(1, 'p1', { force: false, allowMissingFuelPrice: false })
    expect(m.closeDriverPeriod).toHaveBeenNthCalledWith(2, 'p1', { force: true, allowMissingFuelPrice: false })
    expect(confirmSpy).toHaveBeenLastCalledWith('A quinzena ainda não terminou. Fechar mesmo assim?')
  })

  it('cancelar a segunda confirmação não reenvia', async () => {
    m.closeDriverPeriod.mockRejectedValueOnce(new Error('PERIOD_NOT_ENDED'))
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false)
    await startClose(ended)
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
    expect(m.closeDriverPeriod).toHaveBeenCalledTimes(1)
  })

  it('PREVIOUS_OPEN: "Feche a quinzena anterior primeiro"', async () => {
    m.closeDriverPeriod.mockRejectedValue(new Error('PREVIOUS_OPEN'))
    await startClose(ended)
    expect(await screen.findByText('Feche a quinzena anterior primeiro')).toBeInTheDocument()
  })

  it('MISSING_FUEL_PRICE sem consumo faltando: confirma com o texto da nota e reenvia com allow', async () => {
    m.closeDriverPeriod.mockRejectedValueOnce(new Error('MISSING_FUEL_PRICE')).mockResolvedValueOnce('s1')
    await startClose(ended)
    await waitFor(() => expect(m.closeDriverPeriod).toHaveBeenCalledTimes(2))
    expect(confirmSpy).toHaveBeenLastCalledWith(
      'Não há nota de abastecimento aprovada para calcular a gasolina desta quinzena. A gasolina será calculada como R$ 0,00. Tem certeza que deseja fechar?',
    )
    expect(m.closeDriverPeriod).toHaveBeenNthCalledWith(2, 'p1', { force: false, allowMissingFuelPrice: true })
  })

  it('MISSING_FUEL_PRICE com consumo do carro faltando usa o texto do consumo', async () => {
    m.driverPeriodStatement.mockResolvedValue(stmt({ lines: lines({ missing_consumption: true }) }))
    m.closeDriverPeriod.mockRejectedValueOnce(new Error('MISSING_FUEL_PRICE')).mockResolvedValueOnce('s1')
    await startClose(ended)
    await waitFor(() => expect(m.closeDriverPeriod).toHaveBeenCalledTimes(2))
    expect(confirmSpy).toHaveBeenLastCalledWith(
      'Falta o consumo do carro para calcular a gasolina. A gasolina será calculada como R$ 0,00. Tem certeza que deseja fechar?',
    )
    expect(m.closeDriverPeriod).toHaveBeenNthCalledWith(2, 'p1', { force: false, allowMissingFuelPrice: true })
  })

  it('cancelar o MISSING_FUEL_PRICE não fecha', async () => {
    m.closeDriverPeriod.mockRejectedValueOnce(new Error('MISSING_FUEL_PRICE'))
    confirmSpy.mockReturnValueOnce(true).mockReturnValueOnce(false)
    await startClose(ended)
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
    expect(m.closeDriverPeriod).toHaveBeenCalledTimes(1)
  })

  it('não fecha se o usuário cancelar', async () => {
    confirmSpy.mockReturnValue(false)
    await startClose(ended)
    expect(m.closeDriverPeriod).not.toHaveBeenCalled()
  })

  it.each([
    ['OPEN_SHIFTS', 'Há turnos abertos'],
    ['ASSIGNED_TRANSFERS', 'Há transfers não concluídos'],
    ['PENDING_REVIEW', 'Há itens aguardando conferência'],
    ['SHIFTS_NOT_APPROVED', 'Há turnos não aprovados'],
    ['OTHER', 'Não foi possível fechar a quinzena'],
  ])('erro %s -> %s', async (code, msg) => {
    m.closeDriverPeriod.mockRejectedValue(new Error(code))
    await startClose(ended)
    expect(await screen.findByText(msg)).toBeInTheDocument()
  })
})

describe('ajustes', () => {
  async function openExpanded() {
    const user = await openDriver()
    await expandFirst(user)
    await screen.findByRole('button', { name: 'Adicionar ajuste' })
    return user
  }

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

describe('pagamento e anexos', () => {
  const closed = (over: Partial<api.PeriodStatement> = {}) =>
    stmt({ period: period({ id: 'p0', status: 'closed' }), statement_id: 's1', ...over })
  const doc = (over: Partial<api.AdminDocument> = {}): api.AdminDocument =>
    ({
      id: 'x1',
      driver_id: 'd1',
      statement_id: 's1',
      kind: 'payment_proof',
      description: null,
      file_path: 'd1/a.pdf',
      mime_type: 'application/pdf',
      size_bytes: 10,
      created_at: '2026-10-20T12:00:00Z',
      created_by: null,
      ...over,
    }) as api.AdminDocument

  beforeEach(() => {
    m.listDriverPeriods.mockResolvedValue([period({ id: 'p0', status: 'closed' })])
  })

  it('Marcar como pago exige data e forma', async () => {
    m.driverPeriodStatement.mockResolvedValue(closed())
    const user = await openDriver()
    await expandFirst(user)
    await user.click(await screen.findByRole('button', { name: 'Marcar como pago' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    expect(screen.getByText('Informe data e forma de pagamento')).toBeInTheDocument()
    expect(m.markStatementPaid).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByLabelText('Forma'), 'Pix')
    await user.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    await waitFor(() =>
      expect(m.markStatementPaid).toHaveBeenCalledWith('s1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 'Pix'),
    )
  })

  it('fechada e não paga: Imprimir / PDF, sem anexos nem Recibo', async () => {
    m.driverPeriodStatement.mockResolvedValue(closed())
    const user = await openDriver()
    await expandFirst(user)
    expect(await screen.findByRole('link', { name: 'Imprimir / PDF' })).toHaveAttribute('href', '/admin/extrato/s1')
    expect(screen.queryByText('Comprovante de pagamento')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Recibo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fechar quinzena' })).toBeNull()
  })

  it('paga: seções de anexos com ⚪ e link Recibo', async () => {
    m.driverPeriodStatement.mockResolvedValue(closed({ paid_at: '2026-10-20', payment_method: 'Pix' }))
    const user = await openDriver()
    await expandFirst(user)
    expect(await screen.findByRole('link', { name: 'Recibo' })).toHaveAttribute('href', '/admin/recibo/s1')
    const proof = screen.getByRole('region', { name: 'Comprovante de pagamento' })
    const signed = screen.getByRole('region', { name: 'Recibo assinado' })
    expect(await within(proof).findByLabelText('Sem anexo')).toHaveTextContent('⚪')
    expect(within(signed).getByLabelText('Sem anexo')).toBeInTheDocument()
    expect(m.listAdminDocuments).toHaveBeenCalledWith({ statementId: 's1' })
  })

  it('✅ quando há anexo; lista, abre e exclui com confirmação', async () => {
    m.driverPeriodStatement.mockResolvedValue(closed({ paid_at: '2026-10-20', payment_method: 'Pix' }))
    m.listAdminDocuments.mockResolvedValue([doc(), doc({ id: 'x2', kind: 'signed_receipt', file_path: 'd1/b.png' })])
    m.adminDocumentUrl.mockResolvedValue('https://signed/doc')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = await openDriver()
    await expandFirst(user)
    const proof = await screen.findByRole('region', { name: 'Comprovante de pagamento' })
    expect(await within(proof).findByLabelText('Anexado')).toHaveTextContent('✅')
    expect(within(screen.getByRole('region', { name: 'Recibo assinado' })).getByLabelText('Anexado')).toBeInTheDocument()
    await user.click(within(proof).getByRole('button', { name: 'Abrir' }))
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://signed/doc', '_blank', 'noopener'))
    await user.click(within(proof).getByRole('button', { name: 'Excluir' }))
    expect(confirmSpy).toHaveBeenCalledWith('Excluir este documento?')
    await waitFor(() => expect(m.deleteAdminDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' })))
    openSpy.mockRestore()
  })

  it('envia vários arquivos de cada tipo', async () => {
    m.driverPeriodStatement.mockResolvedValue(closed({ paid_at: '2026-10-20', payment_method: 'Pix' }))
    const user = await openDriver()
    await expandFirst(user)
    const proof = await screen.findByRole('region', { name: 'Comprovante de pagamento' })
    const f1 = new File(['a'], 'a.pdf', { type: 'application/pdf' })
    const f2 = new File(['b'], 'b.png', { type: 'image/png' })
    await user.upload(within(proof).getByLabelText('Anexar comprovante de pagamento'), [f1, f2])
    await waitFor(() => expect(m.uploadAdminDocument).toHaveBeenCalledTimes(2))
    expect(m.uploadAdminDocument).toHaveBeenCalledWith({
      driverId: 'd1',
      statementId: 's1',
      kind: 'payment_proof',
      file: f1,
    })
    const signed = screen.getByRole('region', { name: 'Recibo assinado' })
    await user.upload(within(signed).getByLabelText('Anexar recibo assinado'), f2)
    await waitFor(() => expect(m.uploadAdminDocument).toHaveBeenCalledTimes(3))
    expect(m.uploadAdminDocument).toHaveBeenLastCalledWith({
      driverId: 'd1',
      statementId: 's1',
      kind: 'signed_receipt',
      file: f2,
    })
  })

  it('arquivo inválido mostra a mensagem e não envia', async () => {
    m.driverPeriodStatement.mockResolvedValue(closed({ paid_at: '2026-10-20', payment_method: 'Pix' }))
    const user = await openDriver()
    await expandFirst(user)
    const proof = await screen.findByRole('region', { name: 'Comprovante de pagamento' })
    const bad = new File(['x'], 'a.gif', { type: 'image/gif' })
    await userEvent.setup({ applyAccept: false }).upload(within(proof).getByLabelText('Anexar comprovante de pagamento'), bad)
    expect(await within(proof).findByText('Envie JPG, PNG ou PDF de até 10 MB')).toBeInTheDocument()
    expect(m.uploadAdminDocument).not.toHaveBeenCalled()
  })
})

const lines0 = lines()
const fullStatement = (over: Partial<api.FullStatement> = {}): api.FullStatement => ({
  id: 's1',
  lines: lines0,
  total: 213,
  paid_at: '2026-10-20',
  payment_method: 'Pix',
  driver: { name: 'Maria Souza', cpf: '52998224725', login_code: 'M001', driver_type: 'company_car' },
  period: { start_date: '2026-10-01', end_date: '2026-10-15' },
  ...over,
})
const renderAt = (path: string, route: string, el: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={el} />
      </Routes>
    </MemoryRouter>,
  )

describe('PrintStatementPage', () => {
  it('chama window.print() uma vez após carregar', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    m.getStatement.mockResolvedValue(fullStatement({ paid_at: null, payment_method: null }))
    renderAt('/admin/extrato/s1', '/admin/extrato/:statementId', <PrintStatementPage />)
    expect(await screen.findByText('Passos Transfer — Extrato')).toBeInTheDocument()
    expect(screen.getByText(/Maria Souza/)).toBeInTheDocument()
    expect(screen.getByText('Voltar')).toBeInTheDocument()
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1))
    expect(m.getStatement).toHaveBeenCalledWith('s1')
    printSpy.mockRestore()
  })
})

describe('PrintReceiptPage', () => {
  it('mostra os dados do recibo e chama window.print() uma vez', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    m.getStatement.mockResolvedValue(fullStatement())
    renderAt('/admin/recibo/s1', '/admin/recibo/:statementId', <PrintReceiptPage />)
    expect(await screen.findByText('Passos Transfer — Recibo de pagamento')).toBeInTheDocument()
    expect(screen.getByText('Maria Souza')).toBeInTheDocument()
    expect(screen.getByText('CPF: 529.982.247-25')).toBeInTheDocument()
    expect(screen.getByText('Código: M001')).toBeInTheDocument()
    expect(screen.getByText('Período: 01/10/2026 a 15/10/2026')).toBeInTheDocument()
    expect(screen.getByText('Parte Uber')).toBeInTheDocument()
    expect(screen.getByText(/duzentos e treze reais/)).toBeInTheDocument()
    expect(screen.getByText(formatBRL(213), { selector: '.receipt-amount' })).toBeInTheDocument()
    expect(screen.getByText('Data do pagamento: 20/10/2026')).toBeInTheDocument()
    expect(screen.getByText('Forma de pagamento: Pix')).toBeInTheDocument()
    expect(screen.getByText('Assinatura do motorista')).toBeInTheDocument()
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1))
    expect(m.getStatement).toHaveBeenCalledWith('s1')
    printSpy.mockRestore()
  })

  it('não imprime quando o pagamento não foi registrado', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    m.getStatement.mockResolvedValue(fullStatement({ paid_at: null, payment_method: null }))
    renderAt('/admin/recibo/s1', '/admin/recibo/:statementId', <PrintReceiptPage />)
    expect(await screen.findByText('O pagamento ainda não foi registrado')).toBeInTheDocument()
    expect(printSpy).not.toHaveBeenCalled()
    printSpy.mockRestore()
  })

  it('erro de carregamento', async () => {
    m.getStatement.mockRejectedValue(new Error('x'))
    renderAt('/admin/recibo/s1', '/admin/recibo/:statementId', <PrintReceiptPage />)
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
  })
})
