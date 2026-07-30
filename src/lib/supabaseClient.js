import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

const FUNCTIONS_URL = `${supabaseUrl}/functions/v1`

// Chama uma Edge Function já mandando o token do usuário logado (se houver).
export async function callFunction(name, body) {
  try {
    const { data } = await supabase.auth.getSession().catch(() => ({ data: {} }))
    const token = data?.session?.access_token ?? supabaseAnonKey

    const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(body ?? {}),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? `Erro ${res.status} em ${name}`)
    return json
  } catch (err) {
    console.warn(`[callFunction] Chamada da função ${name} falhou:`, err.message)
    return {}
  }
}

// Idioma efetivo: preferência salva no perfil, senão o do navegador, senão pt-BR
export function idiomaAtual(perfil) {
  return perfil?.idioma_preferido || navigator.language || 'pt-BR'
}
