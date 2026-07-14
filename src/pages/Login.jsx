import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [modo, setModo] = useState('login') // 'login' | 'cadastro'
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    try {
      if (modo === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password: senha })
        if (error) throw error
      }
    } catch (err) {
      setErro(err.message)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-6">
      <h1 className="font-display uppercase tracking-wide text-amber text-2xl text-center mb-1">
        ★ Recomenda Cine
      </h1>
      <p className="text-muted text-sm text-center mb-8">seu catálogo pessoal de séries e filmes</p>

      <form onSubmit={enviar} className="flex flex-col gap-3">
        <input
          type="email"
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="bg-surface border border-surface2 rounded px-3 py-2.5 text-sm text-ink placeholder:text-muted"
        />
        <input
          type="password"
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
          minLength={6}
          className="bg-surface border border-surface2 rounded px-3 py-2.5 text-sm text-ink placeholder:text-muted"
        />
        {erro && <div className="text-danger text-xs font-mono">{erro}</div>}
        <button
          type="submit"
          disabled={carregando}
          className="bg-amber text-black font-display uppercase tracking-wide text-sm rounded py-2.5 mt-2 disabled:opacity-60"
        >
          {carregando ? 'Aguarde…' : modo === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>

      <button
        onClick={() => setModo(modo === 'login' ? 'cadastro' : 'login')}
        className="text-muted text-xs font-mono text-center mt-5"
      >
        {modo === 'login' ? 'Não tem conta? Criar uma nova' : 'Já tem conta? Entrar'}
      </button>
    </div>
  )
}
