import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CarExpenses, { installmentsPreview } from './CarExpenses'
import * as api from '../lib/api'
import type { Car } from '../lib/types'

vi.mock('../lib/api', () => ({
  listCarExpenses: vi.fn(),
  createCarExpense: vi.fn(),
  updateCarExpense: vi.fn(),
  finishCarExpense: vi.fn(),
  deleteCarExpense: vi.fn(),
}))
const m = vi.mocked(api)

const car = { id: 'c1', model: 'Corolla', plate: 'ABC1D23', ownership: 'company' } as Car
const exp = (over: Partial<api.CarExpense> = {}): api.CarExpense =>
  ({
    id: 'e1',
    car_id: 'c1',
    kind: 'maintenance',
    description: 'Revisão',
    mode: 'single',
    amount: 500,
    installments: null,
    start_date: '2026-11-05',
    end_date: null,
    finished: false,
    deleted_on: null,
    created_at: '',
    ...over,
  }) as api.CarExpense

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listCarExpenses.mockResolvedValue([])
  m.createCarExpense.mockResolvedValue()
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

async function ready() {
  const user = userEvent.setup()
  render(<CarExpenses car={car} onClose={() => {}} />)
  await screen.findByText('Nenhum gasto cadastrado.')
  return user
}
const novo = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Adicionar gasto' }))

describe('prévia de parcelas', () => {
  it('3× R$ 333,33 (última R$ 333,34)', () => {
    expect(installmentsPreview(1000, 3).replace(/ /g, ' ')).toBe('3× R$ 333,33 (última R$ 333,34)')
  })
  it('divisão exata não menciona a última', () => {
    expect(installmentsPreview(1200, 10).replace(/ /g, ' ')).toBe('10× R$ 120,00')
  })
})

describe('formulário de gasto', () => {
  it('oferece Manutenção, Seguro, Imposto e Outro e as três formas', async () => {
    const user = await ready()
    await novo(user)
    const kinds = within(screen.getByLabelText('Tipo do gasto')).getAllByRole('option').map((o) => o.textContent)
    expect(kinds).toEqual(['Manutenção', 'Seguro', 'Imposto', 'Outro'])
    const modes = within(screen.getByLabelText('Forma')).getAllByRole('option').map((o) => o.textContent)
    expect(modes).toEqual(['Pontual', 'Parcelado', 'Recorrente'])
  })

  it.each(['tax', 'other'])('descrição é obrigatória em %s', async (kind) => {
    const user = await ready()
    await novo(user)
    await user.selectOptions(screen.getByLabelText('Tipo do gasto'), kind)
    await user.type(screen.getByLabelText('Valor'), '100')
    await user.click(screen.getByRole('button', { name: 'Salvar gasto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Descreva o gasto')
    expect(m.createCarExpense).not.toHaveBeenCalled()
  })

  it('manutenção sem descrição salva pontual', async () => {
    const user = await ready()
    await novo(user)
    await user.type(screen.getByLabelText('Valor'), '1.234,50')
    await user.click(screen.getByRole('button', { name: 'Salvar gasto' }))
    await waitFor(() =>
      expect(m.createCarExpense).toHaveBeenCalledWith({
        car_id: 'c1',
        kind: 'maintenance',
        description: null,
        mode: 'single',
        amount: 1234.5,
        installments: null,
        start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
  })

  it('parcelado exige 2+ parcelas e mostra a prévia', async () => {
    const user = await ready()
    await novo(user)
    await user.selectOptions(screen.getByLabelText('Forma'), 'installments')
    await user.type(screen.getByLabelText('Valor'), '1000')
    await user.type(screen.getByLabelText('Parcelas'), '1')
    await user.click(screen.getByRole('button', { name: 'Salvar gasto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe pelo menos 2 parcelas')
    await user.clear(screen.getByLabelText('Parcelas'))
    await user.type(screen.getByLabelText('Parcelas'), '3')
    expect(screen.getByText(/3× R\$\s333,33 \(última R\$\s333,34\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Salvar gasto' }))
    await waitFor(() =>
      expect(m.createCarExpense).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'installments', amount: 1000, installments: 3 }),
      ),
    )
  })

  it('recorrente salva sem parcelas', async () => {
    const user = await ready()
    await novo(user)
    await user.selectOptions(screen.getByLabelText('Tipo do gasto'), 'insurance')
    await user.selectOptions(screen.getByLabelText('Forma'), 'recurring')
    expect(screen.queryByLabelText('Parcelas')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Valor'), '300')
    await user.click(screen.getByRole('button', { name: 'Salvar gasto' }))
    await waitFor(() =>
      expect(m.createCarExpense).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'insurance', mode: 'recurring', amount: 300, installments: null }),
      ),
    )
  })
})

describe('lista', () => {
  it('recorrente ativo tem Finalizar, que pede o último mês', async () => {
    m.listCarExpenses.mockResolvedValue([exp({ mode: 'recurring', kind: 'insurance', description: null })])
    m.finishCarExpense.mockResolvedValue()
    const user = userEvent.setup()
    render(<CarExpenses car={car} onClose={() => {}} />)
    expect(await screen.findByText(/Recorrente – ativo/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Finalizar' }))
    const month = screen.getByLabelText('Último mês que conta') as HTMLInputElement
    expect(month.value).toMatch(/^\d{4}-\d{2}$/)
    await user.click(screen.getByRole('button', { name: 'Confirmar fim do gasto' }))
    await waitFor(() => expect(m.finishCarExpense).toHaveBeenCalledWith('e1', `${month.value}-01`))
  })

  it('pontual não tem Finalizar; recorrente finalizado também não', async () => {
    m.listCarExpenses.mockResolvedValue([
      exp(),
      exp({ id: 'e2', mode: 'recurring', finished: true, end_date: '2026-12-01' }),
    ])
    render(<CarExpenses car={car} onClose={() => {}} />)
    expect(await screen.findByText(/finalizado em 12\/2026/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finalizar' })).toBeNull()
  })

  it('excluir confirma com o texto do spec e o item vai para Excluídos', async () => {
    m.listCarExpenses.mockResolvedValueOnce([exp()])
    m.deleteCarExpense.mockResolvedValue()
    m.listCarExpenses.mockResolvedValue([exp({ deleted_on: '2026-11-02' })])
    const user = userEvent.setup()
    render(<CarExpenses car={car} onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Excluir gasto' }))
    expect(confirmSpy).toHaveBeenCalledWith(
      'Excluir este gasto? Ele deixa de contar a partir deste mês; os meses anteriores continuam registrados.',
    )
    await waitFor(() => expect(m.deleteCarExpense).toHaveBeenCalledWith('e1'))
    expect(await screen.findByText('Excluídos')).toBeInTheDocument()
    expect(screen.getByText(/excluído em 02\/11\/2026/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir gasto' })).toBeNull()
  })

  it('excluir cancelado não chama o servidor', async () => {
    confirmSpy.mockReturnValue(false)
    m.listCarExpenses.mockResolvedValue([exp()])
    const user = userEvent.setup()
    render(<CarExpenses car={car} onClose={() => {}} />)
    await user.click(await screen.findByRole('button', { name: 'Excluir gasto' }))
    expect(m.deleteCarExpense).not.toHaveBeenCalled()
  })
})
