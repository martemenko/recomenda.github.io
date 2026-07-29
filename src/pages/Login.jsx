import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [modo, setModo] = useState('login') // 'login' | 'cadastro'
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [cadastroFeito, setCadastroFeito] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setErro('')

    if (modo === 'cadastro' && senha !== confirmarSenha) {
      setErro('As senhas não são iguais.')
      return
    }

    setCarregando(true)
    try {
      if (modo === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
        if (error) throw error
      } else {
        const redirectTo = `${window.location.origin}${window.location.pathname}?confirmado=1`
        const { error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: { emailRedirectTo: redirectTo },
        })
        if (error) throw error
        setCadastroFeito(true)
      }
    } catch (err) {
      setErro(err.message)
    } finally {
      setCarregando(false)
    }
  }

  if (cadastroFeito) {
    return (
      <div className="flex-1 flex flex-col justify-center px-6 text-center">
        <h1 className="font-display font-semibold text-amber text-xl mb-2">Quase lá!</h1>
        <p className="text-sm text-ink leading-relaxed mb-1">
          Mandamos um e-mail de confirmação pra <strong>{email}</strong>.
        </p>
        <p className="text-xs text-muted">Clica no link recebido pra ativar sua conta.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-6">
      <h1 className="font-display font-semibold text-amber text-2xl text-center mb-1">
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
          className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
        />
        <input
          type="password"
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
          minLength={6}
          className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
        />
        {modo === 'cadastro' && (
          <input
            type="password"
            placeholder="Confirmar senha"
            value={confirmarSenha}
            onChange={(e) => setConfirmarSenha(e.target.value)}
            required
            minLength={6}
            className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
          />
        )}
        {erro && <div className="text-danger text-xs font-mono">{erro}</div>}
        <button
          type="submit"
          disabled={carregando}
          className="bg-amber text-bg font-display font-semibold text-sm rounded-2xl py-3 mt-2 shadow-[0_0_18px_rgba(243,194,85,0.35)] disabled:opacity-60"
        >
          {carregando ? 'Aguarde…' : modo === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>
      <button
        onClick={() => { setModo(modo === 'login' ? 'cadastro' : 'login'); setErro('') }}
        className="text-muted text-xs font-mono text-center mt-5"
      >
        {modo === 'login' ? 'Não tem conta? Criar uma nova' : 'Já tem conta? Entrar'}
      </button>
    </div>
  )
}
