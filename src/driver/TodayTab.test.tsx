import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import TodayTab from './TodayTab'
import { makeProfile, photoFile } from './testUtils'
import * as api from '../lib/api'
import { enqueue, listOps, discardOp } from '../lib/offline/queue'

let profile = makeProfile()
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile }),
}))
vi.mock('../lib/api', () => ({
  getOpenShift: vi.fn(),
  getShiftRides: vi.fn(),
  getTodaySummary: vi.fn(),
  getCar: vi.fn(),
  getLastCarReading: vi.fn(async () => null),
  endShift: vi.fn(),
  listTodayEntries: vi.fn(async () => []),
}))
vi.mock('../lib/offline/queue', () => ({
  enqueue: vi.fn(async () => {}),
  listOps: vi.fn(async () => []),
  discardOp: vi.fn(async () => {}),
  onQueueChange: vi.fn(() => () => {}),
}))
vi.mock('../components/PhotoInput', async () => ({
  default: (await import('./testUtils')).FakePhotoInput,
}))

const car = { id: 'c1', model: 'Corolla', plate: 'ABC1D23', fuel_type: 'flex', km_per_l_gasolina: 10 }
const openShift = {
  id: 's1',
  odometer_start: 1000,
  started_at: '2026-10-30T10:00:00Z',
  ended_at: null,
}
const summary = {
  byPlatform: { uber: 150, blablacar: 50, transfer: 0 },
  kmService: 80,
  fueled: 100,
}

const mApi = vi.mocked(api)
const mEnqueue = vi.mocked(enqueue)
const mList = vi.mocked(listOps)
const mDiscard = vi.mocked(discardOp)

function ui() {
  return render(
    <MemoryRouter>
      <TodayTab />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  profile = makeProfile()
  mList.mockResolvedValue([])
  mApi.getOpenShift.mockResolvedValue(null)
  mApi.getShiftRides.mockResolvedValue([])
  mApi.getTodaySummary.mockResolvedValue(summary)
  mApi.getCar.mockResolvedValue(car as never)
  mApi.listTodayEntries.mockResolvedValue([])
  mApi.getLastCarReading.mockResolvedValue(null)
})

