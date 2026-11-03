import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LaunchTab from './LaunchTab'
import { makeProfile, photoFile } from './testUtils'
import * as api from '../lib/api'
import { enqueue, listOps } from '../lib/offline/queue'
import { clearSharedFile, peekSharedFile } from '../lib/share'

let profile = makeProfile()
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile }),
}))
vi.mock('../lib/api', () => ({
  getOpenShift: vi.fn(),
  getShiftRides: vi.fn(),
  getCar: vi.fn(),
  listMyTransfers: vi.fn(),
}))
vi.mock('../lib/offline/queue', () => ({
  enqueue: vi.fn(async () => {}),
  listOps: vi.fn(async () => []),
  onQueueChange: vi.fn(() => () => {}),
}))
vi.mock('../lib/share', () => ({
  peekSharedFile: vi.fn(async () => null),
  clearSharedFile: vi.fn(async () => {}),
}))
vi.mock('../components/ReceiptInput', async () => ({
  default: (await import('./testUtils')).FakeReceiptInput,
}))

const mApi = vi.mocked(api)
const mEnqueue = vi.mocked(enqueue)
const mList = vi.mocked(listOps)
const norm = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')

const car = (fuel_type: string) => ({ id: 'c1', model: 'Onix', plate: 'ABC1D23', fuel_type }) as never
const transfer = (id: string, status: string, client: string) =>
  ({ id, client_name: client, transfer_status: status, scheduled_at: '2026-11-02T13:00:00Z' }) as never

function ui(path = '/m/lancar') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LaunchTab />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  profile = makeProfile()
  mList.mockResolvedValue([])
  mApi.getOpenShift.mockResolvedValue({
    id: 's1',
    odometer_start: 1,
    started_at: '2026-10-30T10:00:00Z',
  } as never)
  mApi.getShiftRides.mockResolvedValue([])
  mApi.getCar.mockResolvedValue(car('flex'))
  mApi.listMyTransfers.mockResolvedValue([])
})

