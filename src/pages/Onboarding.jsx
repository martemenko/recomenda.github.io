import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { validarDataNascimento } from '../lib/dataNascimento'

// Primeiro login: usuário confirma/ajusta o username (o trigger
// cria_perfil_usuario já preenche com o prefixo do e-mail), informa a data
// de nascimento (obrigatória — vai alimentar uma futura feature de
// recomendação) e, opcionalmente, o nome real. Depois disso
// `onboarding_completo` vira true e esta tela não aparece mais (ver gate em
// App.jsx).
export default function Onboarding() {
  const { user, perfil, recarregarPerfil } = useAuth()
  const [username, setUsername] = useState(perfil?.username ?? '')
  const [dataNascimento, setDataNascimento] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setErro('')

    if (!username.trim()) {
      setErro('Escolhe um username.')
      return
    }
    if (!validarDataNascimento(dataNascimento).valido) {
      setErro('Informa uma data de nascimento válida.')
      return
    }

    setEnviando(true)
    const { error } = await supabase
      .from('usuarios')
      .update({
        username: username.trim(),
        data_nascimento: dataNascimento,
        nome: nome.trim() || null,
        onboarding_completo: true,
      })
      .eq('id', user.id)
    setEnviando(false)

    if (error) {
      setErro(
        error.code === '23505'
          ? 'Esse username já está em uso.'
          : 'Não deu pra salvar, tenta de novo.'
      )
      return
    }

    await recarregarPerfil()
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-6">
      <h1 className="font-display font-semibold text-amber text-2xl text-center mb-1">
        Bem-vindo(a) ★
      </h1>
      <p className="text-muted text-sm text-center mb-8">
        só mais um passo antes de começar
      </p>
      <form onSubmit={enviar} className="flex flex-col gap-3">
        <label className="text-xs text-muted font-mono">Username</label>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
        />
        <label className="text-xs text-muted font-mono mt-2">
          Data de nascimento <span className="text-[10px]">(usamos pra melhorar as recomendações)</span>
        </label>
        <input
          type="date"
          value={dataNascimento}
          onChange={(e) => setDataNascimento(e.target.value)}
          required
          className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
        />
        <label className="text-xs text-muted font-mono mt-2">
          Nome <span className="text-[10px]">(opcional — você decide se compartilha isso depois, em Configurações)</span>
        </label>
        <input
          type="text"
          placeholder="Nome (opcional)"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
        />
        {erro && <div className="text-danger text-xs font-mono">{erro}</div>}
        <button
          type="submit"
          disabled={enviando}
          className="bg-amber text-bg font-display font-semibold text-sm rounded-2xl py-3 mt-2 shadow-[0_0_18px_rgba(243,194,85,0.35)] disabled:opacity-60"
        >
          {enviando ? 'Aguarde…' : 'Continuar'}
        </button>
      </form>
    </div>
  )
}
