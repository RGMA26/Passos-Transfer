import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

type P = {
  id: string
  role: string
  active: boolean
  must_change_password: boolean
}

let session: { user: { id: string } } | null = null
let profileRow: P | null = null
let profileFail = false
const updateUser = vi.fn()
const rpc = vi.fn()
const signOut = vi.fn()
let authCb: ((e: string, s: unknown) => void) | null = null

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCb = cb
        setTimeout(() => cb('INITIAL_SESSION', session), 0)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      getSession: async () => ({ data: { session } }),
      updateUser: (...a: unknown[]) => updateUser(...a),
      signOut: (...a: unknown[]) => signOut(...a),
    },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => {
            if (profileFail) throw new TypeError('Failed to fetch')
            return { data: profileRow, error: null }
          } }),
      }),
    }),
  },
}))

import { AuthProvider } from './lib/auth'
import { AppRoutes, Guard } from './App'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  )
}

function login(p: Partial<P>) {
  session = { user: { id: 'u1' } }
  profileRow = { id: 'u1', role: 'driver', active: true, must_change_password: false, ...p }
}

describe('rotas por perfil', () => {
  beforeEach(() => {
    session = null
    profileRow = null
    updateUser.mockReset()
    rpc.mockReset()
    signOut.mockReset()
  })

  it('sem sessão vai para o login', async () => {
    renderAt('/m/hoje')
    expect(await screen.findByLabelText('Código de acesso')).toBeInTheDocument()
  })

  it('must_change_password redireciona para /primeiro-acesso', async () => {
    login({ must_change_password: true })
    renderAt('/m/hoje')
    expect(await screen.findByLabelText('Nova senha')).toBeInTheDocument()
  })

  it('motorista em /admin é redirecionado para /m/hoje', async () => {
    login({ role: 'driver' })
    renderAt('/admin')
    expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Extrato' })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })

  it('admin em /m/hoje é redirecionado para /admin', async () => {
    login({ role: 'admin' })
    renderAt('/m/hoje')
    expect(await screen.findByRole('link', { name: 'Quinzenas' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Início' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })

  it('motorista inativo é deslogado e vê "Conta desativada"', async () => {
    login({ active: false })
    renderAt('/m/hoje')
    expect(await screen.findByText('Conta desativada')).toBeInTheDocument()
    expect(signOut).toHaveBeenCalled()
  })
})

describe('primeiro acesso', () => {
  beforeEach(() => {
    updateUser.mockReset()
    rpc.mockReset()
    login({ must_change_password: true })
  })

  it('senha com 5 caracteres mostra erro e não chama updateUser', async () => {
    renderAt('/primeiro-acesso')
    await userEvent.type(await screen.findByLabelText('Nova senha'), '12345')
    await userEvent.type(screen.getByLabelText('Confirmar senha'), '12345')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(screen.getByText('A senha deve ter pelo menos 6 caracteres')).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('senhas diferentes mostram erro', async () => {
    renderAt('/primeiro-acesso')
    await userEvent.type(await screen.findByLabelText('Nova senha'), '123456')
    await userEvent.type(screen.getByLabelText('Confirmar senha'), '123457')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    expect(screen.getByText('As senhas não conferem')).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('senha válida atualiza, limpa a flag e entra na área do motorista', async () => {
    updateUser.mockResolvedValue({ error: null })
    rpc.mockImplementation(async () => {
      profileRow = { ...profileRow!, must_change_password: false }
      return { error: null }
    })
    renderAt('/primeiro-acesso')
    await userEvent.type(await screen.findByLabelText('Nova senha'), '123456')
    await userEvent.type(screen.getByLabelText('Confirmar senha'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha' }))
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: '123456' }))
    expect(rpc).toHaveBeenCalledWith('clear_must_change_password')
    expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
  })
})

describe('eventos de auth do mesmo usuário', () => {
  it('TOKEN_REFRESHED e SIGNED_IN não desmontam a página nem mostram Loading', async () => {
    login({ role: 'driver' })
    render(
      <MemoryRouter initialEntries={['/m/x']}>
        <AuthProvider>
          <Routes>
            <Route path="/m/x" element={<Guard area="driver"><input aria-label="campo" /></Guard>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    const input = await screen.findByLabelText('campo')
    await userEvent.type(input, 'abc')
    for (const ev of ['TOKEN_REFRESHED', 'SIGNED_IN']) {
      act(() => authCb!(ev, { user: { id: 'u1' } }))
      expect(screen.queryByText('Carregando...')).not.toBeInTheDocument()
    }
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Carregando...')).not.toBeInTheDocument()
    expect(screen.getByLabelText('campo')).toBe(input)
    expect(input).toHaveValue('abc')
  })
})

describe('refresh silencioso', () => {
  it('falha offline no refresh do mesmo usuário mantém a página', async () => {
    login({ role: 'driver' })
    render(
      <MemoryRouter initialEntries={['/m/x']}>
        <AuthProvider>
          <Routes>
            <Route path="/m/x" element={<Guard area="driver"><input aria-label="campo" /></Guard>} />
            <Route path="/login" element={<div>tela de login</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await screen.findByLabelText('campo')
    profileFail = true
    act(() => authCb!('SIGNED_IN', { user: { id: 'u1' } }))
    await new Promise((r) => setTimeout(r, 30))
    profileFail = false
    expect(screen.getByLabelText('campo')).toBeInTheDocument()
    expect(screen.queryByText('tela de login')).not.toBeInTheDocument()
  })
})