describe('TodayTab', () => {
  it('carro da empresa sem turno mostra carro e Iniciar turno', async () => {
    ui()
    expect(await screen.findByRole('button', { name: 'Iniciar turno' })).toBeInTheDocument()
    expect(await screen.findByText('Corolla – ABC1D23')).toBeInTheDocument()
  })

  it('odômetro sem foto não envia', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '1000')
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    expect(screen.getByText('Adicione a foto do odômetro')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('inicia turno enfileirando start_shift com dono e foto', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '1000')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('start_shift')
    expect(op.ownerId).toBe('u1')
    expect(op.payload).toMatchObject({ car_id: 'c1', odometer: 1000 })
    expect(op.payload.id).toBe(op.id)
    expect(op.photos[0].field).toBe('photo')
  })

  it('sem carro vinculado mostra aviso e nenhum botão de iniciar', async () => {
    profile = makeProfile({ current_car_id: null })
    ui()
    expect(await screen.findByText('Nenhum carro vinculado. Fale com a empresa.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).not.toBeInTheDocument()
  })

  it('com turno aberto mostra resumo e Encerrar turno', async () => {
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    ui()
    expect(await screen.findByRole('button', { name: 'Encerrar turno' })).toBeInTheDocument()
    expect(await screen.findByText(/R\$\s*150,00/)).toBeInTheDocument()
  })

  it('start_shift pendente (offline) já mostra Encerrar turno', async () => {
    mList.mockResolvedValue([
      {
        id: 'o1',
        kind: 'start_shift',
        ownerId: 'u1',
        status: 'pending',
        createdAt: Date.now() * 1000,
        photos: [],
        payload: { id: 'sp', car_id: 'c1', odometer: 500 },
      },
    ])
    mApi.getOpenShift.mockRejectedValue(new TypeError('offline'))
    ui()
    expect(await screen.findByRole('button', { name: 'Encerrar turno' })).toBeInTheDocument()
  })

  it('abertura sem rede usa o último turno aberto visto no servidor', async () => {
    mApi.getOpenShift.mockResolvedValue({ ...openShift, driver_id: 'u1' } as never)
    const first = ui()
    expect(await screen.findByRole('button', { name: 'Encerrar turno' })).toBeInTheDocument()
    first.unmount()

    mApi.getOpenShift.mockRejectedValue(new TypeError('offline'))
    mApi.getTodaySummary.mockRejectedValue(new TypeError('offline'))
    ui()
    expect(await screen.findByRole('button', { name: 'Encerrar turno' })).toBeInTheDocument()
  })

  it('turno encerrado no servidor limpa o cache', async () => {
    localStorage.setItem('passos.openShift.u1', JSON.stringify({ ...openShift, driver_id: 'u1' }))
    mApi.getOpenShift.mockResolvedValue(null)
    ui()
    expect(await screen.findByRole('button', { name: 'Iniciar turno' })).toBeInTheDocument()
    expect(localStorage.getItem('passos.openShift.u1')).toBeNull()
  })

  it('odômetro final menor que o inicial é recusado', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '900')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(
      screen.getByText('O odômetro final não pode ser menor que o inicial'),
    ).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })

  it('com Uber no turno exige o print dos ganhos', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    mApi.getShiftRides.mockResolvedValue([{ id: 'r1', platform: 'uber' }] as never)
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1100')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(screen.getByText('Adicione o print dos ganhos da Uber')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
    await u.upload(screen.getByLabelText('Print dos ganhos da Uber'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.kind).toBe('end_shift')
    expect(op.payload).toMatchObject({ shift_id: 's1', odometer: 1100 })
    expect(op.photos.map((p) => p.field)).toEqual(['photo', 'uber_photo'])
  })

  it('Uber pendente na fila também exige o print', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    mList.mockResolvedValue([
      {
        id: 'o2',
        kind: 'insert_ride',
        ownerId: 'u1',
        status: 'pending',
        createdAt: Date.now() * 1000,
        photos: [],
        payload: { platform: 'uber', amount: 10, km: 5 },
      },
    ])
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1100')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(screen.getByText('Adicione o print dos ganhos da Uber')).toBeInTheDocument()
  })

  it('após encerrar mostra o resumo do servidor', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    mApi.endShift.mockResolvedValue({
      km_total: 120,
      km_service: 90,
      km_off: 30,
      off_discount_estimate: 25.5,
    })
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1120')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(await screen.findByText('Km total')).toBeInTheDocument()
    expect(screen.getByText('Km em serviço')).toBeInTheDocument()
    expect(screen.getByText('Km por fora')).toBeInTheDocument()
    expect(screen.getByText('Desconto da gasolina')).toBeInTheDocument()
    expect(screen.getByText(/R\$\s*25,50/)).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
  })

  it('end_shift ainda na fila mostra km total local e aviso', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1120')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    mList.mockResolvedValue([
      {
        id: 'o3',
        kind: 'end_shift',
        ownerId: 'u1',
        status: 'pending',
        createdAt: Date.now() * 1000,
        photos: [],
        payload: { shift_id: 's1', odometer: 1120 },
      },
    ])
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    expect(
      await screen.findByText('Resumo completo quando o turno for enviado'),
    ).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(mApi.endShift).not.toHaveBeenCalled()
  })

  it('encerrar sem Uber enfileira uber_photo null', async () => {
    const u = userEvent.setup()
    mApi.getOpenShift.mockResolvedValue(openShift as never)
    ui()
    await u.type(await screen.findByLabelText('Odômetro final'), '1100')
    await u.upload(screen.getByLabelText('Foto do odômetro final'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Encerrar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    const op = mEnqueue.mock.calls[0][0]
    expect(op.payload.uber_photo).toBeNull()
    expect('uber_photo' in op.payload).toBe(true)
  })

  it('dois toques rápidos em Iniciar turno enfileiram uma vez', async () => {
    const u = userEvent.setup()
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '1000')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    const b = screen.getByRole('button', { name: 'Iniciar turno' })
    await u.dblClick(b)
    await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
    expect(mEnqueue).toHaveBeenCalledTimes(1)
  })

  it('pausado vê o aviso e não inicia turno', async () => {
    profile = makeProfile({ paused: true })
    ui()
    expect(await screen.findByText('Seu cadastro está pausado. Fale com a empresa.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).not.toBeInTheDocument()
  })

  it('carro próprio vê Transfers pendentes e não vê turno', async () => {
    profile = makeProfile({ driver_type: 'own_car', current_car_id: null })
    ui()
    expect(await screen.findByText('Transfers pendentes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).not.toBeInTheDocument()
  })

  describe('Lançamentos de hoje', () => {
    const entries: api.TodayEntry[] = [
      { kind: 'ride', id: 'r1', platform: 'uber', amount: 100, km: 30, quantity: null, unit_price: null, editable: true },
      { kind: 'ride', id: 'r2', platform: 'blablacar', amount: 40, km: 20, quantity: null, unit_price: null, editable: false },
      { kind: 'fueling', id: 'f1', amount: 200, fuel: 'gasolina', quantity: 40, unit_price: 5, km: null, editable: true },
    ]
    let confirmSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      mApi.getOpenShift.mockResolvedValue(openShift as never)
      mApi.listTodayEntries.mockResolvedValue(entries)
      confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    })
    afterEach(() => confirmSpy.mockRestore())

    const item = async (text: RegExp) =>
      within((await screen.findByText(text)).closest('li') as HTMLElement)

    it('lista corridas e abastecimentos; só os editáveis têm Editar/Excluir', async () => {
      ui()
      const list = within(await screen.findByRole('region', { name: 'Lançamentos de hoje' }))
      expect(list.getByText(/Uber R\$\s100,00 · 30 km/)).toBeInTheDocument()
      expect(list.getByText(/Abastecimento R\$\s200,00 · Gasolina 40 L × R\$\s5,00/)).toBeInTheDocument()
      expect(list.getAllByRole('button', { name: 'Editar' })).toHaveLength(2)
      const locked = await item(/BlaBlaCar R\$\s40,00/)
      expect(locked.queryByRole('button', { name: 'Editar' })).toBeNull()
      expect(locked.getByText(/conferido/)).toBeInTheDocument()
    })

    it('Editar corrida enfileira update_ride com valor e km', async () => {
      const u = userEvent.setup()
      ui()
      const r = await item(/Uber R\$\s100,00/)
      await u.click(r.getByRole('button', { name: 'Editar' }))
      await u.clear(r.getByLabelText('Valor'))
      await u.type(r.getByLabelText('Valor'), '90,50')
      await u.clear(r.getByLabelText('Km'))
      await u.type(r.getByLabelText('Km'), '25')
      await u.click(r.getByRole('button', { name: 'Salvar alteração' }))
      await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
      expect(mEnqueue.mock.calls[0][0]).toMatchObject({
        kind: 'update_ride',
        ownerId: 'u1',
        payload: { id: 'r1', amount: 90.5, km: 25 },
      })
    })

    it('Editar abastecimento enfileira update_fueling com valor, quantidade e preço', async () => {
      const u = userEvent.setup()
      ui()
      const f = await item(/Abastecimento R\$\s200,00/)
      await u.click(f.getByRole('button', { name: 'Editar' }))
      await u.clear(f.getByLabelText('Quantidade (L)'))
      await u.type(f.getByLabelText('Quantidade (L)'), '38,5')
      await u.clear(f.getByLabelText('Preço por L'))
      await u.type(f.getByLabelText('Preço por L'), '5,195')
      await u.click(f.getByRole('button', { name: 'Salvar alteração' }))
      await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
      expect(mEnqueue.mock.calls[0][0]).toMatchObject({
        kind: 'update_fueling',
        ownerId: 'u1',
        payload: { id: 'f1', amount: 200, quantity: 38.5, unit_price: 5.195 },
      })
    })

    it('Excluir pede confirmação e enfileira delete', async () => {
      const u = userEvent.setup()
      ui()
      const f = await item(/Abastecimento R\$\s200,00/)
      await u.click(f.getByRole('button', { name: 'Excluir' }))
      expect(confirmSpy).toHaveBeenCalledWith('Excluir este lançamento?')
      await waitFor(() => expect(mEnqueue).toHaveBeenCalledTimes(1))
      expect(mEnqueue.mock.calls[0][0]).toMatchObject({ kind: 'delete_fueling', ownerId: 'u1', payload: { id: 'f1' } })
    })

    it('cancelar a confirmação não exclui', async () => {
      confirmSpy.mockReturnValue(false)
      const u = userEvent.setup()
      ui()
      const r = await item(/Uber R\$\s100,00/)
      await u.click(r.getByRole('button', { name: 'Excluir' }))
      expect(mEnqueue).not.toHaveBeenCalled()
    })

    it('exclusão/edição pendentes na fila já aparecem na lista', async () => {
      const pending = (kind: string, payload: Record<string, unknown>) => ({
        id: crypto.randomUUID(), kind, ownerId: 'u1', status: 'pending', createdAt: Date.now() * 1000, photos: [], payload,
      })
      mList.mockResolvedValue([
        pending('delete_ride', { id: 'r1' }),
        pending('update_fueling', { id: 'f1', amount: 150, quantity: 30, unit_price: 5 }),
      ] as never)
      ui()
      const list = within(await screen.findByRole('region', { name: 'Lançamentos de hoje' }))
      expect(await list.findByText(/Abastecimento R\$\s150,00 · Gasolina 30 L/)).toBeInTheDocument()
      expect(list.queryByText(/Uber R\$\s100,00/)).toBeNull()
    })
  })
})

describe('TodayTab: início de turno recusado', () => {
  const failedStart = {
    id: 'f1',
    kind: 'start_shift',
    ownerId: 'u1',
    payload: { id: 's9', car_id: 'c1', odometer: 90000 },
    photos: [],
    status: 'failed',
    error: 'Não enviado: odômetro menor que o último registrado (101.500 km)',
    createdAt: 1,
  }

  it('mostra caixa vermelha com o motivo e NÃO "Encerrar turno"', async () => {
    mList.mockResolvedValue([failedStart] as never)
    ui()
    expect(await screen.findByText(/odômetro menor que o último registrado \(101\.500 km\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Encerrar turno' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Corrigir e tentar de novo' })).toBeInTheDocument()
  })

  it('Descartar remove a op falha', async () => {
    const u = userEvent.setup()
    mList.mockResolvedValue([failedStart] as never)
    ui()
    await u.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(mDiscard).toHaveBeenCalledWith('f1')
  })

  it('Corrigir abre o formulário com carro e odômetro vazio; ao enviar descarta a op falha', async () => {
    const u = userEvent.setup()
    mList.mockResolvedValue([failedStart] as never)
    ui()
    await u.click(await screen.findByRole('button', { name: 'Corrigir e tentar de novo' }))
    expect(await screen.findByText('Corolla – ABC1D23')).toBeInTheDocument()
    const field = screen.getByLabelText('Odômetro') as HTMLInputElement
    expect(field.value).toBe('')
    await u.type(field, '102000')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    await waitFor(() => expect(mEnqueue).toHaveBeenCalled())
    expect(mDiscard).toHaveBeenCalledWith('f1')
  })

  it('pré-valida contra a última leitura conhecida do carro', async () => {
    const u = userEvent.setup()
    mApi.getLastCarReading.mockResolvedValue(101500)
    ui()
    await u.type(await screen.findByLabelText('Odômetro'), '90000')
    await u.upload(screen.getByLabelText('Foto do odômetro'), photoFile())
    await waitFor(() => expect(mApi.getLastCarReading).toHaveBeenCalledWith('c1'))
    await u.click(screen.getByRole('button', { name: 'Iniciar turno' }))
    expect(await screen.findByText('O odômetro não pode ser menor que o último registrado (101.500 km)')).toBeInTheDocument()
    expect(mEnqueue).not.toHaveBeenCalled()
  })
})
