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
      { occurred_on: '2026-11-02', driver_name: 'Maria Souza', cpf: '123', login_code: 'M1', kind: 'uber', description: 'Uber', gross: 100, driver_amount: 60, period_label: '01/11–15/11', status: 'approved' },
    ])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Exportar planilha detalhada' }))
    await vi.waitFor(() => expect(csv.downloadCSV).toHaveBeenCalled())
    const [name, content] = vi.mocked(csv.downloadCSV).mock.calls[0]
    expect(name).toBe('passos-balanco-detalhado-2026-11.csv')
    expect(content.split('\r\n')[0]).toBe('﻿data;motorista;cpf;codigo;tipo;descricao;valor_bruto;valor_motorista;quinzena;situacao')
    expect(content).toContain('02/11/2026;Maria Souza;123;M1;uber;Uber;100,00;60,00;01/11–15/11;approved')
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
