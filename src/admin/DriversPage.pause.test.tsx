import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DriversPage from './DriversPage'
import * as api from '../lib/api'
import type { Profile } from '../lib/types'

vi.mock('../lib/api', () => ({
  listDrivers: vi.fn(),
  listCars: vi.fn(),
  listDriverSignals: vi.fn(),
  pauseDriver: vi.fn(),
  resumeDriver: vi.fn(),
  listDriverPauses: vi.fn(),
  listAdminDocuments: vi.fn(),
  uploadAdminDocument: vi.fn(),
  deleteAdminDocument: vi.fn(),
  adminDocumentUrl: vi.fn(),
}))
const m = vi.mocked(api)

const driver = (over: Partial<Profile> = {}): Profile =>
  ({
    id: 'd1',
    role: 'driver',
    login_code: 'PASSOS01',
    name: 'Maria Souza',
    phone: '(11) 98888-7777',
    cpf: '52998224725',
    driver_type: 'company_car',
    uber_pct: 40,
    transfer_pct: 70,
    current_car_id: null,
    active: true,
    paused: false,
    ...over,
  }) as Profile

let confirmSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  m.listDrivers.mockResolvedValue([driver()])
  m.listCars.mockResolvedValue([])
  m.listDriverSignals.mockResolvedValue([])
  m.listDriverPauses.mockResolvedValue([])
  m.listAdminDocuments.mockResolvedValue([])
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => confirmSpy.mockRestore())

const err = (code: string) => Object.assign(new Error(code), { code })

async function ready() {
  const user = userEvent.setup()
  render(<DriversPage />)
  await screen.findByText('Maria Souza')
  return user
}

describe('sinais', () => {
  it('mostra 🔴, 🟡 e o selo Pausado conforme os sinais', async () => {
    m.listDrivers.mockResolvedValue([
      driver({ id: 'a', name: 'Ana' }),
      driver({ id: 'b', name: 'Beto' }),
      driver({ id: 'c', name: 'Caio', paused: true }),
    ])
    m.listDriverSignals.mockResolvedValue([
      { driver_id: 'a', signal: 'red' },
      { driver_id: 'b', signal: 'yellow' },
    ] as Awaited<ReturnType<typeof api.listDriverSignals>>)
    render(<DriversPage />)
    await screen.findByText('Ana')
    const row = (n: string) => within(screen.getByText(n).closest('tr')!)
    expect(await row('Ana').findByLabelText('Quinzena terminada sem fechamento')).toBeInTheDocument()
    expect(row('Beto').getByLabelText('Quinzena termina em até 5 dias')).toBeInTheDocument()
    expect(row('Caio').getByText('Pausado')).toBeInTheDocument()
  })

  it('falha nos sinais não derruba a lista', async () => {
    m.listDriverSignals.mockRejectedValue(new Error('x'))
    await ready()
  })
})

