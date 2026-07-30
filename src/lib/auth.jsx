import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = ainda carregando
  const [perfil, setPerfil] = useState(null)

  async function carregarPerfil(userId) {
    if (!userId) return setPerfil(null)
    try {
      const { data } = await supabase.from('usuarios').select('*').eq('id', userId).maybeSingle()
      setPerfil(data || { username: 'Usuário', idioma_preferido: 'pt-BR' })
    } catch {
      setPerfil({ username: 'Usuário', idioma_preferido: 'pt-BR' })
    }
  }

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => {
        setSession(data?.session ?? null)
        if (data?.session?.user?.id) {
          carregarPerfil(data.session.user.id)
        }
      })
      .catch((err) => {
        console.warn('Erro ao verificar sessão Supabase:', err)
        setSession(null)
      })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s?.user?.id) {
        carregarPerfil(s.user.id)
      }
    })
    return () => listener?.subscription?.unsubscribe?.()
  }, [])

  function entrarModoDemonstracao() {
    const demoSession = {
      user: { id: 'demo-user-id', email: 'visitante@recomenda.app' },
    }
    setSession(demoSession)
    setPerfil({ username: 'Visitante (Demo)', idioma_preferido: 'pt-BR' })
  }

  async function sair() {
    try {
      await supabase.auth.signOut()
    } catch {
      // ignore
    }
    setSession(null)
    setPerfil(null)
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        perfil,
        recarregarPerfil: () => carregarPerfil(session?.user?.id),
        sair,
        entrarModoDemonstracao,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
