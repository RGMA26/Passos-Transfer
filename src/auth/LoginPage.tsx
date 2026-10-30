import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../lib/auth'

export default function LoginPage() {
  const { signIn, notice } = useAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await signIn(login, password)
    if (res.error) setError(res.error)
    setBusy(false)
  }

  const message = error ?? notice

  return (
    <main className="auth-page">
      <form className="card" onSubmit={onSubmit}>
        <h1>Passos Transfer</h1>
        <label htmlFor="login">Código de acesso</label>
        <input
          id="login"
          autoCapitalize="characters"
          autoComplete="username"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {message && (
          <p role="alert" className="error">
            {message}
          </p>
        )}
        <button type="submit" disabled={busy}>
          Entrar
        </button>
      </form>
    </main>
  )
}
