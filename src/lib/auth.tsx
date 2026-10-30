import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { getMyProfile } from './api'
import { loginToEmail } from './loginCode'
import type { Profile } from './types'

export const MSG_INVALID = 'Código ou senha inválidos'
export const MSG_DISABLED = 'Conta desativada'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (login: string, password: string) => Promise<{ error?: string }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  /** Mensagem exibida no login (ex.: conta desativada detectada após o login). */
  notice: string | null
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const userIdRef = useRef<string | null>(null)

  const loadProfile = useCallback(async (s: Session | null, silent = false) => {
    if (!s) {
      setProfile(null)
      return
    }
    try {
      const p = await getMyProfile(s.user.id)
      if (userIdRef.current !== s.user.id) return // resultado obsoleto
      if (p && p.active === false) {
        setNotice(MSG_DISABLED)
        userIdRef.current = null
        setProfile(null)
        setSession(null)
        await supabase.auth.signOut()
        return
      }
      setProfile(p)
    } catch {
      // refresh silencioso (ex.: offline ao refocar a aba) mantém o perfil atual
      if (!silent) setProfile(null)
    }
  }, [])

  useEffect(() => {
    let alive = true
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!alive) return
      setSession(s)
      if (!s) {
        userIdRef.current = null
        setProfile(null)
        setLoading(false)
        return
      }
      const sameUser = userIdRef.current === s.user.id
      userIdRef.current = s.user.id
      if (sameUser) {
        // mesmo usuário (refresh de token, refoco da aba): sem tela de loading
        if (_event !== 'TOKEN_REFRESHED') setTimeout(() => void loadProfile(s, true), 0)
        return
      }
      setLoading(true)
      // adiado para não bloquear o cliente de auth dentro do callback
      setTimeout(() => {
        void loadProfile(s).finally(() => {
          if (alive) setLoading(false)
        })
      }, 0)
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (login: string, password: string) => {
    setNotice(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: loginToEmail(login),
      password,
    })
    if (error) {
      return { error: /banned/i.test(error.message) ? MSG_DISABLED : MSG_INVALID }
    }
    return {}
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await loadProfile(data.session)
  }, [loadProfile])

  const value = useMemo(
    () => ({ session, profile, loading, signIn, signOut, refreshProfile, notice }),
    [session, profile, loading, signIn, signOut, refreshProfile, notice],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
