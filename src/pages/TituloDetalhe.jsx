import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Heart, ChevronLeft, Star, Check } from 'lucide-react'
import { supabase, callFunction, idiomaAtual } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import SectionLabel from '../components/SectionLabel'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w400'

export default function TituloDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, perfil } = useAuth()

  const [titulo, setTitulo] = useState(null)
  const [mediaType, setMediaType] = useState(null)
  const [elenco, setElenco] = useState([])
  const [userItem, setUserItem] = useState(null)
  const [minhaNota, setMinhaNota] = useState(0)
  const [episodios, setEpisodios] = useState([])
  const [assistidos, setAssistidos] = useState(new Set())
  const [temporadaAberta, setTemporadaAberta] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null)
  const [menuStatusAberto, setMenuStatusAberto] = useState(false)

  useEffect(() => {
    carregar()
  }, [id])

  async function carregar() {
    const idioma = idiomaAtual(perfil)
    
    let tipoUrl = searchParams.get('tipo') 

    // Fallback manual extremamente robusto para HashRouter no GitHub Pages
    if (!tipoUrl) {
      const hashParts = window.location.hash.split('?')
      if (hashParts.length > 1) {
        tipoUrl = new URLSearchParams(hashParts[1]).get('tipo')
      }
    }

    let tipo = tipoUrl
    if (!tipo) {
      const { data: serieRow } = await supabase.from('series').select('titulo_id').eq('titulo_id', id).maybeSingle()
      tipo = serieRow ? 'tv' : 'movie'
    }
    setMediaType(tipo)

    const { data: existente } = await supabase
      .from('titulo')
      .select('id')
      .eq('id', id)
      .maybeSingle()

    // Se o título for inédito no banco local, acionamos a ingestão base rápida com status "none"
    if (!existente && user) {
      await callFunction('adicionar-titulo', { 
        tmdb_id: Number(id), 
        media_type: tipo, 
        status: 'none' 
      }).catch((err) => console.error('Erro ao registrar dados base:', err))
    }

    // --- FUNÇÕES AUXILIARES DE PAGINAÇÃO CONCORRENTE (SUPERAM O LIMITE DE 1000 LINHAS) ---
    const obterEpisodiosPaginados = async () => {
      if (tipo !== 'tv') return []
      let eps = []
      let de = 0
      const tamanho = 1000
      while (true) {
        const { data, error } = await supabase
          .from('episode')
          .select('id, season_number, episode_number, episode_name')
          .eq('titulo_id', id)
          .order('season_number', { ascending: true })
          .order('episode_number', { ascending: true })
          .range(de, de + tamanho - 1)

        if (error) {
          console.error('Erro ao buscar episódios (paginado):', error)
          break
        }
        if (!data || data.length === 0) break
        eps = [...eps, ...data]
        if (data.length < tamanho) break
        de += tamanho
      }
      return eps
    }

    const obterAssistidosPaginados = async () => {
      if (!user || tipo !== 'tv') return []
      let list = []
      let de = 0
      const tamanho = 1000
      while (true) {
        const { data, error } = await supabase
          .from('watched_episode')
          .select('episode_id, episode!inner(titulo_id)')
          .eq('user_id', user.id)
          .eq('episode.titulo_id', id)
          .range(de, de + tamanho - 1)

        if (error) {
          console.error('Erro ao buscar assistidos (paginado):', error)
          break
        }
        if (!data || data.length === 0) break
        list = [...list, ...data]
        if (data.length < tamanho) break
        de += tamanho
      }
      return list
    }

    // --- LOTE PARALELO 1: Dispara TODAS as buscas simultaneamente para o banco local ---
    const [traduzido, base, cast, eps, watched, item, rating] = await Promise.all([
      callFunction('get-translate-title', { titulo_id: Number(id), idioma, media_type: tipo }).catch(() => null),
      supabase.from('titulo').select('nome, sinopse, imagem, genero, media_rating, total_avaliacoes').eq('id', id).maybeSingle().then(res => res.data),
      tipo === 'tv'
        ? supabase.from('elenco_serie').select('personagem, ator(name, image)').eq('titulo_id', id).then(res => res.data ?? [])
        : supabase.from('elenco_movie').select('personagem, ator(name, image)').eq('titulo_id', id).then(res => res.data ?? []),
      obterEpisodiosPaginados(),
      obterAssistidosPaginados(),
      user ? supabase.from('user_item').select('status, favorito').eq('user_id', user.id).eq('titulo_id', id).maybeSingle().then(res => res.data) : null,
      user ? supabase.from('user_rating').select('rating_score').eq('user_id', user.id).eq('titulo_id', id).maybeSingle().then(res => res.data) : null
    ])

    setTitulo({ ...base, ...(traduzido ?? {}) })
    setElenco(cast)
    setEpisodios(eps)
    setAssistidos(new Set((watched ?? []).map((w) => w.episode_id)))
    setUserItem(item)
    setMinhaNota(rating?.rating_score ?? 0)

    // --- LOTE PARALELO 2: Sincronização silenciosa em background de novas temporadas ---
    if (existente && tipo === 'tv' && user) {
      callFunction('adicionar-titulo', { 
        tmdb_id: Number(id), 
        media_type: 'tv', 
        status: 'none' 
      })
      .then(async () => {
        // Se a sincronização trouxer novas temporadas (como 22 e 23), recarrega os episódios localmente em tempo real
        const novosEps = await obterEpisodiosPaginados()
        if (novosEps && novosEps.length > eps.length) {
          setEpisodios(novosEps)
          console.log(`[Importador] Novas temporadas e episódios sincronizados em background (${novosEps.length - eps.length} novos).`)
        }
      })
      .catch((err) => console.error('Erro na atualização em background:', err))
    }
  }

  // Otimização: Gravação direta e otimista na tabela user_item (sem chamar função na nuvem)
  async function adicionar(status = 'quero_ver') {
    const estadoTemporario = { status, favorito: false }
    setUserItem(estadoTemporario) // Atualização Visual Instantânea

    const { error } = await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status,
      favorito: false,
    })

    if (error) {
      console.error('Erro ao seguir:', error)
      setUserItem(null)
      alert(`Não foi possível salvar: ${error.message}`)
    } else {
      carregar()
    }
  }

  async function mudarStatus(novoStatus) {
    setMenuStatusAberto(false)
    
    // Atualização Visual Instantânea
    setUserItem(prev => prev ? { ...prev, status: novoStatus } : { status: novoStatus, favorito: false })

    const { error } = await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status: novoStatus,
      favorito: userItem?.favorito ?? false,
    })
    
    if (error) {
      console.error('Erro ao mudar status:', error)
      carregar() // Reverte estado se falhar
    }
  }

  async function deixarDeSeguir() {
    setMenuStatusAberto(false)
    
    // Atualização Visual Instantânea (Desmarca de imediato na interface)
    const estadoAntes = userItem
    setUserItem(null)

    const { error } = await supabase
      .from('user_item')
      .delete()
      .eq('user_id', user.id)
      .eq('titulo_id', Number(id))
    
    if (error) {
      console.error('Erro ao deixar de seguir:', error)
      setUserItem(estadoAntes) // Reverte se falhar
    }
  }

  // Otimização: Heart de favoritar reage instantaneamente sem esperar a rede
  async function favoritar() {
    const novoFav = !userItem?.favorito
    
    // Atualização Visual Instantânea (Troca o preenchimento do coração na hora)
    setUserItem(prev => prev ? { ...prev, favorito: novoFav } : { status: 'quero_ver', favorito: novoFav })

    const { error } = await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status: userItem?.status ?? 'quero_ver',
      favorito: novoFav,
    })

    if (error) {
      console.error('Erro ao favoritar:', error)
      carregar() // Reverte se falhar
    }
  }

  async function avaliar(nota) {
    setMinhaNota(nota)
    await callFunction('avaliar', { titulo_id: Number(id), rating_score: nota })
    carregar()
  }

  function episodiosAntesDe(alvo) {
    return episodios.filter(
      (e) =>
        !assistidos.has(e.id) &&
        (e.season_number < alvo.season_number ||
          (e.season_number === alvo.season_number && e.episode_number < alvo.episode_number)),
    )
  }

  // Otimização: Marcações em massa agora acendem os checks em 0ms
  async function aplicarMarcacao(episodeIds, desmarcar) {
    setConfirmacao(null)

    // 1. Atualização Otimista Instantânea dos estados locais
    const novasMarcadas = new Set(assistidos)
    episodeIds.forEach(eid => {
      if (desmarcar) novasMarcadas.delete(eid)
      else novasMarcadas.add(eid)
    })
    
    const totalAssistidos = novasMarcadas.size
    const novoStatus = totalAssistidos === 0 ? 'quero_ver' : totalAssistidos >= episodios.length ? 'visto' : 'vendo'
    
    setAssistidos(novasMarcadas)
    setUserItem(prev => prev ? { ...prev, status: novoStatus } : { status: novoStatus, favorito: false })

    // 2. Processa a sincronização com o banco em segundo plano de forma silenciosa
    try {
      const { error } = desmarcar
        ? await supabase.from('watched_episode').delete().eq('user_id', user.id).in('episode_id', episodeIds)
        : await supabase.from('watched_episode').upsert(episodeIds.map((eid) => ({ user_id: user.id, episode_id: eid })))
      
      if (error) throw error

      const { error: erroStatus } = await supabase.from('user_item').upsert({
        user_id: user.id,
        titulo_id: Number(id),
        status: novoStatus,
        favorito: userItem?.favorito ?? false,
      })
      if (erroStatus) throw erroStatus
    } catch (err) {
      console.error('[Importador] Erro na gravação:', err)
      carregar() // Se der erro, puxa os dados corretos do banco de volta
    }
  }

  async function marcarEpisodio(episodeObj, marcado) {
    if (marcado) {
      await aplicarMarcacao([episodeObj.id], true)
      return
    }
    const anteriores = episodiosAntesDe(episodeObj)
    if (anteriores.length > 0) {
      setConfirmacao({
        mensagem: `Você ainda não marcou ${anteriores.length} episódio${anteriores.length > 1 ? 's' : ''} anterior${anteriores.length > 1 ? 'es' : ''}. Quer marcar ${anteriores.length > 1 ? 'eles' : 'ele'} também como assistido${anteriores.length > 1 ? 's' : ''}?`,
        aoConfirmar: () => aplicarMarcacao([...anteriores.map((e) => e.id), episodeObj.id], false),
        aoRecusar: () => aplicarMarcacao([episodeObj.id], false),
      })
    } else {
      await aplicarMarcacao([episodeObj.id], false)
    }
  }

  async function marcarTemporada(seasonNumber, todasAssistidas) {
    const epsDaTemporada = episodios.filter((e) => e.season_number === seasonNumber)
    if (todasAssistidas) {
      await aplicarMarcacao(epsDaTemporada.map((e) => e.id), true)
      return
    }
    const faltantes = epsDaTemporada.filter((e) => !assistidos.has(e.id))
    const temporadasAnteriores = episodios.filter((e) => e.season_number < seasonNumber && !assistidos.has(e.id))

    if (temporadasAnteriores.length > 0) {
      setConfirmacao({
        mensagem: `Tem temporada${temporadasAnteriores.length > 1 ? 's' : ''} anterior${temporadasAnteriores.length > 1 ? 'es' : ''} com episódio não assistido. Quer marcar ${temporadasAnteriores.length > 1 ? 'elas' : 'ela'} também como vista${temporadasAnteriores.length > 1 ? 's' : ''}?`,
        aoConfirmar: () => aplicarMarcacao([...temporadasAnteriores.map((e) => e.id), ...faltantes.map((e) => e.id)], false),
        aoRecusar: () => aplicarMarcacao(faltantes.map((e) => e.id), false),
      })
    } else {
      await aplicarMarcacao(faltantes.map((e) => e.id), false)
    }
  }

  async function marcarFilmeVisto() {
    const novoStatus = userItem?.status === 'visto' ? 'quero_ver' : 'visto'
    
    // Atualização Visual Instantânea (O botão de visto se acende no mesmo instante)
    setUserItem(prev => prev ? { ...prev, status: novoStatus } : { status: novoStatus, favorito: false })

    const { error } = await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status: novoStatus,
      favorito: userItem?.favorito ?? false,
    })
    
    if (error) {
      console.error('Erro ao marcar filme visto:', error)
      carregar() // Reverte se falhar
    }
  }

  if (!titulo) return <div className="p-4 text-muted text-sm font-mono">Carregando…</div>

  const temporadas = [...new Set(episodios.map((e) => e.season_number))]

  return (
    <div className="flex-1 overflow-y-auto scroll-area">
      <div className="relative">
        {titulo.imagem && <img src={`${POSTER_BASE}${titulo.imagem}`} alt={titulo.nome} className="w-full aspect-[2/3] object-cover" />}
        <button onClick={() => navigate(-1)} className="absolute top-3 left-3 bg-bg/70 rounded-full p-2 text-ink">
          <ChevronLeft size={18} />
        </button>
        <button onClick={favoritar} className="absolute top-3 right-3 bg-bg/70 rounded-full p-2">
          <Heart size={18} fill={userItem?.favorito ? '#ff4b5c' : 'none'} className={userItem?.favorito ? 'text-heart' : 'text-ink'} />
        </button>
      </div>

      <div className="px-4 py-3">
        <h1 className="font-display font-semibold text-xl text-ink">{titulo.nome}</h1>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted font-mono">
          <span>{titulo.genero}</span>
          {titulo.media_rating && (
            <span className="flex items-center gap-1 text-teal">
              <Star size={12} fill="currentColor" /> {titulo.media_rating} ({titulo.total_avaliacoes})
            </span>
          )}
        </div>
        <p className="text-sm text-ink mt-3 leading-relaxed">{titulo.sinopse}</p>

        <div className="flex items-center gap-2 mt-4">
          {!userItem ? (
            <button onClick={() => adicionar('quero_ver')} className="flex-1 bg-amber text-bg rounded-2xl py-3 font-display font-semibold text-sm shadow-[0_0_18px_rgba(243,194,85,0.35)]">
              + Seguir
            </button>
          ) : mediaType === 'tv' ? (
            <button
              onClick={() => setMenuStatusAberto(true)}
              className="flex-1 bg-surface border border-white/10 rounded-2xl py-3 text-center text-sm text-ink font-display font-medium"
            >
              {userItem.status === 'interrompida' ? 'Interrompida' : '✓ Seguindo'}
            </button>
          ) : (
            <button
              onClick={deixarDeSeguir}
              className="flex-1 bg-surface border border-white/10 rounded-2xl py-3 text-center text-sm text-ink font-display font-medium"
            >
              ✓ Seguindo
            </button>
          )}

          {mediaType === 'movie' && (
            <button
              onClick={marcarFilmeVisto}
              aria-label="Marcar como visto"
              className={`flex-shrink-0 w-12 h-12 rounded-2xl border flex items-center justify-center ${
                userItem?.status === 'visto' ? 'bg-teal border-teal text-bg shadow-[0_0_14px_rgba(221,13,244,0.45)]' : 'border-white/15 text-muted'
              }`}
            >
              <Check size={20} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 justify-center mt-4">
          {[1,2,3,4,5,6,7,8,9,10].map((n) => (
            <button key={n} onClick={() => avaliar(n)}>
              <Star size={16} fill={n <= minhaNota ? '#f3c255' : 'none'} className={n <= minhaNota ? 'text-amber' : 'text-muted'} />
            </button>
          ))}
        </div>
      </div>

      <SectionLabel>Elenco</SectionLabel>
      <div className="flex gap-3 px-4 pb-4 overflow-x-auto scroll-area">
        {elenco.map((c, i) => (
          <div key={i} className="flex-shrink-0 w-16 text-center">
            <div className="w-16 h-16 rounded-full bg-surface2 overflow-hidden">
              {c.ator?.image && <img src={`https://image.tmdb.org/t/p/w200${c.ator.image}`} className="w-full h-full object-cover" />}
            </div>
            <div className="text-[10px] text-ink mt-1 truncate">{c.ator?.name}</div>
            <div className="text-[9px] text-muted truncate">{c.personagem}</div>
          </div>
        ))}
      </div>

      {mediaType === 'tv' && (
        <>
          <SectionLabel>Episódios</SectionLabel>
          <div className="px-4 pb-8 flex flex-col gap-2">
            {temporadas.map((t) => {
              const epsDaTemporada = episodios.filter((e) => e.season_number === t)
              const assistidosCount = epsDaTemporada.filter((e) => assistidos.has(e.id)).length
              const todasAssistidas = assistidosCount === epsDaTemporada.length
              return (
                <div key={t} className="border border-white/10 rounded-2xl overflow-hidden">
                  <div className="flex items-center">
                    <button
                      onClick={() => setTemporadaAberta(temporadaAberta === t ? null : t)}
                      className="flex-1 flex justify-between px-3 py-2 text-sm text-ink font-mono"
                    >
                      Temporada {t}
                      <span className="text-muted">{assistidosCount}/{epsDaTemporada.length}</span>
                    </button>
                    <button
                      onClick={() => marcarTemporada(t, todasAssistidas)}
                      aria-label="Marcar temporada como vista"
                      className={`w-8 h-8 mr-2 flex-shrink-0 rounded-full flex items-center justify-center border ${
                        todasAssistidas ? 'bg-teal border-teal text-bg shadow-[0_0_10px_rgba(221,13,244,0.45)]' : 'border-white/15 text-muted'
                      }`}
                    >
                      <Check size={14} />
                    </button>
                  </div>
                  {temporadaAberta === t && (
                    <div className="flex flex-col">
                      {epsDaTemporada.map((e) => {
                        const marcado = assistidos.has(e.id)
                        return (
                          <button
                            key={e.id}
                            onClick={() => marcarEpisodio(e, marcado)}
                            className="flex items-center justify-between px-3 py-2 text-xs border-t border-surface2"
                          >
                            <span className={marcado ? 'text-muted' : 'text-ink'}>
                              E{String(e.episode_number).padStart(2, '0')} · {e.episode_name}
                            </span>
                            <span className={marcado ? 'text-teal' : 'text-muted'}>{marcado ? '✓' : '○'}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {confirmacao && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-6">
          <div className="bg-surface border border-white/10 rounded-2xl p-5 max-w-[340px] w-full">
            <p className="text-sm text-ink mb-4 leading-relaxed">{confirmacao.mensagem}</p>
            <div className="flex gap-3">
              <button
                onClick={confirmacao.aoRecusar}
                className="flex-1 border border-white/15 rounded-xl py-2.5 text-sm text-muted font-display font-medium"
              >
                Não
              </button>
              <button
                onClick={confirmacao.aoConfirmar}
                className="flex-1 bg-amber text-bg rounded-xl py-2.5 text-sm font-display font-semibold shadow-[0_0_14px_rgba(243,194,85,0.35)]"
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}

      {menuStatusAberto && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={() => setMenuStatusAberto(false)}>
          <div
            className="bg-surface border border-white/10 rounded-t-2xl p-4 w-full max-w-[480px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs text-muted font-mono uppercase mb-3 px-1">Gerenciar série</div>
            <div className="flex flex-col gap-2">
              {userItem?.status === 'interrompida' ? (
                <button
                  onClick={() => mudarStatus('quero_ver')}
                  className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-display font-medium bg-surface2 text-ink hover:bg-white/5"
                >
                  <Check size={16} className="text-teal" /> Voltar a Seguir (Ativa)
                </button>
              ) : (
                <button
                  onClick={() => mudarStatus('interrompida')}
                  className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-display font-medium bg-surface2 text-ink hover:bg-white/5"
                >
                  Interrompida
                </button>
              )}

              <button
                onClick={deixarDeSeguir}
                className="flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-display font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20"
              >
                Deixar de seguir
              </button>
            </div>
            <button
              onClick={() => setMenuStatusAberto(false)}
              className="w-full mt-2 py-2.5 text-sm text-muted font-display font-medium"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
