import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Heart, ChevronLeft, Star, Check, ChevronDown, ChevronUp, ChevronRight, Calendar, Lock } from 'lucide-react'
import { supabase, callFunction, idiomaAtual } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import SectionLabel from '../components/SectionLabel'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w400'

// Função auxiliar para formatar datas de YYYY-MM-DD para DD/MM/YYYY
function formatarData(dataStr) {
  if (!dataStr) return 'TBA'
  const partes = dataStr.split('-')
  if (partes.length < 3) return 'TBA'
  return `${partes[2]}/${partes[1]}/${partes[0]}`
}

function formatarDataExtensa(dataStr) {
  if (!dataStr) return 'TBA'
  const partes = dataStr.split('-')
  if (partes.length < 3) return 'TBA'
  const ano = partes[0]
  const mesIdx = parseInt(partes[1], 10) - 1
  const dia = parseInt(partes[2], 10)
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const mesNome = meses[mesIdx] || partes[1]
  return `${dia} de ${mesNome}. de ${ano}`
}

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

  // Obtém a data local de hoje em formato YYYY-MM-DD absoluto e seguro contra fuso horário
  const hojeLocal = new Date()
  const ano = hojeLocal.getFullYear()
  const mes = String(hojeLocal.getMonth() + 1).padStart(2, '0')
  const dia = String(hojeLocal.getDate()).padStart(2, '0')
  const hojeString = `${ano}-${mes}-${dia}`

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

    // Funções auxiliares locais de paginação concorrente para superar o limite de 1000 linhas
    const obterEpisodiosPaginados = async () => {
      if (tipo !== 'tv') return []
      let eps = []
      let de = 0
      const tamanho = 1000
      while (true) {
        const { data, error } = await supabase
          .from('episode')
          .select('id, season_number, episode_number, episode_name, launch_date, sinopse, duration')
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

    // LOTE CONCORRENTE PARALELO: Carrega todos os dados paginados e metadados ao mesmo tempo
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
    if (eps && eps.length > 0) {
      const temps = [...new Set(eps.map((e) => e.season_number))].sort((a, b) => a - b)
      if (temps.length > 0) setTemporadaAberta((prev) => prev ?? temps[0])
    }
    setAssistidos(new Set((watched ?? []).map((w) => w.episode_id)))
    setUserItem(item)
    setMinhaNota((prev) => rating?.rating_score ?? prev ?? 0)

    // Sincronização em Background Reativa silenciosa
    if (existente && tipo === 'tv' && user) {
      callFunction('adicionar-titulo', { 
        tmdb_id: Number(id), 
        media_type: 'tv', 
        status: 'none' 
      })
      .then(async () => {
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
    if (!user) return
    setMinhaNota(nota) // Atualização visual imediata para manter as estrelas douradas

    try {
      // Envia a avaliação via Edge Function 'leave-eval'
      const res = await callFunction('leave-eval', { titulo_id: Number(id), rating_score: nota })
      if (res?.error) {
        console.warn('[avaliar] Nota registrada localmente. Alerta do servidor:', res.error)
      }
    } catch (err) {
      console.warn('[avaliar] Erro na requisição de avaliação:', err)
    }
  }

  function episodiosAntesDe(alvo) {
    return episodios.filter(
      (e) =>
        !assistidos.has(e.id) &&
        e.launch_date && e.launch_date <= hojeString && // Apenas lançados
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

    // Filtra para marcar apenas episódios já lançados (evitando marcar futuros!)
    const faltantesLancados = epsDaTemporada.filter((e) => !assistidos.has(e.id) && e.launch_date && e.launch_date <= hojeString)
    const temporadasAnteriores = episodios.filter((e) => e.season_number < seasonNumber && !assistidos.has(e.id) && e.launch_date && e.launch_date <= hojeString)

    if (temporadasAnteriores.length > 0) {
      setConfirmacao({
        mensagem: `Tem temporada${temporadasAnteriores.length > 1 ? 's' : ''} anterior${temporadasAnteriores.length > 1 ? 'es' : ''} com episódio não assistido. Quer marcar ${temporadasAnteriores.length > 1 ? 'elas' : 'ela'} também como vista${temporadasAnteriores.length > 1 ? 's' : ''}?`,
        aoConfirmar: () => aplicarMarcacao([...temporadasAnteriores.map((e) => e.id), ...faltantesLancados.map((e) => e.id)], false),
        aoRecusar: () => aplicarMarcacao(faltantesLancados.map((e) => e.id), false),
      })
    } else {
      await aplicarMarcacao(faltantesLancados.map((e) => e.id), false)
    }
  }

  async function marcarFilmeVisto() {
    const novoStatus = userItem?.status === 'visto' ? 'quero_ver' : 'visto'
    
    // Atualização Visual Instantânea
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

  function handleVoltar() {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      const isTV = mediaType === 'tv' || searchParams.get('tipo') === 'tv' || (titulo && (titulo.temporadas > 0 || mediaType === 'tv'))
      navigate(isTV ? '/series' : '/filmes')
    }
  }

  if (!titulo) return <div className="p-4 text-muted text-sm font-mono">Carregando…</div>

  const temporadas = useMemo(() => {
    return [...new Set(episodios.map((e) => e.season_number))].sort((a, b) => a - b)
  }, [episodios])

  return (
    <div className="flex-1 overflow-y-auto scroll-area relative">
      {/* Barra de Topo Sticky com Botão de Voltar Aprimorado */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-bg/95 via-bg/80 to-transparent backdrop-blur-md">
        <button
          onClick={handleVoltar}
          aria-label="Voltar"
          className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-ink flex items-center justify-center transition-all shadow-md active:scale-95 cursor-pointer z-50"
        >
          <ChevronLeft size={22} />
        </button>
        <button
          onClick={favoritar}
          aria-label="Favoritar"
          className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 flex items-center justify-center transition-all shadow-md active:scale-95 cursor-pointer z-50"
        >
          <Heart size={20} fill={userItem?.favorito ? '#ff4b5c' : 'none'} className={userItem?.favorito ? 'text-heart' : 'text-ink'} />
        </button>
      </div>

      <div className="-mt-16 relative">
        {titulo.imagem && <img src={`${POSTER_BASE}${titulo.imagem}`} alt={titulo.nome} className="w-full aspect-[2/3] object-cover" />}
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

        {/* Seção de Avaliação (Sua Nota 1 a 10) com Estrelas e Número Embaixo */}
        <div className="bg-surface/70 border border-white/5 rounded-2xl p-4 pt-3 mt-4">
          <div className="flex items-center justify-between mb-2">
            <SectionLabel className="!px-0 !pt-0">Sua nota</SectionLabel>
            {minhaNota > 0 && (
              <span className="text-xs font-display font-bold text-amber">
                Sua nota: {minhaNota}/10
              </span>
            )}
          </div>

          <div className="grid grid-cols-10 gap-1 pt-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
              const selecionada = num <= minhaNota
              return (
                <button
                  key={num}
                  onClick={() => avaliar(num)}
                  aria-label={`Nota ${num}`}
                  className={`flex flex-col items-center justify-center py-2 rounded-xl transition-all duration-150 border cursor-pointer active:scale-95 ${
                    selecionada
                      ? 'bg-amber/15 border-amber/40 shadow-[0_0_10px_rgba(243,194,85,0.25)]'
                      : 'bg-surface2/40 border-white/5 hover:border-white/20'
                  }`}
                >
                  <Star
                    size={16}
                    fill={selecionada ? '#f3c255' : 'none'}
                    className={selecionada ? 'text-amber' : 'text-muted/40'}
                  />
                  <span
                    className={`text-[11px] font-display font-bold mt-1 ${
                      selecionada ? 'text-amber' : 'text-muted'
                    }`}
                  >
                    {num}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <SectionLabel>Elenco</SectionLabel>
      <div className="flex gap-3 px-4 pb-4 overflow-x-auto scroll-area">
        {elenco.map((c, i) => (
          <div key={i} className="flex-shrink-0 w-16 text-center">
            <div className="w-16 h-16 rounded-full bg-surface2 overflow-hidden border border-white/5">
              {c.ator?.image && (
                <img
                  src={`https://image.tmdb.org/t/p/w185${c.ator.image}`}
                  alt={c.ator?.name || 'Ator'}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div className="text-[10px] text-ink mt-1 truncate font-medium">{c.ator?.name}</div>
            <div className="text-[9px] text-muted truncate">{c.personagem}</div>
          </div>
        ))}
      </div>

      {mediaType === 'tv' && (
        <>
          <SectionLabel>Episódios</SectionLabel>
          <div className="px-4 pb-12 flex flex-col gap-3">
            {temporadas.map((t) => {
              const epsDaTemporada = episodios.filter((e) => e.season_number === t)
              const lancadosDaTemporada = epsDaTemporada.filter((e) => e.launch_date && e.launch_date <= hojeString)
              const assistidosCount = epsDaTemporada.filter((e) => assistidos.has(e.id)).length
              const todasAssistidas = lancadosDaTemporada.length > 0 && assistidosCount === lancadosDaTemporada.length
              const progressoPercent = epsDaTemporada.length > 0 ? Math.round((assistidosCount / epsDaTemporada.length) * 100) : 0
              const isAberta = temporadaAberta === t

              return (
                <div key={t} className="bg-surface border border-white/10 rounded-2xl overflow-hidden transition-all shadow-sm">
                  {/* Cabeçalho do Card da Temporada */}
                  <div className="p-3.5 bg-surface2/50 border-b border-white/5">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => setTemporadaAberta(isAberta ? null : t)}
                        className="flex-1 text-left flex items-center justify-between group py-0.5"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-display font-semibold text-base text-ink group-hover:text-amber transition-colors">
                              Temporada {t}
                            </span>
                            {todasAssistidas && (
                              <span className="text-[10px] font-display font-medium px-2 py-0.5 rounded-full bg-teal/20 text-teal border border-teal/30">
                                Concluída
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted font-sans mt-0.5">
                            {assistidosCount}/{epsDaTemporada.length} episódios assistidos
                          </div>
                        </div>
                        <div className="p-1 text-muted group-hover:text-ink transition-colors mr-1">
                          {isAberta ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                      </button>

                      {/* Botão de marcar temporada inteira */}
                      <button
                        onClick={() => marcarTemporada(t, todasAssistidas)}
                        aria-label="Marcar temporada como vista"
                        title={todasAssistidas ? "Desmarcar temporada" : "Marcar toda a temporada como assistida"}
                        className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center border transition-all ${
                          todasAssistidas
                            ? 'bg-teal border-teal text-bg shadow-[0_0_12px_rgba(221,13,244,0.45)]'
                            : 'border-white/15 text-muted hover:border-white/40 hover:text-ink'
                        }`}
                      >
                        <Check size={16} strokeWidth={2.5} />
                      </button>
                    </div>

                    {/* Barra de Progresso da Temporada */}
                    <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mt-3">
                      <div
                        className="bg-amber h-full transition-all duration-300 rounded-full"
                        style={{ width: `${progressoPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Lista de Episódios Ampliada */}
                  {isAberta && (
                    <div className="p-2.5 flex flex-col gap-2.5 bg-bg/40">
                      {epsDaTemporada.map((e) => {
                        const marcado = assistidos.has(e.id)
                        const lancado = e.launch_date && e.launch_date <= hojeString

                        if (lancado) {
                          return (
                            <div
                              key={e.id}
                              onClick={() => navigate(`/episodio/${e.id}`)}
                              className="group relative flex items-center gap-3 p-3 bg-surface hover:bg-surface2 rounded-xl border border-white/5 hover:border-white/15 transition-all duration-200 cursor-pointer active:scale-[0.995]"
                            >
                              {/* Checkbox para marcar visto (sem acionar navegação da linha) */}
                              <button
                                onClick={(evt) => {
                                  evt.stopPropagation()
                                  marcarEpisodio(e, marcado)
                                }}
                                aria-label={marcado ? "Marcar como não visto" : "Marcar como visto"}
                                className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center border transition-all ${
                                  marcado
                                    ? 'bg-teal border-teal text-bg shadow-[0_0_10px_rgba(221,13,244,0.4)]'
                                    : 'border-white/20 text-muted hover:border-white/40 hover:text-ink'
                                }`}
                              >
                                <Check size={16} strokeWidth={2.5} />
                              </button>

                              {/* Miniatura / Badge do Episódio */}
                              <div className="w-16 h-12 bg-surface2 rounded-lg overflow-hidden flex-shrink-0 relative border border-white/10 flex items-center justify-center">
                                {titulo.imagem ? (
                                  <img
                                    src={`${POSTER_BASE}${titulo.imagem}`}
                                    alt=""
                                    className="w-full h-full object-cover opacity-75 group-hover:opacity-100 transition-opacity"
                                  />
                                ) : null}
                                <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                                  <span className="font-display font-semibold text-xs text-ink drop-shadow">
                                    E{String(e.episode_number).padStart(2, '0')}
                                  </span>
                                </div>
                              </div>

                              {/* Informações Principais do Episódio */}
                              <div className="flex-1 min-w-0">
                                <div className="font-display font-medium text-sm text-ink truncate group-hover:text-amber transition-colors">
                                  <span className="text-amber/90 font-semibold mr-1.5">{e.episode_number}.</span>
                                  {e.episode_name}
                                </div>
                                <div className="text-xs text-muted font-sans mt-0.5 flex items-center gap-2">
                                  {marcado ? (
                                    <span className="text-teal font-medium">Assistido</span>
                                  ) : (
                                    <span>Lançamento: {formatarDataExtensa(e.launch_date)}</span>
                                  )}
                                  {e.duration && (
                                    <span className="text-muted/60">· {e.duration} min</span>
                                  )}
                                </div>
                              </div>

                              {/* Chevron de indicação de linha clicável */}
                              <ChevronRight size={18} className="text-muted/40 group-hover:text-ink group-hover:translate-x-0.5 transition-all flex-shrink-0 mr-0.5" />
                            </div>
                          )
                        } else {
                          // Episódio Não Lançado / Inédito
                          return (
                            <div
                              key={e.id}
                              onClick={() => navigate(`/episodio/${e.id}`)}
                              className="flex items-center gap-3 p-3 bg-surface/40 hover:bg-surface/80 rounded-xl border border-white/5 opacity-70 hover:opacity-100 transition-all cursor-pointer"
                            >
                              <div className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center border border-white/10 text-muted/40">
                                <Lock size={14} />
                              </div>
                              <div className="w-16 h-12 bg-surface2 rounded-lg overflow-hidden flex-shrink-0 relative border border-white/5 flex items-center justify-center">
                                {titulo.imagem ? (
                                  <img
                                    src={`${POSTER_BASE}${titulo.imagem}`}
                                    alt=""
                                    className="w-full h-full object-cover grayscale opacity-30"
                                  />
                                ) : null}
                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                  <span className="font-display font-semibold text-xs text-muted">
                                    E{String(e.episode_number).padStart(2, '0')}
                                  </span>
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-display font-medium text-sm text-muted truncate">
                                  <span className="mr-1.5">{e.episode_number}.</span>
                                  {e.episode_name}
                                </div>
                                <div className="text-xs text-muted/70 font-sans mt-0.5 flex items-center gap-1">
                                  <Calendar size={12} className="text-muted/60" />
                                  <span>Estreia em {formatarDataExtensa(e.launch_date)}</span>
                                </div>
                              </div>
                            </div>
                          )
                        }
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
