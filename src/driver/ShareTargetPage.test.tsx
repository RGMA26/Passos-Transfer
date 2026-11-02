import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import ShareTargetPage from './ShareTargetPage'
import { peekSharedFile } from '../lib/share'
import { manifest } from '../pwaManifest'

vi.mock('../lib/share', () => ({
  peekSharedFile: vi.fn(),
  clearSharedFile: vi.fn(async () => {}),
}))

function Where() {
  const loc = useLocation()
  return <p>{`Em: ${loc.pathname}${loc.search}`}</p>
}

function ui() {
  return render(
    <MemoryRouter initialEntries={['/m/compartilhar']}>
      <Routes>
        <Route path="/m/compartilhar" element={<ShareTargetPage />} />
        <Route path="/m/lancar" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('ShareTargetPage', () => {
  it('pergunta o que é o comprovante e abre o formulário certo', async () => {
    vi.mocked(peekSharedFile).mockResolvedValue(new File(['%PDF'], 'nota.pdf', { type: 'application/pdf' }))
    ui()
    expect(await screen.findByText('O que é este comprovante?')).toBeInTheDocument()
    expect(screen.getByText('nota.pdf')).toBeInTheDocument()
    for (const name of ['Abastecimento', 'Pedágio', 'Estacionamento', 'Corrida Uber', 'Corrida BlaBlaCar']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Abastecimento' }))
    expect(await screen.findByText('Em: /m/lancar?tipo=fueling&compartilhado=1')).toBeInTheDocument()
  })

  it.each([
    ['Pedágio', 'toll'],
    ['Estacionamento', 'parking'],
    ['Corrida Uber', 'uber'],
    ['Corrida BlaBlaCar', 'blablacar'],
  ])('%s → tipo=%s', async (name, kind) => {
    vi.mocked(peekSharedFile).mockResolvedValue(new File(['x'], 'p.jpg', { type: 'image/jpeg' }))
    ui()
    await userEvent.click(await screen.findByRole('button', { name }))
    expect(await screen.findByText(`Em: /m/lancar?tipo=${kind}&compartilhado=1`)).toBeInTheDocument()
  })

  it('sem arquivo pendente avisa', async () => {
    vi.mocked(peekSharedFile).mockResolvedValue(null)
    ui()
    expect(await screen.findByText('Nenhum arquivo recebido.')).toBeInTheDocument()
    expect(screen.queryByText('O que é este comprovante?')).toBeNull()
  })
})

describe('manifest', () => {
  it('declara o share_target para foto e PDF', () => {
    expect(manifest.share_target).toEqual({
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { files: [{ name: 'file', accept: ['image/*', 'application/pdf'] }] },
    })
  })
})
