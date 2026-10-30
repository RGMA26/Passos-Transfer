import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { clearMustChangePassword } from '../lib/api'
import { useAuth } from '../lib/auth'

export default function FirstAccessPage() {
  const { refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 6) return setError('A senha deve ter pelo menos 6 caracteres')
    if (password !== confirm) return setError('As senhas não conferem')
    setBusy(true)
    setError(null)
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password })
      if (upErr) throw upErr
      await clearMustChangePassword()
      await refreshProfile()
      navigate('/', { replace: true }) // a raiz leva para a área do perfil
    } catch {
      setError('Não foi possível alterar a senha. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <form className="card" onSubmit={onSubmit}>
        <h1>Primeiro acesso</h1>
        <p>Defina uma nova senha para continuar.</p>
        <label htmlFor="new-password">Nova senha</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label htmlFor="confirm-password">Confirmar senha</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          Salvar senha
        </button>
      </form>
    </main>
  )
}