describe('pausa e retomada', () => {
  it('Pausar pede data (hoje) e motivo opcional e envia', async () => {
    m.pauseDriver.mockResolvedValue()
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    const date = screen.getByLabelText('Data da pausa') as HTMLInputElement
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await user.type(screen.getByLabelText('Motivo (opcional)'), 'Doença')
    await user.click(screen.getByRole('button', { name: 'Confirmar pausa' }))
    await waitFor(() => expect(m.pauseDriver).toHaveBeenCalledWith('d1', date.value, 'Doença'))
  })

  it.each([
    ['OPEN_SHIFTS', 'Encerre o turno aberto antes de pausar'],
    ['INVALID_DATE', 'A data da pausa não pode ser no futuro'],
    [
      'ENTRIES_AFTER_PAUSE',
      'Há lançamentos ou Transfers depois da data da pausa. Reatribua ou exclua antes de pausar.',
    ],
    ['ALREADY_PAUSED', 'A situação do motorista mudou. Atualize a página.'],
  ])('pausa: erro %s', async (code, text) => {
    m.pauseDriver.mockRejectedValue(err(code))
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Pausar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar pausa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  it('motorista pausado mostra Retomar (não Pausar) e pede a data de retorno', async () => {
    m.listDrivers.mockResolvedValue([driver({ paused: true })])
    m.resumeDriver.mockResolvedValue()
    const user = await ready()
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retomar' }))
    const date = screen.getByLabelText('Data de retorno') as HTMLInputElement
    await user.click(screen.getByRole('button', { name: 'Confirmar retorno' }))
    await waitFor(() => expect(m.resumeDriver).toHaveBeenCalledWith('d1', date.value))
  })

  it('retomar: INVALID_DATE e NOT_PAUSED', async () => {
    m.listDrivers.mockResolvedValue([driver({ paused: true })])
    m.resumeDriver.mockRejectedValueOnce(err('INVALID_DATE'))
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Retomar' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar retorno' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A data de retorno deve ser depois da pausa')
    m.resumeDriver.mockRejectedValueOnce(err('NOT_PAUSED'))
    await user.click(screen.getByRole('button', { name: 'Confirmar retorno' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('A situação do motorista mudou. Atualize a página.'),
    )
  })

  it('a ficha lista o histórico de pausas', async () => {
    m.listDriverPauses.mockResolvedValue([
      { id: 'p1', driver_id: 'd1', paused_on: '2026-10-01', resumed_on: '2026-10-10', reason: 'Viagem', created_at: '' },
    ])
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Ficha' }))
    expect(await screen.findByText('01/10/2026 – 10/10/2026 · Viagem')).toBeInTheDocument()
  })
})

describe('ficha: Documentos', () => {
  const doc = {
    id: 'x1',
    driver_id: 'd1',
    statement_id: null,
    kind: 'payment_proof',
    description: null,
    file_path: 'd1/a.pdf',
    mime_type: 'application/pdf',
    size_bytes: 10,
    created_at: '2026-11-02T15:00:00Z',
    created_by: null,
  }
  async function openDocs() {
    const user = await ready()
    await user.click(screen.getByRole('button', { name: 'Ficha' }))
    await user.click(screen.getByRole('tab', { name: 'Documentos' }))
    return user
  }

  it('lista, abre pelo link assinado e exclui com confirmação', async () => {
    m.listAdminDocuments.mockResolvedValue([doc] as never)
    m.adminDocumentUrl.mockResolvedValue('https://signed/x')
    m.deleteAdminDocument.mockResolvedValue()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const user = await openDocs()
    expect(m.listAdminDocuments).toHaveBeenCalledWith({ driverId: 'd1' })
    expect(await screen.findByText(/Comprovante de pagamento/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed/x', '_blank', 'noopener'))
    await user.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(confirmSpy).toHaveBeenCalledWith('Excluir este documento?')
    await waitFor(() => expect(m.deleteAdminDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' })))
    open.mockRestore()
  })

  it('adicionar exige descrição e envia kind other', async () => {
    m.uploadAdminDocument.mockResolvedValue()
    const user = await openDocs()
    await screen.findByText('Nenhum documento.')
    const file = new File(['%PDF'], 'contrato.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText('Arquivo'), file)
    await user.click(screen.getByRole('button', { name: 'Enviar documento' }))
    expect(await screen.findByText('Descreva o documento')).toBeInTheDocument()
    expect(m.uploadAdminDocument).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Descrição do documento'), 'Contrato')
    await user.click(screen.getByRole('button', { name: 'Enviar documento' }))
    await waitFor(() =>
      expect(m.uploadAdminDocument).toHaveBeenCalledWith({
        driverId: 'd1',
        kind: 'other',
        description: 'Contrato',
        file,
      }),
    )
  })

  it('arquivo de tipo inválido mostra a mensagem e não envia', async () => {
    const user = userEvent.setup({ applyAccept: false })
    render(<DriversPage />)
    await screen.findByText('Maria Souza')
    await user.click(screen.getByRole('button', { name: 'Ficha' }))
    await user.click(screen.getByRole('tab', { name: 'Documentos' }))
    await screen.findByText('Nenhum documento.')
    await user.type(screen.getByLabelText('Descrição do documento'), 'Foto')
    await user.upload(screen.getByLabelText('Arquivo'), new File(['x'], 'a.gif', { type: 'image/gif' }))
    await user.click(screen.getByRole('button', { name: 'Enviar documento' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Envie JPG, PNG ou PDF de até 10 MB')
    expect(m.uploadAdminDocument).not.toHaveBeenCalled()
  })
})
