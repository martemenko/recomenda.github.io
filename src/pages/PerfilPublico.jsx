import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Lock } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { buscarEstatisticasUsuario } from '../lib/statsUsuario'
import UserAvatar from '../components/UserAvatar'
import PosterCard from '../components/PosterCard'
import SectionLabel from '../components/SectionLabel'

// Busca os títulos (nome/imagem) de uma lista de ids em uma única query --
// mesmo padrão de outras telas do app (Perfil.jsx, statsUsuario.js).
async function buscarTitulosPorIds(ids) {
  if (!ids || ids.length === 0) return new Map()
  const { data } = await supabase.from('titulo').select('id, nome, imagem').in('id', ids)
  return new Map((data ?? []).map((t) => [t.id, t]))
}

export default function PerfilPublico() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()

  const [perfilAlvo, setPerfilAlvo] = useState(null)
  const [naoEncontrado, setNaoEncontrado] = useState(false)
  const [stats, setStats] = useState(null)
  const [historico, setHistorico] = useState(null) // null = seção oculta; [] = vazia
  const [favoritos, setFavoritos] = useState(null)
  const [listas, setListas] = useState(null)
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
      .select(
        'id, username, foto_perfil, perfil_privado, nome, user_age, privado_estatisticas, privado_historico, privado_favoritos, privado_listas'
      )
      .eq('id', userId)
      .maybeSingle()

    if (!perfil) {
      setNaoEncontrado(true)
      return
    }
    setPerfilAlvo(perfil)

    const souEuAgora = currentUser && currentUser.id === userId

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

    // Uma seção só é efetivamente oculta quando o perfil inteiro está
    // marcado como privado E aquela seção não foi reaberta como exceção --
    // com o perfil público, as flags de seção não têm efeito nenhum (ver
    // migração 20260828030000_privacidade_por_excecao.sql).
    const oculta = (flag) => !!perfil.perfil_privado && !!flag

    await Promise.all([
      carregarHistorico(userId, souEuAgora, oculta(perfil.privado_historico)),
      carregarFavoritos(userId, souEuAgora, oculta(perfil.privado_favoritos)),
      carregarListas(userId, souEuAgora, oculta(perfil.privado_listas)),
    ])
  }

  // O dono sempre lê a tabela base (RLS já garante que só ele acessa a
  // própria linha); qualquer outra pessoa lê a view *_publico, que já
  // devolve vazio quando a seção está oculta -- a checagem de `oculta` aqui é
  // só pra distinguir "oculta" de "vazia" na UI (ver migração
  // 20260828030000_privacidade_por_excecao.sql).
  async function carregarHistorico(alvoId, ehDono, oculta) {
    if (!ehDono && oculta) {
      setHistorico(null)
      return
    }
    const { data } = await supabase
      .from(ehDono ? 'user_item' : 'user_item_publico')
      .select('titulo_id, status_atualizado_em')
      .eq('user_id', alvoId)
      .eq('status', 'visto')
      .order('status_atualizado_em', { ascending: false })
      .limit(12)

    const titulos = await buscarTitulosPorIds((data ?? []).map((d) => d.titulo_id))
    setHistorico((data ?? []).map((d) => ({ id: d.titulo_id, ...titulos.get(d.titulo_id) })).filter((t) => t.nome))
  }

  async function carregarFavoritos(alvoId, ehDono, oculta) {
    if (!ehDono && oculta) {
      setFavoritos(null)
      return
    }
    const { data } = await supabase
      .from(ehDono ? 'user_item' : 'user_item_publico')
      .select('titulo_id, added_at')
      .eq('user_id', alvoId)
      .eq('favorito', true)
      .order('added_at', { ascending: false })
      .limit(12)

    const titulos = await buscarTitulosPorIds((data ?? []).map((d) => d.titulo_id))
    setFavoritos((data ?? []).map((d) => ({ id: d.titulo_id, ...titulos.get(d.titulo_id) })).filter((t) => t.nome))
  }

  async function carregarListas(alvoId, ehDono, oculta) {
    if (!ehDono && oculta) {
      setListas(null)
      return
    }
    const { data: listasData } = await supabase
      .from(ehDono ? 'lista' : 'lista_publico')
      .select('id, nome')
      .eq('user_id', alvoId)
      .order('created_at', { ascending: false })

    const listaIds = (listasData ?? []).map((l) => l.id)
    if (listaIds.length === 0) {
      setListas([])
      return
    }

    const { data: itensData } = await supabase
      .from(ehDono ? 'lista_item' : 'lista_item_publico')
      .select('lista_id')
      .in('lista_id', listaIds)

    const contagemPorLista = new Map()
    for (const item of itensData ?? []) {
      contagemPorLista.set(item.lista_id, (contagemPorLista.get(item.lista_id) ?? 0) + 1)
    }

    setListas(listasData.map((l) => ({ ...l, contagem: contagemPorLista.get(l.id) ?? 0 })))
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
  // Mesma regra de "oculta(flag)" do carregar() acima, pra decidir o que
  // mostrar/avisar na renderização.
  const oculto = (flag) => !!perfilAlvo.perfil_privado && !!flag

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
        {(perfilAlvo.nome || perfilAlvo.user_age) && (
          <div className="text-xs text-muted mt-0.5">
            {[perfilAlvo.nome, perfilAlvo.user_age && `${perfilAlvo.user_age} anos`].filter(Boolean).join(' · ')}
          </div>
        )}
        {perfilAlvo.perfil_privado && !souEu && (
          <div className="flex items-center gap-1.5 text-muted text-[11px] font-mono mt-1.5">
            <Lock size={11} />
            Perfil privado — só o que a pessoa liberou aparece abaixo
          </div>
        )}

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
      <OcultaParaOutrosAviso souEu={souEu} oculto={oculto(perfilAlvo.privado_estatisticas)} />
      {stats ? (
        <div className="grid grid-cols-2 gap-3 px-4 mb-2">
          <StatCard label="Tempo vendo TV" valor={stats.tempoTv} />
          <StatCard label="Episódios assistidos" valor={stats.episodios} />
          <StatCard label="Tempo vendo filmes" valor={stats.tempoFilme} />
          <StatCard label="Filmes assistidos" valor={stats.filmes} />
          <StatCard label="Jogos jogados" valor={stats.jogos} />
        </div>
      ) : (
        <SecaoOculta souEu={souEu} />
      )}

      <Prateleira titulo="Favoritos" itens={favoritos} souEu={souEu} oculto={oculto(perfilAlvo.privado_favoritos)} navigate={navigate} />
      <Prateleira titulo="Histórico" itens={historico} souEu={souEu} oculto={oculto(perfilAlvo.privado_historico)} navigate={navigate} />

      <SectionLabel>Listas</SectionLabel>
      <OcultaParaOutrosAviso souEu={souEu} oculto={oculto(perfilAlvo.privado_listas)} />
      {listas === null ? (
        <SecaoOculta souEu={souEu} />
      ) : listas.length === 0 ? (
        <div className="px-4 pb-2 text-muted text-sm font-mono">Nada por aqui ainda.</div>
      ) : (
        <div className="px-4 pb-2 space-y-2">
          {listas.map((l) => (
            <div key={l.id} className="flex items-center justify-between bg-surface border border-white/5 rounded-xl px-3.5 py-3">
              <span className="text-sm font-display font-medium text-ink">{l.nome}</span>
              <span className="text-xs text-muted font-mono">{l.contagem} {l.contagem === 1 ? 'item' : 'itens'}</span>
            </div>
          ))}
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

function Prateleira({ titulo, itens, souEu, oculto, navigate }) {
  return (
    <div className="mb-1">
      <SectionLabel>{titulo}</SectionLabel>
      <OcultaParaOutrosAviso souEu={souEu} oculto={oculto} />
      {itens === null ? (
        <SecaoOculta souEu={souEu} />
      ) : itens.length === 0 ? (
        <div className="px-4 pb-2 text-muted text-sm font-mono">Nada por aqui ainda.</div>
      ) : (
        <div className="flex flex-nowrap items-start gap-3 px-4 pb-3 overflow-x-auto scroll-area">
          {itens.map((t) => (
            <div key={t.id} className="flex-shrink-0 w-28">
              <PosterCard imagem={t.imagem} nome={t.nome} onClick={() => navigate(`/titulo/${t.id}`)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Mostrada só pro dono, quando ele mesmo está vendo os próprios dados
// (por isso a seção não é null) mas marcou a seção como oculta pra outras
// pessoas em Configurações -- um lembrete de que essa vitrine é exclusiva.
function OcultaParaOutrosAviso({ souEu, oculto }) {
  if (!souEu || !oculto) return null
  return (
    <div className="px-4 pb-2 -mt-1 flex items-center gap-1.5 text-muted text-[11px] font-mono">
      <Lock size={11} />
      Só você vê esta seção (oculta pra outras pessoas em Configurações)
    </div>
  )
}

// Mostrada pra quem não é dono quando a seção está mesmo escondida (itens/stats/listas === null).
function SecaoOculta({ souEu }) {
  if (souEu) return null
  return (
    <div className="px-4 pb-3 flex items-center gap-2 text-muted text-xs font-mono">
      <Lock size={13} />
      Esta seção é privada.
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
