import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { buscarEstatisticasUsuario } from '../lib/statsUsuario'
import UserAvatar from '../components/UserAvatar'
import SectionLabel from '../components/SectionLabel'

export default function PerfilPublico() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()

  const [perfilAlvo, setPerfilAlvo] = useState(null)
  const [naoEncontrado, setNaoEncontrado] = useState(false)
  const [stats, setStats] = useState(null)
  const [seguindo, setSeguindo] = useState(false)
  const [contagemSeguidores, setContagemSeguidores] = useState(0)
  const [contagemSeguindo, setContagemSeguindo] = useState(0)
  const [listaAberta, setListaAberta] = useState(null) // 'seguidores' | 'seguindo' | null
  const [pessoasLista, setPessoasLista] = useState([])

  useEffect(() => {
    carregar()
  }, [userId])

  async function carregar() {
    const { data: perfil } = await supabase
      .from('usuarios_publico')
      .select('id, username, foto_perfil, perfil_privado')
      .eq('id', userId)
      .maybeSingle()

    if (!perfil) {
      setNaoEncontrado(true)
      return
    }
    setPerfilAlvo(perfil)

    // Perfil privado visto por outra pessoa: só o @ fica visível, sem buscar
    // estatísticas/contagens (a RLS já bloquearia mesmo, isso só evita o round-trip).
    const souEuAgora = currentUser && currentUser.id === userId
    if (perfil.perfil_privado && !souEuAgora) return

    const [statsRes, seguidoresRes, seguindoRes, minhaRelacaoRes] = await Promise.all([
      buscarEstatisticasUsuario(userId),
      supabase.from('seguidor').select('seguidor_id', { count: 'exact', head: true }).eq('seguido_id', userId),
      supabase.from('seguidor').select('seguido_id', { count: 'exact', head: true }).eq('seguidor_id', userId),
      currentUser
        ? supabase.from('seguidor').select('seguidor_id').eq('seguidor_id', currentUser.id).eq('seguido_id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    setStats(statsRes)
    setContagemSeguidores(seguidoresRes.count ?? 0)
    setContagemSeguindo(seguindoRes.count ?? 0)
    setSeguindo(!!minhaRelacaoRes.data)
  }

  async function alternarSeguir() {
    if (!currentUser) return
    const novoEstado = !seguindo
    setSeguindo(novoEstado)
    setContagemSeguidores((c) => c + (novoEstado ? 1 : -1))

    const { error } = novoEstado
      ? await supabase.from('seguidor').upsert({ seguidor_id: currentUser.id, seguido_id: userId })
      : await supabase.from('seguidor').delete().eq('seguidor_id', currentUser.id).eq('seguido_id', userId)

    if (error) {
      console.error('Erro ao seguir/deixar de seguir:', error)
      setSeguindo(!novoEstado)
      setContagemSeguidores((c) => c - (novoEstado ? 1 : -1))
    }
  }

  async function abrirLista(tipo) {
    const { data: relacoes, error: relErro } =
      tipo === 'seguidores'
        ? await supabase.from('seguidor').select('seguidor_id').eq('seguido_id', userId)
        : await supabase.from('seguidor').select('seguido_id').eq('seguidor_id', userId)

    if (relErro) {
      console.error('Erro ao carregar lista de seguidores:', relErro)
      return
    }

    const ids = (relacoes ?? []).map((r) => (tipo === 'seguidores' ? r.seguidor_id : r.seguido_id))
    if (ids.length === 0) {
      setPessoasLista([])
      setListaAberta(tipo)
      return
    }

    const { data: pessoas, error: perfisErro } = await supabase
      .from('usuarios_publico')
      .select('id, username, foto_perfil')
      .in('id', ids)

    if (perfisErro) {
      console.error('Erro ao carregar perfis dos seguidores:', perfisErro)
      return
    }
    setPessoasLista(pessoas ?? [])
    setListaAberta(tipo)
  }

  function handleVoltar() {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      navigate('/perfil')
    }
  }

  if (naoEncontrado) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-muted font-sans text-sm mb-4">Usuário não encontrado.</p>
        <button
          onClick={handleVoltar}
          className="px-4 py-2 bg-surface rounded-xl text-ink font-display font-medium text-xs border border-white/10"
        >
          Voltar
        </button>
      </div>
    )
  }

  if (!perfilAlvo) return <div className="p-4 text-muted text-sm font-mono">Carregando…</div>

  const souEu = currentUser && currentUser.id === userId

  if (perfilAlvo.perfil_privado && !souEu) {
    return (
      <div className="flex-1 overflow-y-auto scroll-area relative pb-12">
        <div className="sticky top-0 z-50 flex items-center gap-3 px-4 py-3 bg-bg/95 backdrop-blur-md border-b border-white/5">
          <button onClick={handleVoltar} aria-label="Voltar" className="text-muted">
            <ArrowLeft size={20} />
          </button>
        </div>
        <div className="flex flex-col items-center justify-center pt-16 px-4 text-center">
          <div className="text-lg font-display font-semibold text-ink">@{perfilAlvo.username}</div>
          <p className="text-muted text-sm font-mono mt-3">Este perfil é privado.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scroll-area relative pb-12">
      <div className="sticky top-0 z-50 flex items-center gap-3 px-4 py-3 bg-bg/95 backdrop-blur-md border-b border-white/5">
        <button onClick={handleVoltar} aria-label="Voltar" className="text-muted">
          <ArrowLeft size={20} />
        </button>
        <div className="text-base text-ink font-display font-semibold truncate">{perfilAlvo.username}</div>
      </div>

      <div className="flex flex-col items-center pt-6 px-4">
        <UserAvatar fotoPerfil={perfilAlvo.foto_perfil} username={perfilAlvo.username} size={96} />
        <div className="text-lg font-display font-semibold text-ink mt-3">{perfilAlvo.username}</div>

        <div className="flex items-center gap-6 mt-3">
          <button onClick={() => abrirLista('seguidores')} className="text-center">
            <div className="text-base font-display font-semibold text-ink">{contagemSeguidores}</div>
            <div className="text-xs text-muted">Seguidores</div>
          </button>
          <button onClick={() => abrirLista('seguindo')} className="text-center">
            <div className="text-base font-display font-semibold text-ink">{contagemSeguindo}</div>
            <div className="text-xs text-muted">Seguindo</div>
          </button>
        </div>

        {!souEu && currentUser && (
          <button
            onClick={alternarSeguir}
            className={`mt-4 px-6 py-2.5 rounded-2xl font-display font-semibold text-sm ${
              seguindo
                ? 'bg-surface border border-white/10 text-ink'
                : 'bg-amber text-bg shadow-[0_0_18px_rgba(243,194,85,0.35)]'
            }`}
          >
            {seguindo ? '✓ Seguindo' : '+ Seguir'}
          </button>
        )}
      </div>

      <SectionLabel>Estatísticas</SectionLabel>
      {stats && (
        <div className="grid grid-cols-2 gap-3 px-4 mb-2">
          <StatCard label="Tempo vendo TV" valor={stats.tempoTv} />
          <StatCard label="Episódios assistidos" valor={stats.episodios} />
          <StatCard label="Tempo vendo filmes" valor={stats.tempoFilme} />
          <StatCard label="Filmes assistidos" valor={stats.filmes} />
          <StatCard label="Jogos jogados" valor={stats.jogos} />
        </div>
      )}

      {listaAberta && (
        <div className="fixed inset-0 bg-bg z-50 flex flex-col max-w-[480px] mx-auto w-full left-0 right-0">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
            <button onClick={() => setListaAberta(null)} className="text-muted">
              <ArrowLeft size={20} />
            </button>
            <div className="text-base text-ink font-display font-semibold">
              {listaAberta === 'seguidores' ? 'Seguidores' : 'Seguindo'}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area px-4 py-2">
            {pessoasLista.length === 0 ? (
              <div className="text-muted text-sm font-mono py-6 text-center">Nada por aqui ainda.</div>
            ) : (
              pessoasLista.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setListaAberta(null)
                    navigate(`/usuario/${p.id}`)
                  }}
                  className="w-full flex items-center gap-3 py-2.5 border-b border-white/5 text-left"
                >
                  <UserAvatar fotoPerfil={p.foto_perfil} username={p.username} size={40} />
                  <span className="text-sm text-ink font-display font-medium">@{p.username}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, valor }) {
  return (
    <div className="bg-surface border border-white/5 rounded-2xl px-3.5 py-3 relative overflow-hidden">
      <div className="font-mono text-lg text-teal">{valor}</div>
      <div className="text-[10px] text-muted uppercase">{label}</div>
    </div>
  )
}
