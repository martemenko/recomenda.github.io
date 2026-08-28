import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { validarDataNascimento } from '../lib/dataNascimento'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'

// Cada opção mapeia pra uma coluna booleana em usuarios (ver migração
// 20260828030000_privacidade_por_excecao.sql). `invertido: true` significa
// que a coluna é um flag de "compartilhar" (true = visível) em vez de
// "privado" (true = oculto) -- a UI trata as duas iguais, sempre como
// "Ocultar X" com a caixa marcada = oculto, e converte de volta ao salvar.
const OPCOES_PRIVACIDADE = [
  { campo: 'privado_estatisticas', titulo: 'Estatísticas', descricao: 'Tempo assistido, episódios, filmes e jogos' },
  { campo: 'privado_historico', titulo: 'Histórico', descricao: 'O que você marcou como visto/jogado' },
  { campo: 'privado_favoritos', titulo: 'Favoritos', descricao: 'Seus títulos favoritados' },
  { campo: 'privado_listas', titulo: 'Listas', descricao: 'Suas listas personalizadas' },
  { campo: 'compartilhar_nome', titulo: 'Nome', descricao: 'Seu nome real', invertido: true },
  { campo: 'compartilhar_idade', titulo: 'Idade', descricao: 'Sua idade (calculada a partir da data de nascimento)', invertido: true },
]

// Estado "tudo oculto" aplicado sempre que o usuário LIGA o Perfil Privado --
// as opções aparecem todas marcadas e a pessoa desmarca as que quer manter
// visíveis como exceção. Ver módulo docstring da migração
// 20260828030000_privacidade_por_excecao.sql pro modelo completo.
const TUDO_OCULTO = {
  privado_estatisticas: true,
  privado_historico: true,
  privado_favoritos: true,
  privado_listas: true,
  compartilhar_nome: false,
  compartilhar_idade: false,
}

