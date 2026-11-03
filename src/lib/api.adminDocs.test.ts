import { describe, it, expect, vi, beforeEach } from 'vitest'

const upload = vi.fn()
const remove = vi.fn()
const rpc = vi.fn()
const insert = vi.fn()
const updateEq = vi.fn()
const update = vi.fn()
const invoke = vi.fn()

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    storage: { from: () => ({ upload, remove }) },
    from: () => ({
      insert: (v: unknown) => insert(v),
      update: (v: unknown) => {
        update(v)
        return { eq: updateEq }
      },
    }),
  },
}))
import {
  deleteCarExpense,
  finishCarExpense,
  pauseDriver,
  resumeDriver,
  updateDriver,
  uploadAdminDocument,
} from './api'

beforeEach(() => {
  vi.clearAllMocks()
  upload.mockResolvedValue({ error: null })
  insert.mockResolvedValue({ error: null })
  updateEq.mockResolvedValue({ data: null, error: null })
})

const pdf = (size = 100) => new File([new Uint8Array(size)], 'a.pdf', { type: 'application/pdf' })

describe('uploadAdminDocument', () => {
  it('envia para admin-docs em {driver}/{uuid}.ext e grava a linha', async () => {
    await uploadAdminDocument({ driverId: 'd1', statementId: 's1', kind: 'payment_proof', file: pdf() })
    expect(upload.mock.calls[0][0]).toMatch(/^d1\/[0-9a-f-]{36}\.pdf$/)
    expect(insert).toHaveBeenCalledWith({
      driver_id: 'd1',
      statement_id: 's1',
      kind: 'payment_proof',
      description: null,
      file_path: upload.mock.calls[0][0],
      mime_type: 'application/pdf',
      size_bytes: 100,
    })
  })

  it('recusa tipo inválido e arquivo acima de 10 MB sem enviar', async () => {
    const gif = new File(['x'], 'a.gif', { type: 'image/gif' })
    await expect(uploadAdminDocument({ driverId: 'd1', kind: 'other', description: 'x', file: gif })).rejects.toMatchObject({
      code: 'INVALID_FILE',
    })
    await expect(
      uploadAdminDocument({ driverId: 'd1', kind: 'other', description: 'x', file: pdf(10 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('se a linha falha, remove o arquivo enviado', async () => {
    insert.mockResolvedValue({ error: { message: 'x', code: '42501' } })
    await expect(uploadAdminDocument({ driverId: 'd1', kind: 'other', description: 'x', file: pdf() })).rejects.toBeTruthy()
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]])
  })
})

describe('pausa e retomada', () => {
  it('envia todos os parâmetros e usa a mensagem como código', async () => {
    rpc.mockResolvedValue({ error: null })
    await pauseDriver('d1', '2026-11-02', 'Doença')
    expect(rpc).toHaveBeenCalledWith('pause_driver', { p_driver: 'd1', p_paused_on: '2026-11-02', p_reason: 'Doença' })
    rpc.mockResolvedValue({ error: { message: 'OPEN_SHIFTS', code: 'P0001' } })
    await expect(pauseDriver('d1', '2026-11-02', '')).rejects.toMatchObject({ code: 'OPEN_SHIFTS' })
    rpc.mockResolvedValue({ error: { message: 'INVALID_DATE', code: 'P0001' } })
    await expect(resumeDriver('d1', '2026-11-01')).rejects.toMatchObject({ code: 'INVALID_DATE' })
    expect(rpc).toHaveBeenLastCalledWith('resume_driver', { p_driver: 'd1', p_resume_on: '2026-11-01' })
  })
})

describe('gastos e edição', () => {
  it('excluir grava deleted_on = hoje (SP)', async () => {
    await deleteCarExpense('e1')
    expect(update).toHaveBeenCalledWith({ deleted_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(updateEq).toHaveBeenCalledWith('id', 'e1')
  })

  it('finalizar grava o dia 1 do último mês e finished', async () => {
    await finishCarExpense('e1', '2026-12-17')
    expect(update).toHaveBeenCalledWith({ end_date: '2026-12-01', finished: true })
  })

  it('updateDriver chama update-driver e mapeia o código de erro', async () => {
    invoke.mockResolvedValue({ data: {}, error: null })
    const input = {
      name: 'A',
      phone: '1',
      cpf: '52998224725',
      driver_type: 'own_car' as const,
      uber_pct: null,
      transfer_pct: 60,
      car_id: null,
    }
    await updateDriver('d1', input)
    expect(invoke).toHaveBeenCalledWith('update-driver', { body: { driver_id: 'd1', ...input } })
    invoke.mockResolvedValue({ data: null, error: { context: { json: async () => ({ error: 'CPF_TAKEN' }) } } })
    await expect(updateDriver('d1', input)).rejects.toMatchObject({ code: 'CPF_TAKEN' })
    invoke.mockResolvedValue({ data: null, error: new Error('boom') })
    await expect(updateDriver('d1', input)).rejects.toMatchObject({ code: 'UPDATE_FAILED' })
  })
})
