import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = ainda carregando
  const [perfil, setPerfil] = useState(null)

  async function carregarPerfil(userId) {
    if (!userId) return setPerfil(null)
    const { data } = await supabase.from('usuarios').select('*').eq('id', userId).maybeSingle()
    setPerfil(data)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      carregarPerfil(data.session?.user?.id)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      carregarPerfil(s?.user?.id)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function sair() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, perfil, recarregarPerfil: () => carregarPerfil(session?.user?.id), sair }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
