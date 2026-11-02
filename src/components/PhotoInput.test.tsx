import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhotoInput from './PhotoInput'
import { compressImage } from '../lib/photos'

vi.mock('../lib/photos', () => ({ compressImage: vi.fn() }))

beforeEach(() => vi.clearAllMocks())

describe('PhotoInput', () => {
  it('falha na compressão mostra aviso e limpa a foto', async () => {
    vi.mocked(compressImage).mockRejectedValue(new Error('corrupt'))
    const onChange = vi.fn()
    render(<PhotoInput label="Foto" onChange={onChange} />)
    await userEvent.upload(screen.getByLabelText('Foto'), new File(['x'], 'p.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível usar esta foto. Tente outra.')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('foto boa não mostra aviso', async () => {
    vi.mocked(compressImage).mockResolvedValue(new Blob(['y']))
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const onChange = vi.fn()
    render(<PhotoInput label="Foto" onChange={onChange} />)
    await userEvent.upload(screen.getByLabelText('Foto'), new File(['x'], 'p.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByAltText('Pré-visualização')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