export default function ContaConfiguracoes() {
  const navigate = useNavigate()
  const { user, perfil, recarregarPerfil } = useAuth()
  const [perfilPrivado, setPerfilPrivado] = useState(false)
  const [privacidadeSecoes, setPrivacidadeSecoes] = useState(TUDO_OCULTO)
  const [nomeEditavel, setNomeEditavel] = useState('')
  const [dataNascimentoEditavel, setDataNascimentoEditavel] = useState('')
  const [salvandoDadosPessoais, setSalvandoDadosPessoais] = useState(false)
  const [dadosPessoaisMsg, setDadosPessoaisMsg] = useState('')
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState('')

  useEffect(() => {
    if (!perfil) return
    setPerfilPrivado(!!perfil.perfil_privado)
    setPrivacidadeSecoes({
      privado_estatisticas: !!perfil.privado_estatisticas,
      privado_historico: !!perfil.privado_historico,
      privado_favoritos: !!perfil.privado_favoritos,
      privado_listas: !!perfil.privado_listas,
      compartilhar_nome: !!perfil.compartilhar_nome,
      compartilhar_idade: !!perfil.compartilhar_idade,
    })
    setNomeEditavel(perfil.nome ?? '')
    setDataNascimentoEditavel(perfil.data_nascimento ?? '')
  }, [perfil])

  async function alternarPerfilPrivado(valor) {
    const anterior = { perfilPrivado, privacidadeSecoes }

    setPerfilPrivado(valor)
    // Toda vez que liga o Perfil Privado, tudo começa oculto de novo -- o
    // usuário reabre exceções a partir daí (ver TUDO_OCULTO acima).
    const patch = valor ? { perfil_privado: true, ...TUDO_OCULTO } : { perfil_privado: false }
    if (valor) setPrivacidadeSecoes(TUDO_OCULTO)

    const { error } = await supabase.from('usuarios').update(patch).eq('id', user.id)

    if (error) {
      console.error('[ContaConfiguracoes] Erro ao salvar perfil_privado:', error)
      setPerfilPrivado(anterior.perfilPrivado)
      setPrivacidadeSecoes(anterior.privacidadeSecoes)
      return
    }

    recarregarPerfil()
  }

  async function atualizarSecao(campo, ocultoMarcado, invertido) {
    const anterior = privacidadeSecoes[campo]
    const novoValor = invertido ? !ocultoMarcado : ocultoMarcado
    setPrivacidadeSecoes((prev) => ({ ...prev, [campo]: novoValor }))

    const { error } = await supabase.from('usuarios').update({ [campo]: novoValor }).eq('id', user.id)

    if (error) {
      console.error(`[ContaConfiguracoes] Erro ao salvar ${campo}:`, error)
      setPrivacidadeSecoes((prev) => ({ ...prev, [campo]: anterior }))
      return
    }

    recarregarPerfil()
  }

  async function salvarDadosPessoais() {
    setDadosPessoaisMsg('')
    if (dataNascimentoEditavel && !validarDataNascimento(dataNascimentoEditavel).valido) {
      setDadosPessoaisMsg('Informa uma data de nascimento válida.')
      return
    }

    setSalvandoDadosPessoais(true)
    const { error } = await supabase
      .from('usuarios')
      .update({ nome: nomeEditavel.trim() || null, data_nascimento: dataNascimentoEditavel || null })
      .eq('id', user.id)
    setSalvandoDadosPessoais(false)

    if (error) {
      console.error('[ContaConfiguracoes] Erro ao salvar dados pessoais:', error)
      setDadosPessoaisMsg('Não deu pra salvar, tenta de novo.')
      return
    }

    setDadosPessoaisMsg('Salvo!')
    recarregarPerfil()
    setTimeout(() => setDadosPessoaisMsg(''), 2500)
  }

  async function sairDaConta() {
    try {
      await supabase.auth.signOut()
      navigate('/login')
    } catch (err) {
      alert(`Erro ao sair: ${err.message}`)
    }
  }

  async function excluirConta() {
    if (confirmacaoExclusao !== 'EXCLUIR') {
      alert('Digite EXCLUIR para confirmar.')
      return
    }
    try {
      await supabase.from('watched_episode').delete().eq('user_id', user.id)
      await supabase.from('user_item').delete().eq('user_id', user.id)
      await supabase.auth.signOut()
      window.location.reload()
    } catch (err) {
      alert(`Erro ao excluir conta: ${err.message}`)
    }
  }

  return (
    <div className="flex-1 pb-10">
      <TopBar
        title="Conta"
        rightSlot={
          <button onClick={() => navigate('/configuracoes')} className="text-muted">
            <ArrowLeft size={20} />
          </button>
        }
      />

      <SectionLabel>Privacidade</SectionLabel>
      <div className="mx-4 p-4 bg-surface rounded-2xl border border-white/5 flex items-center justify-between">
        <div>
          <div className="font-display font-medium text-sm text-ink">Perfil Privado</div>
          <div className="text-xs text-muted">Oculta seu perfil de quem não é você — escolha exceções abaixo</div>
        </div>
        <input
          type="checkbox"
          checked={perfilPrivado}
          onChange={(e) => alternarPerfilPrivado(e.target.checked)}
          className="w-5 h-5 accent-amber rounded"
        />
      </div>

      {perfilPrivado && (
        <div className="mx-4 mt-3 bg-surface rounded-2xl border border-white/5 divide-y divide-white/5">
          <div className="p-4 text-xs text-muted">
            Tudo começa oculto. Desmarque o que você quer manter visível mesmo com o perfil privado.
          </div>
          {OPCOES_PRIVACIDADE.map(({ campo, titulo, descricao, invertido }) => {
            const oculto = invertido ? !privacidadeSecoes[campo] : privacidadeSecoes[campo]
            return (
              <label key={campo} className="p-4 flex items-center justify-between cursor-pointer">
                <div>
                  <div className="font-display font-medium text-sm text-ink">Ocultar {titulo}</div>
                  <div className="text-xs text-muted">{descricao}</div>
                </div>
                <input
                  type="checkbox"
                  checked={oculto}
                  onChange={(e) => atualizarSecao(campo, e.target.checked, invertido)}
                  className="w-5 h-5 accent-amber rounded"
                />
              </label>
            )
          })}
        </div>
      )}

      <SectionLabel>Dados Pessoais</SectionLabel>
      <div className="mx-4 bg-surface rounded-2xl border border-white/5 divide-y divide-white/5">
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-muted font-mono">Nome</label>
            <input
              type="text"
              placeholder="Nome (opcional)"
              value={nomeEditavel}
              onChange={(e) => setNomeEditavel(e.target.value)}
              className="mt-1 w-full bg-surface2 border border-white/10 rounded-xl px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <div>
            <label className="text-xs text-muted font-mono">Data de nascimento</label>
            <input
              type="date"
              value={dataNascimentoEditavel}
              onChange={(e) => setDataNascimentoEditavel(e.target.value)}
              className="mt-1 w-full bg-surface2 border border-white/10 rounded-xl px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </div>
          {dadosPessoaisMsg && <div className="text-xs font-mono text-amber">{dadosPessoaisMsg}</div>}
          <button
            onClick={salvarDadosPessoais}
            disabled={salvandoDadosPessoais}
            className="px-4 py-2 bg-amber text-bg rounded-xl text-xs font-display font-semibold disabled:opacity-60"
          >
            {salvandoDadosPessoais ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
        {!perfilPrivado && (
          <div className="p-4 text-xs text-muted">
            Nome e idade aparecem no seu perfil público. Pra escolher esconder só um deles, ative o Perfil Privado acima.
          </div>
        )}
      </div>

      <SectionLabel>Sessão e Conta</SectionLabel>
      <div className="mx-4 p-4 bg-surface rounded-2xl border border-white/5 space-y-4">
        <button
          onClick={sairDaConta}
          className="w-full py-3 bg-surface2 hover:bg-white/10 text-ink border border-white/10 font-display font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
        >
          <span>Sair da Conta (Log out)</span>
        </button>

        <hr className="border-white/5" />

        <div className="space-y-3 pt-1">
          <div className="text-xs text-muted">
            Para excluir permanentemente sua conta e todos os dados armazenados, digite <strong className="text-red-400">EXCLUIR</strong> abaixo:
          </div>
          <input
            type="text"
            value={confirmacaoExclusao}
            onChange={(e) => setConfirmacaoExclusao(e.target.value)}
            placeholder="Digite EXCLUIR"
            className="w-full bg-surface2 border border-white/10 rounded-xl p-2.5 text-xs text-ink placeholder:text-muted/50"
          />
          <button
            onClick={excluirConta}
            disabled={confirmacaoExclusao !== 'EXCLUIR'}
            className="w-full py-2.5 bg-red-500/10 text-red-400 border border-red-500/30 font-display font-semibold rounded-xl text-xs transition-colors hover:bg-red-500/20 disabled:opacity-30 disabled:hover:bg-red-500/10"
          >
            Excluir Conta Definitivamente
          </button>
        </div>
      </div>
    </div>
  )
}
