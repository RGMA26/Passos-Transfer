import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BalancePage from './BalancePage'
import * as api from '../lib/api'
import * as csv from '../lib/csv'
import { balance } from './balanceFixture'
import { formatBRL as rawBRL } from '../lib/money'

vi.mock('../lib/api', () => ({ monthlyBalance: vi.fn(), monthlyDetail: vi.fn() }))
vi.mock('../lib/csv', async (orig) => ({ ...(await orig<typeof import('../lib/csv')>()), downloadCSV: vi.fn() }))
const m = vi.mocked(api)
const brl = (n: number) => rawBRL(n).replace(/\s/g, ' ')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T15:00:00Z') })
  m.monthlyBalance.mockResolvedValue(balance())
  m.monthlyDetail.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

const renderPage = () =>
  render(
    <MemoryRouter>
      <BalancePage />
    </MemoryRouter>,
  )

describe('BalancePage', () => {
  it('mês atual por padrão e blocos de resultado', async () => {
    renderPage()
    expect(await screen.findByText('Novembro/2026')).toBeInTheDocument()
    expect(m.monthlyBalance).toHaveBeenCalledWith('2026-11-01')
    expect(screen.getByText(`Uber: ${brl(5000)}`)).toBeInTheDocument()
    expect(screen.getByText(`Total: ${brl(7500)}`)).toBeInTheDocument()
    expect(screen.getByText(`Maria Souza — ${brl(1800)}`)).toBeInTheDocument()
    expect(screen.getByText(`Desconto da gasolina por fora: − ${brl(40)}`)).toBeInTheDocument()
    expect(screen.getByText('parcela 2/3')).toBeInTheDocument()
    expect(screen.getByText('recorrente')).toBeInTheDocument()
    expect(screen.getByText(`▲ ${brl(1250)} (+62,5%)`)).toBeInTheDocument()
  })

  it('selo estimado do resultado só quando estimated (A pagar sempre tem o seu)', async () => {
    renderPage()
    await screen.findByText('Novembro/2026')
    expect(screen.getAllByText('estimado')).toHaveLength(1)
  })

  it('estimado e queda sem percentual', async () => {
    const b = balance({ estimated: true })
    b.result.diff = -500
    b.result.diff_pct = null
    m.monthlyBalance.mockResolvedValue(b)
    renderPage()
    expect(await screen.findByText(`▼ ${brl(500)}`)).toBeInTheDocument()
    expect(screen.getAllByText('estimado')).toHaveLength(2)
  })

  it('caixa com anexos e a pagar', async () => {
    renderPage()
    const cash = await screen.findByLabelText('Caixa do mês')
    expect(within(cash).getByText(/Maria Souza · quinzena 16\/10 – 31\/10/)).toHaveTextContent(
      'Comprovante ✅ · Recibo assinado ⚪',
    )
    const pay = screen.getByLabelText('A pagar')
    expect(within(pay).getByText(/João Lima — fechado não pago/)).toBeInTheDocument()
  })

  it('troca o mês', async () => {
    renderPage()
    await screen.findByText('Novembro/2026')
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-10' } })
    expect(m.monthlyBalance).toHaveBeenLastCalledWith('2026-10-01')
  })

  it('exporta planilha detalhada', async () => {
    m.monthlyDetail.mockResolvedValue([
      { occurred_on: '2026-11-02', driver_name: 'Maria Souza', cpf: '52998224725', login_code: 'M1', kind: 'uber', description: 'Uber', gross: 100, driver_amount: 60, period_label: '01/11–15/11', status: 'approved' },
    ])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar planilha detalhada' }))
    await vi.waitFor(() => expect(csv.downloadCSV).toHaveBeenCalled())
    const [name, content] = vi.mocked(csv.downloadCSV).mock.calls[0]
    expect(name).toBe('passos-balanco-detalhado-2026-11.csv')
    expect(content.split('\r\n')[0]).toBe('﻿data;motorista;cpf;codigo;tipo;descricao;valor_bruto;valor_motorista;quinzena;situacao')
    expect(content).toContain('02/11/2026;Maria Souza;529.982.247-25;M1;Corrida Uber;Uber;100,00;60,00;01/11–15/11;Aprovado')
  })

  it('planilha detalhada: tipos e situações em português; gasto de carro sem valor do motorista', async () => {
    const row = (o: Partial<api.MonthlyDetailRow>): api.MonthlyDetailRow => ({
      occurred_on: '2026-11-03', driver_name: 'Maria Souza', cpf: '52998224725', login_code: 'M1', kind: 'uber',
      description: 'x', gross: 10, driver_amount: 5, period_label: '01/11–15/11', status: 'approved', ...o,
    })
    const nil = null as unknown as string
    m.monthlyDetail.mockResolvedValue([
      row({ kind: 'blablacar', status: 'pending' }),
      row({ kind: 'transfer', status: 'checked' }),
      row({ kind: 'transfer', status: 'completed' }),
      row({ kind: 'fueling', status: 'rejected' }),
      row({ kind: 'toll' }),
      row({ kind: 'parking' }),
      row({ kind: 'adjustment', status: 'advance', description: 'Vale' }),
      row({ kind: 'adjustment', status: 'fine' }),
      row({ kind: 'adjustment', status: 'bonus' }),
      row({ kind: 'adjustment', status: 'correction' }),
      row({ kind: 'payment', status: 'paid', description: 'pix' }),
      row({ kind: 'car_expense', driver_name: nil, cpf: nil, login_code: nil, period_label: nil,
            driver_amount: null as unknown as number, description: 'ABC1D23 Onix — maintenance — troca de óleo', status: 'installment 3/10' }),
      row({ kind: 'car_expense', driver_name: nil, cpf: nil, login_code: nil, period_label: nil,
            driver_amount: null as unknown as number, description: 'ABC1D23 Onix — insurance', status: 'recurring' }),
      row({ kind: 'car_expense', driver_name: nil, cpf: nil, login_code: nil, period_label: nil,
            driver_amount: null as unknown as number, description: 'ABC1D23 Onix — tax — IPVA', status: 'single' }),
      row({ kind: 'car_expense', driver_name: nil, cpf: nil, login_code: nil, period_label: nil,
            driver_amount: null as unknown as number, description: 'ABC1D23 Onix — other — lavagem', status: 'single' }),
    ])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar planilha detalhada' }))
    await vi.waitFor(() => expect(csv.downloadCSV).toHaveBeenCalled())
    const lines = vi.mocked(csv.downloadCSV).mock.calls[0][1].split('\r\n').slice(1)
    const col = (i: number) => lines.map((l) => l.split(';')[i])
    expect(col(4)).toEqual([
      'Corrida BlaBlaCar', 'Transfer', 'Transfer', 'Abastecimento', 'Pedágio', 'Estacionamento',
      'Ajuste – Vale', 'Ajuste – Multa', 'Ajuste – Bônus', 'Ajuste – Correção', 'Pagamento',
      'Gasto do carro – Manutenção', 'Gasto do carro – Seguro', 'Gasto do carro – Imposto', 'Gasto do carro – Outro',
    ])
    expect(col(9)).toEqual([
      'Pendente', 'Conferido', 'Concluído', 'Recusado', 'Aprovado', 'Aprovado',
      '', '', '', '', 'Pago', 'parcela 3/10', 'recorrente', 'pontual', 'pontual',
    ])
    expect(lines[11]).toBe('03/11/2026;;;;Gasto do carro – Manutenção;ABC1D23 Onix — Manutenção — troca de óleo;10,00;;;parcela 3/10')
  })

  it('planilha detalhada vazia mantém o cabeçalho', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar planilha detalhada' }))
    await vi.waitFor(() => expect(csv.downloadCSV).toHaveBeenCalled())
    expect(vi.mocked(csv.downloadCSV).mock.calls[0][1]).toBe(
      '﻿data;motorista;cpf;codigo;tipo;descricao;valor_bruto;valor_motorista;quinzena;situacao',
    )
  })

  it('troca rápida de mês: a resposta atrasada do mês anterior é ignorada', async () => {
    let releaseOld: (v: api.MonthlyBalance) => void = () => {}
    const old = balance()
    old.result.revenue.total = 1111
    m.monthlyBalance.mockImplementation((month: string) =>
      month === '2026-10-01' ? new Promise((r) => (releaseOld = r)) : Promise.resolve(balance()),
    )
    renderPage()
    await screen.findByText('Novembro/2026')
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-10' } })
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-09' } })
    expect(await screen.findByText('Setembro/2026')).toBeInTheDocument()
    expect(await screen.findByText(`Total: ${brl(7500)}`)).toBeInTheDocument()
    releaseOld(old)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(`Total: ${brl(1111)}`)).toBeNull()
    expect(screen.getByText(`Total: ${brl(7500)}`)).toBeInTheDocument()
  })

  it('mês apagado: sem exportações', async () => {
    renderPage()
    await screen.findByText('Novembro/2026')
    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '' } })
    expect(screen.queryByRole('button', { name: 'Exportar planilha detalhada' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exportar resumo' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Imprimir / PDF' })).toBeNull()
    expect(screen.getByText('Escolha um mês.')).toBeInTheDocument()
  })

  it('exporta resumo e tem link de impressão', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar resumo' }))
    expect(vi.mocked(csv.downloadCSV).mock.calls[0][0]).toBe('passos-balanco-2026-11.csv')
    expect(screen.getByRole('link', { name: 'Imprimir / PDF' })).toHaveAttribute('href', '/admin/balanco/imprimir/2026-11')
  })

  it('erro de carregamento', async () => {
    m.monthlyBalance.mockRejectedValue(new Error('x'))
    renderPage()
    expect(await screen.findByText('Não foi possível carregar. Tente novamente.')).toBeInTheDocument()
  })
})
