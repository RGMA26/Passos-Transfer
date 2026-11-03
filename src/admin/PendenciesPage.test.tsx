import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import PendenciesPage from './PendenciesPage'
import * as api from '../lib/api'

vi.mock('../lib/api', () => ({ listPendencies: vi.fn() }))
const m = vi.mocked(api)

const p = (o: Partial<api.Pendency>): api.Pendency => ({
  category: 'white', item_type: 'fueling', item_id: 'f1', driver_id: 'd1', driver_name: 'Maria Souza',
  label: 'Abastecimento aguardando conferência', occurred_on: '2026-11-02', ...o,
})

function Where() {
  const l = useLocation()
  return <p>{`at:${l.pathname}${l.search}${l.hash}`}</p>
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/pendencias" element={<PendenciesPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  m.listPendencies.mockResolvedValue([
    p({}),
    p({ item_id: 'f2', driver_name: 'João Lima', occurred_on: '2026-11-03' }),
    p({ category: 'red', item_type: 'period', item_id: 'p1', driver_id: 'd9', driver_name: 'Ana', label: 'Quinzena terminada e não fechada' }),
  ])
})

describe('PendenciesPage', () => {
  it('lista só a categoria pedida', async () => {
    renderAt('/admin/pendencias?tipo=white')
    expect(await screen.findByText('João Lima')).toBeInTheDocument()
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
    expect(screen.getAllByText('Abastecimento aguardando conferência')).toHaveLength(2)
    expect(screen.getByText('03/11/2026')).toBeInTheDocument()
  })
  it('item de conferência navega para a âncora', async () => {
    const user = userEvent.setup()
    renderAt('/admin/pendencias?tipo=white')
    await user.click((await screen.findByText('João Lima')).closest('button')!)
    expect(await screen.findByText('at:/admin/conferencia#item-f2')).toBeInTheDocument()
  })
  it('quinzena navega para quinzenas do motorista', async () => {
    const user = userEvent.setup()
    renderAt('/admin/pendencias?tipo=red')
    await user.click((await screen.findByText('Ana')).closest('button')!)
    expect(await screen.findByText('at:/admin/quinzenas?motorista=d9')).toBeInTheDocument()
  })
})
