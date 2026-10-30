import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const signInWithPassword = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: async () => ({ data: { session: null } }),
      signOut: vi.fn(),
    },
  },
}))

import { AuthProvider } from '../lib/auth'
import LoginPage from './LoginPage'

function setup() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => signInWithPassword.mockReset())

  it('chama signInWithPassword com o e-mail técnico do código', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    setup()
    await userEvent.type(screen.getByLabelText('Código de acesso'), 'PASSOS01JOAO')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'passos01joao@login.passostransfer.app',
        password: 'senha123',
      }),
    )
  })

  it('mostra erro para credenciais inválidas', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    setup()
    await userEvent.type(screen.getByLabelText('Código de acesso'), 'X')
    await userEvent.type(screen.getByLabelText('Senha'), 'y')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Código ou senha inválidos')).toBeInTheDocument()
  })

  it('mostra "Conta desativada" para usuário banido', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'User is banned' } })
    setup()
    await userEvent.type(screen.getByLabelText('Código de acesso'), 'X')
    await userEvent.type(screen.getByLabelText('Senha'), 'y')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Conta desativada')).toBeInTheDocument()
  })
})
