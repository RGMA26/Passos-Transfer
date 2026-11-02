import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatementView from './StatementView'
import type { StatementLines } from '../lib/types'

const base: StatementLines = {
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
}

const norm = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')
const text = (t: string) =>
  screen.getByText((_, el) => !!el && el.children.length === 0 && norm(el.textContent) === t)

describe('StatementView', () => {
  it('estimado mostra total e selo', () => {
    render(<StatementView lines={base} status="estimated" driverType="company_car" />)
    expect(text('R$ 213,00')).toBeInTheDocument()
    expect(screen.getAllByText('A receber (estimado)').length).toBeGreaterThan(0)
  })

  it('desconto aparece com sinal de menos', () => {
    render(<StatementView lines={base} status="estimated" driverType="company_car" />)
    expect(text('− R$ 12,50')).toBeInTheDocument()
  })

  it('pendente de conferência', () => {
    const l = { ...base, pending: { fuelings: 50, expenses: 0 } }
    render(<StatementView lines={l} status="estimated" driverType="company_car" />)
    expect(text('R$ 50,00 aguardando conferência')).toBeInTheDocument()
  })

  it('sem pendência não mostra aviso', () => {
    render(<StatementView lines={base} status="estimated" driverType="company_car" />)
    expect(screen.queryByText(/aguardando conferência/)).toBeNull()
  })

  it('aviso de falta de nota de abastecimento', () => {
    const l = { ...base, missing_fuel_price: true }
    render(<StatementView lines={l} status="estimated" driverType="company_car" />)
    expect(
      screen.getByText('Ainda não há nota de abastecimento aprovada para calcular a gasolina'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Falta o consumo/)).toBeNull()
  })

  it('aviso de falta de consumo do carro', () => {
    const l = { ...base, missing_consumption: true }
    render(<StatementView lines={l} status="estimated" driverType="own_car" />)
    expect(screen.getByText('Falta o consumo do carro para calcular a gasolina')).toBeInTheDocument()
    expect(screen.queryByText(/Ainda não há nota/)).toBeNull()
  })

  it('itens recusados com motivo', () => {
    render(
      <StatementView
        lines={base}
        status="estimated"
        driverType="company_car"
        rejected={[{ kind: 'Abastecimento', date: '2026-10-05', amount: 40, reason: 'Foto ilegível' }]}
      />,
    )
    expect(screen.getByText(/Foto ilegível/)).toBeInTheDocument()
  })

  it('turno recusado aparece como "Turno de dd/mm: motivo"', () => {
    render(
      <StatementView
        lines={base}
        status="estimated"
        driverType="company_car"
        rejected={[{ kind: 'Turno', date: '2026-10-05', amount: null, reason: 'Km errado' }]}
      />,
    )
    expect(screen.getByText('Turno de 05/10: Km errado')).toBeInTheDocument()
  })

  it('fechado mostra Total e selo Fechado', () => {
    render(<StatementView lines={base} status="closed" driverType="company_car" />)
    expect(screen.getByText('Fechado')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.queryByText('A receber (estimado)')).toBeNull()
  })

  it('pago mostra data e forma', () => {
    render(
      <StatementView
        lines={base}
        status="paid"
        paidAt="2026-10-20T12:00:00Z"
        method="Pix"
        driverType="company_car"
      />,
    )
    expect(screen.getByText('Pago em 20/10/2026 (Pix)')).toBeInTheDocument()
  })

  it('bloco de km', () => {
    render(<StatementView lines={base} status="estimated" driverType="company_car" />)
    expect(screen.getByText('Km total: 300')).toBeInTheDocument()
    expect(screen.getByText('Km em serviço: 250')).toBeInTheDocument()
    expect(screen.getByText('Km por fora: 50')).toBeInTheDocument()
  })

  it('carro próprio esconde linhas que não se aplicam', () => {
    render(<StatementView lines={base} status="estimated" driverType="own_car" />)
    expect(screen.queryByText('Parte Uber')).toBeNull()
    expect(screen.queryByText('Reembolso de abastecimento')).toBeNull()
    expect(screen.queryByText('Gasolina por fora')).toBeNull()
    expect(screen.getByText('Parte Transfer')).toBeInTheDocument()
    expect(screen.getByText('Reembolso de gasolina (Transfer)')).toBeInTheDocument()
  })

  it('carro da empresa esconde reembolso de gasolina Transfer', () => {
    render(<StatementView lines={base} status="estimated" driverType="company_car" />)
    expect(screen.queryByText('Reembolso de gasolina (Transfer)')).toBeNull()
    expect(screen.getByText('Parte Uber')).toBeInTheDocument()
    expect(screen.getByText('Gasolina por fora')).toBeInTheDocument()
  })
})
