import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReceiptInput from './ReceiptInput'
import { compressImage } from '../lib/photos'

vi.mock('../lib/photos', () => ({ compressImage: vi.fn() }))

const MSG_TYPE = 'Envie JPG, PNG ou PDF de até 10 MB'

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

// upload sem filtrar pelo atributo accept (o celular pode entregar qualquer arquivo)
const user = () => userEvent.setup({ applyAccept: false })

describe('ReceiptInput', () => {
  it('aceita imagem e PDF', () => {
    render(<ReceiptInput label="Comprovante" onChange={vi.fn()} />)
    expect(screen.getByLabelText('Comprovante')).toHaveAttribute('accept', 'image/*,application/pdf')
  })

  it('imagem é comprimida e mostra miniatura', async () => {
    const small = new Blob(['y'], { type: 'image/jpeg' })
    vi.mocked(compressImage).mockResolvedValue(small)
    const onChange = vi.fn()
    render(<ReceiptInput label="Comprovante" onChange={onChange} />)
    await user().upload(screen.getByLabelText('Comprovante'), new File(['x'], 'n.png', { type: 'image/png' }))
    expect(await screen.findByAltText('Pré-visualização')).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(small)
  })

  it('PDF não é comprimido e mostra ícone e nome', async () => {
    const onChange = vi.fn()
    render(<ReceiptInput label="Comprovante" onChange={onChange} />)
    const pdf = new File(['%PDF'], 'nota.pdf', { type: 'application/pdf' })
    await user().upload(screen.getByLabelText('Comprovante'), pdf)
    expect(await screen.findByText('nota.pdf')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.queryByAltText('Pré-visualização')).toBeNull()
    expect(compressImage).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenLastCalledWith(pdf)
  })

  it('outro tipo é recusado', async () => {
    const onChange = vi.fn()
    render(<ReceiptInput label="Comprovante" onChange={onChange} />)
    await user().upload(screen.getByLabelText('Comprovante'), new File(['x'], 'a.txt', { type: 'text/plain' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_TYPE)
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('acima de 10 MB é recusado', async () => {
    const onChange = vi.fn()
    render(<ReceiptInput label="Comprovante" onChange={onChange} />)
    const big = new File(['x'], 'g.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 })
    await user().upload(screen.getByLabelText('Comprovante'), big)
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_TYPE)
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('imagem grande vale se ficar até 10 MB depois de comprimida', async () => {
    const small = new Blob(['y'], { type: 'image/jpeg' })
    vi.mocked(compressImage).mockResolvedValue(small)
    const onChange = vi.fn()
    render(<ReceiptInput label="Comprovante" onChange={onChange} />)
    const big = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 })
    await user().upload(screen.getByLabelText('Comprovante'), big)
    expect(await screen.findByAltText('Pré-visualização')).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(small)
  })

  it('imagem que continua acima de 10 MB depois de comprimida é recusada', async () => {
    const still = new Blob(['y'], { type: 'image/jpeg' })
    Object.defineProperty(still, 'size', { value: 10 * 1024 * 1024 + 1 })
    vi.mocked(compressImage).mockResolvedValue(still)
    const onChange = vi.fn()
    render(<ReceiptInput label="Comprovante" onChange={onChange} />)
    await user().upload(screen.getByLabelText('Comprovante'), new File(['x'], 'f.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(MSG_TYPE)
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('PDF sem tipo (só pelo nome .pdf) é aceito como PDF', async () => {
    const onChange = vi.fn()
    render(<ReceiptInput label="Comprovante" onChange={onChange} />)
    const pdf = new File(['%PDF'], 'NOTA.PDF', { type: '' })
    await user().upload(screen.getByLabelText('Comprovante'), pdf)
    expect(await screen.findByText('NOTA.PDF')).toBeInTheDocument()
    const sent = onChange.mock.lastCall?.[0] as File
    expect(sent.type).toBe('application/pdf')
    expect(sent.name).toBe('NOTA.PDF')
    expect(compressImage).not.toHaveBeenCalled()
  })

  it('arquivo inicial (compartilhado) já vem anexado', async () => {
    const onChange = vi.fn()
    const pdf = new File(['%PDF'], 'compartilhado.pdf', { type: 'application/pdf' })
    render(<ReceiptInput label="Comprovante" onChange={onChange} initialFile={pdf} />)
    expect(await screen.findByText('compartilhado.pdf')).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(pdf)
  })

  it('falha na compressão mostra aviso', async () => {
    vi.mocked(compressImage).mockRejectedValue(new Error('corrupt'))
    const onChange = vi.fn()
    render(<ReceiptInput label="Comprovante" onChange={onChange} />)
    await user().upload(screen.getByLabelText('Comprovante'), new File(['x'], 'p.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível usar esta foto. Tente outra.')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