describe('LaunchTab', () => {
  it('carro próprio: Abastecimento sem turno com aviso, Pedágio e Estacionamento; sem Uber/BlaBlaCar', async () => {
    profile = makeProfile({ driver_type: 'own_car' })
    ui()
    expect(
      await screen.findByText('Usado para calcular a gasolina dos seus Transfers — não é reembolsado'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Valor total')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pedágio' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Estacionamento' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Uber' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'BlaBlaCar' })).toBeNull()
    expect(mApi.getOpenShift).not.toHaveBeenCalled()
  })

  it('sem turno aberto Uber e BlaBlaCar ficam desabilitados', async () => {
    mApi.getOpenShift.mockResolvedValue(null)
    ui()
    expect(await screen.findByText('Inicie um turno para lançar corridas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Uber' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'BlaBlaCar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Abastecimento' })).toBeEnabled()
    expect(screen.queryByText(/não é reembolsado/)).toBeNull()
  })

  it('start_shift pendente habilita Uber', async () => {
    mApi.getOpenShift.mockRejectedValue(new TypeError('offline'))
    mList.mockResolvedValue([
      {
        id: 'o1',
        kind: 'start_shift',
        ownerId: 'u1',
        status: 'pending',
        createdAt: 1,
        photos: [],
        payload: { id: 'sp', odometer: 1 },
      },
    ])
    ui()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Uber' })).toBeEnabled())
  })

  it('Uber exige valor, km e comprovante; reseta o formulário', async () => {
    const u = userEvent.setup()
    ui()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Uber' })).toBeEnabled())
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
    await u.type(screen.getByLabelText('Valor líquido'), '25,50')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Informe o km')).toBeInTheDocument()
    await u.type(screen.getByLabelText('Km'), '12')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(screen.getByText('Adicione o comprovante')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
    await u.upload(screen.getByLabelText('Comprovante'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('insert_ride')
    expect(op.ownerId).toBe('u1')
    expect(op.payload).toMatchObject({ id: op.id, driver_id: 'u1', platform: 'uber', amount: 25.5, km: 12 })
    expect(op.photos.map((p) => p.field)).toEqual(['receipt_path'])
    expect(await screen.findByText('Lançamento salvo')).toBeInTheDocument()
    expect(screen.getByLabelText('Valor líquido')).toHaveValue('')
  })

  it('BlaBlaCar usa "Valor recebido"', async () => {
    const u = userEvent.setup()
    ui()
    await waitFor(() => expect(screen.getByRole('button', { name: 'BlaBlaCar' })).toBeEnabled())
    await u.click(screen.getByRole('button', { name: 'BlaBlaCar' }))
    await u.type(screen.getByLabelText('Valor recebido'), '40')
    await u.type(screen.getByLabelText('Km'), '30')
    await u.upload(screen.getByLabelText('Comprovante'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalled())
    expect(mEnqueue.mock.calls[0][0].payload.platform).toBe('blablacar')
  })

  describe('Abastecimento', () => {
    async function openFueling() {
      const u = userEvent.setup()
      ui()
      await u.click(await screen.findByRole('button', { name: 'Abastecimento' }))
      return u
    }

    it('flex oferece gasolina e álcool; valida campos e envia', async () => {
      const u = await openFueling()
      const sel = await screen.findByLabelText('Combustível')
      await waitFor(() =>
        expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Gasolina', 'Álcool']),
      )
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
      await u.type(screen.getByLabelText('Valor total'), '247,60')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Informe a quantidade')).toBeInTheDocument()
      await u.type(screen.getByLabelText('Quantidade (L)'), '40')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Informe o preço por L')).toBeInTheDocument()
      await u.type(screen.getByLabelText('Preço por L'), '6,19')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Adicione o comprovante')).toBeInTheDocument()
      expect(mEnqueue).not.toHaveBeenCalled()
      await u.selectOptions(sel, 'alcool')
      await u.upload(screen.getByLabelText('Comprovante'), photoFile())
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
      const op = mEnqueue.mock.calls[0][0]
      expect(op.kind).toBe('insert_fueling')
      expect(op.payload).toMatchObject({
        driver_id: 'u1',
        car_id: 'c1',
        fuel: 'alcool',
        amount: 247.6,
        quantity: 40,
        unit_price: 6.19,
      })
      expect(op.photos.map((p) => p.field)).toEqual(['photo_path'])
    })

    it('valores conflitantes mostram a conta e "Salvar mesmo assim"', async () => {
      const u = await openFueling()
      await screen.findByLabelText('Combustível')
      await u.type(screen.getByLabelText('Valor total'), '274,60')
      await u.type(screen.getByLabelText('Quantidade (L)'), '40')
      await u.type(screen.getByLabelText('Preço por L'), '6,19')
      await u.upload(screen.getByLabelText('Comprovante'), photoFile())
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Valores conflitantes, confira a nota')).toBeInTheDocument()
      expect(
        screen.getByText((_, el) => el?.tagName === 'P' && norm(el.textContent) === '40 L × R$ 6,19 = R$ 247,60 ≠ R$ 274,60'),
      ).toBeInTheDocument()
      expect(mEnqueue).not.toHaveBeenCalled()
      await u.click(screen.getByRole('button', { name: 'Salvar mesmo assim' }))
      await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
      expect(mEnqueue.mock.calls[0][0].payload).toMatchObject({ amount: 274.6, quantity: 40, unit_price: 6.19 })
    })

    it('preço com 4 casas é arredondado a 3 antes de conferir e enviar', async () => {
      const u = await openFueling()
      await screen.findByLabelText('Combustível')
      await u.type(screen.getByLabelText('Valor total'), '10,10')
      await u.type(screen.getByLabelText('Quantidade (L)'), '2')
      await u.type(screen.getByLabelText('Preço por L'), '4,9996')
      await u.upload(screen.getByLabelText('Comprovante'), photoFile())
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.queryByText('Valores conflitantes, confira a nota')).toBeNull()
      await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
      expect(mEnqueue.mock.calls[0][0].payload).toMatchObject({ amount: 10.1, quantity: 2, unit_price: 5 })
    })

    it('carro GNV usa m³', async () => {
      mApi.getCar.mockResolvedValue(car('gnv'))
      const u = await openFueling()
      expect(await screen.findByLabelText('Quantidade (m³)')).toBeInTheDocument()
      expect(screen.getByLabelText('Preço por m³')).toBeInTheDocument()
      await u.type(screen.getByLabelText('Valor total'), '46')
      await u.type(screen.getByLabelText('Quantidade (m³)'), '10')
      await u.type(screen.getByLabelText('Preço por m³'), '4,60')
      await u.upload(screen.getByLabelText('Comprovante'), photoFile())
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
      expect(mEnqueue.mock.calls[0][0].payload).toMatchObject({ fuel: 'gnv', quantity: 10, unit_price: 4.6 })
    })

    it('flex com kit GNV (cars.fuels) oferece gasolina, álcool e GNV; GNV em m³', async () => {
      mApi.getCar.mockResolvedValue({ id: 'c1', model: 'Polo', plate: 'GDN9J12', fuel_type: null, fuels: ['gasolina', 'alcool', 'gnv'] } as never)
      const u = await openFueling()
      const sel = await screen.findByLabelText('Combustível')
      await waitFor(() =>
        expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Gasolina', 'Álcool', 'GNV']),
      )
      await u.selectOptions(sel, 'gnv')
      expect(screen.getByLabelText('Quantidade (m³)')).toBeInTheDocument()
      expect(screen.getByLabelText('Preço por m³')).toBeInTheDocument()
    })

    it('híbrido oferece gasolina e elétrico (kWh)', async () => {
      mApi.getCar.mockResolvedValue(car('hibrido'))
      const u = await openFueling()
      const sel = await screen.findByLabelText('Combustível')
      await waitFor(() =>
        expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Gasolina', 'Elétrico']),
      )
      await u.selectOptions(sel, 'eletrico')
      expect(screen.getByLabelText('Quantidade (kWh)')).toBeInTheDocument()
      expect(screen.getByLabelText('Preço por kWh')).toBeInTheDocument()
    })
  })

  describe('Pedágio e Estacionamento', () => {
    it('lista só Transfers em aberto e envia a despesa', async () => {
      mApi.listMyTransfers.mockResolvedValue([
        transfer('t1', 'assigned', 'Hotel Sol'),
        transfer('t2', 'in_progress', 'Pousada Mar'),
        transfer('t3', 'completed', 'Clínica Vida'),
        transfer('t4', 'checked', 'Antigo'),
      ])
      const u = userEvent.setup()
      ui()
      await u.click(await screen.findByRole('button', { name: 'Pedágio' }))
      const sel = await screen.findByLabelText('Transfer')
      const names = within(sel).getAllByRole('option').map((o) => o.textContent ?? '')
      expect(names.some((n) => n.includes('Hotel Sol'))).toBe(true)
      expect(names.some((n) => n.includes('Pousada Mar'))).toBe(true)
      expect(names.some((n) => n.includes('Clínica Vida'))).toBe(true)
      expect(names.some((n) => n.includes('Antigo'))).toBe(false)
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Escolha o Transfer')).toBeInTheDocument()
      await u.selectOptions(sel, 't2')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Informe um valor válido')).toBeInTheDocument()
      await u.type(screen.getByLabelText('Valor'), '12,40')
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      expect(screen.getByText('Adicione o comprovante')).toBeInTheDocument()
      await u.upload(screen.getByLabelText('Comprovante'), photoFile())
      await u.click(screen.getByRole('button', { name: 'Salvar' }))
      await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
      const op = mEnqueue.mock.calls[0][0]
      expect(op.kind).toBe('insert_expense')
      expect(op.payload).toMatchObject({ ride_id: 't2', kind: 'toll', amount: 12.4 })
      expect(op.photos.map((p) => p.field)).toEqual(['photo_path'])
    })

    it('sem Transfer em aberto mostra o aviso', async () => {
      mApi.listMyTransfers.mockResolvedValue([transfer('t4', 'checked', 'Antigo')])
      const u = userEvent.setup()
      ui()
      await u.click(await screen.findByRole('button', { name: 'Estacionamento' }))
      expect(await screen.findByText('Pedágio e estacionamento são lançados em um Transfer')).toBeInTheDocument()
      expect(screen.queryByLabelText('Valor')).toBeNull()
    })
  })

  it('pausado: aviso e nada pode ser lançado', async () => {
    profile = makeProfile({ paused: true })
    ui()
    expect(await screen.findByText('Seu cadastro está pausado. Fale com a empresa.')).toBeInTheDocument()
    for (const name of ['Uber', 'BlaBlaCar', 'Abastecimento', 'Pedágio', 'Estacionamento']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
  })

  it('arquivo compartilhado abre o formulário escolhido com o comprovante anexado', async () => {
    vi.mocked(peekSharedFile).mockResolvedValue(new File(['%PDF'], 'nota.pdf', { type: 'application/pdf' }))
    const u = userEvent.setup()
    ui('/m/lancar?tipo=fueling&compartilhado=1')
    expect(await screen.findByText('Anexado: nota.pdf')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abastecimento' })).toHaveAttribute('aria-pressed', 'true')
    await u.type(screen.getByLabelText('Valor total'), '100')
    await u.type(screen.getByLabelText('Quantidade (L)'), '20')
    await u.type(screen.getByLabelText('Preço por L'), '5')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    expect((mEnqueue.mock.calls[0][0].photos[0].blob as File).name).toBe('nota.pdf')
    await waitFor(() => expect(clearSharedFile).toHaveBeenCalled())
  })
})
