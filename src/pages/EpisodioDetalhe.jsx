import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Star, Check, Calendar, Clock, Eye, Lock, RotateCcw, MessageSquare } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { invalidateCache } from '../lib/dataCache'
import { registrarAssistido, apagarHistorico, contarAssistidosPorEpisodio } from '../lib/watchLog'
import { enviarImagemComentario } from '../lib/uploadImagem'
import {
  buscarComentarios,
  buscarContagemComentarios,
  postarComentario,
  alternarReacao,
  aplicarReacaoOtimista,
  atualizarComentarioNasThreads,
  REACAO_VAZIA,
} from '../lib/comentarios'
import SectionLabel from '../components/SectionLabel'
import ActionSheet from '../components/ActionSheet'
import ComentarioThread from '../components/ComentarioThread'
import ComentarioComposer from '../components/ComentarioComposer'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w500'

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

export default function EpisodioDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, perfil } = useAuth()

  const [episodio, setEpisodio] = useState(null)
  const [titulo, setTitulo] = useState(null)
  const [assistido, setAssistido] = useState(false)
  const [minhaNota, setMinhaNota] = useState(0)
  const [reviewTexto, setReviewTexto] = useState('')
  const [reviewRascunho, setReviewRascunho] = useState('')
  const [salvandoReview, setSalvandoReview] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [expandirSinopse, setExpandirSinopse] = useState(false)
  const [proximoEpisodio, setProximoEpisodio] = useState(null)
  const [episodioAnterior, setEpisodioAnterior] = useState(null)
  const [vezesAssistido, setVezesAssistido] = useState(0)
  const [sheetAssistidoAberto, setSheetAssistidoAberto] = useState(false)
  const [threadsComentarios, setThreadsComentarios] = useState([])
  const [contagemComentarios, setContagemComentarios] = useState(0)
  const [comentariosAbertos, setComentariosAbertos] = useState(false)
  const [avisoSpoilerAberto, setAvisoSpoilerAberto] = useState(false)

  useEffect(() => {
    carregarDados()
  }, [id, user])

  useEffect(() => {
    buscarContagemComentarios({ episodeId: Number(id) }).then(setContagemComentarios)
  }, [id])

  // Antes de abrir os comentários, verifica se a pessoa já marcou o episódio como
  // visto — se não, mostra o aviso de spoiler em vez de abrir direto.
  function tentarAbrirComentarios() {
    if (assistido) {
      abrirComentarios()
    } else {
      setAvisoSpoilerAberto(true)
    }
  }

  async function abrirComentarios() {
    setAvisoSpoilerAberto(false)
    const threads = await buscarComentarios({ episodeId: Number(id), currentUserId: user?.id })
    setThreadsComentarios(threads)
    setComentariosAbertos(true)
  }

  async function reagirComentario(comentario, tipo) {
    if (!user) return
    const reacaoAnterior = comentario.reacoes?.minhaReacao ?? null

    setThreadsComentarios((prev) =>
      atualizarComentarioNasThreads(prev, comentario.id, (c) => aplicarReacaoOtimista(c, tipo))
    )

    const { error } = await alternarReacao({ comentarioId: comentario.id, userId: user.id, tipo, reacaoAtual: reacaoAnterior })
    if (error) {
      console.error('Erro ao reagir:', error)
      const threads = await buscarComentarios({ episodeId: Number(id), currentUserId: user?.id })
      setThreadsComentarios(threads)
    }
  }

  async function marcarVistoEAbrirComentarios() {
    await marcarAssistido()
    abrirComentarios()
  }

  async function enviarComentarioRaiz({ texto, imagemFile, gifUrl }) {
    if (!user) return false
    const { url: imagemUrl, error: erroImagem } = await enviarImagemComentario(imagemFile, user.id)
    if (erroImagem) return false
    const { data, error } = await postarComentario({ userId: user.id, texto, episodeId: Number(id), imagemUrl, gifUrl })
    if (error) {
      console.error('Erro ao comentar:', error)
      return false
    }
    const novaThread = {
      raiz: { ...data, autor: { username: perfil?.username, foto_perfil: perfil?.foto_perfil }, reacoes: { ...REACAO_VAZIA } },
      respostas: [],
    }
    setThreadsComentarios((prev) => [novaThread, ...prev])
    setContagemComentarios((c) => c + 1)
    return true
  }

  async function enviarResposta({ texto, imagemFile, gifUrl }, threadId) {
    if (!user) return false
    const { url: imagemUrl, error: erroImagem } = await enviarImagemComentario(imagemFile, user.id)
    if (erroImagem) return false
    const { data, error } = await postarComentario({ userId: user.id, texto, episodeId: Number(id), threadId, imagemUrl, gifUrl })
    if (error) {
      console.error('Erro ao responder comentário:', error)
      return false
    }
    const novaResposta = {
      ...data,
      autor: { username: perfil?.username, foto_perfil: perfil?.foto_perfil },
      reacoes: { ...REACAO_VAZIA },
    }
    setThreadsComentarios((prev) =>
      prev.map((t) => (t.raiz.id === threadId ? { ...t, respostas: [...t.respostas, novaResposta] } : t))
    )
    setContagemComentarios((c) => c + 1)
    return true
  }

  async function carregarDados() {
    setCarregando(true)
    try {
      // 1. Buscar detalhes do episódio
      const { data: epData, error: epError } = await supabase
        .from('episode')
        .select('*')
        .eq('id', id)
        .single()

      if (epError || !epData) {
        console.error('Erro ao buscar episódio:', epError)
        setCarregando(false)
        return
      }
      setEpisodio(epData)

      // 2. Buscar detalhes da série mãe (Título)
      const { data: titData } = await supabase
        .from('titulo')
        .select('*')
        .eq('id', epData.titulo_id)
        .single()
      
      setTitulo(titData)

      // 3. Buscar status de visto do usuário (se for usuário com UUID válido)
      const isRealUser = user && user.id && user.id !== 'demo-user-id'
      if (isRealUser) {
        const { data: watchedData } = await supabase
          .from('watched_episode')
          .select('episode_id')
          .eq('user_id', user.id)
          .eq('episode_id', id)
          .maybeSingle()

        setAssistido(!!watchedData)

        // 3.1 Buscar quantas vezes o usuário já assistiu este episódio (histórico de reassistidas)
        const contagem = await contarAssistidosPorEpisodio(user.id, [Number(id)])
        setVezesAssistido(contagem.get(Number(id)) ?? 0)

        // 4. Buscar nota dada pelo usuário para o episódio
        const { data: ratingData } = await supabase
          .from('user_rating_episode')
          .select('rating_score, review_texto')
          .eq('user_id', user.id)
          .eq('episode_id', id)
          .maybeSingle()

        if (ratingData) {
          setMinhaNota(ratingData.rating_score)
        } else {
          setMinhaNota(0)
        }
        setReviewTexto(ratingData?.review_texto ?? '')
        setReviewRascunho(ratingData?.review_texto ?? '')
      }

      // 5. Buscar episódio anterior e próximo da mesma série
      // (busca direta pelos vizinhos, evitando carregar a lista inteira de episódios
      // que pode ultrapassar o limite padrão de linhas do Supabase em séries longas)
      const sn = epData.season_number
      const en = epData.episode_number

      const { data: anteriorData } = await supabase
        .from('episode')
        .select('id, season_number, episode_number, episode_name')
        .eq('titulo_id', epData.titulo_id)
        .or(`season_number.lt.${sn},and(season_number.eq.${sn},episode_number.lt.${en})`)
        .order('season_number', { ascending: false })
        .order('episode_number', { ascending: false })
        .limit(1)
        .maybeSingle()

      setEpisodioAnterior(anteriorData || null)

      const { data: proximoData } = await supabase
        .from('episode')
        .select('id, season_number, episode_number, episode_name')
        .eq('titulo_id', epData.titulo_id)
        .or(`season_number.gt.${sn},and(season_number.eq.${sn},episode_number.gt.${en})`)
        .order('season_number', { ascending: true })
        .order('episode_number', { ascending: true })
        .limit(1)
        .maybeSingle()

      setProximoEpisodio(proximoData || null)

    } catch (err) {
      console.error('Erro ao carregar EpisodioDetalhe:', err)
    } finally {
      setCarregando(false)
    }
  }

  function alternarAssistido() {
    if (!user || !episodio) return
    if (assistido) {
      // Já assistido: abre o menu de reassistir/não visto em vez de desmarcar direto
      setSheetAssistidoAberto(true)
      return
    }
    marcarAssistido()
  }

  async function marcarAssistido() {
    setAssistido(true)
    setVezesAssistido((v) => v + 1)
    invalidateCache(['series', 'perfil'])

    const isRealUser = user && user.id && user.id !== 'demo-user-id'
    try {
      if (isRealUser) {
        await supabase.from('watched_episode').upsert({
          user_id: user.id,
          episode_id: Number(id),
          watched_at: new Date().toISOString()
        })
        await registrarAssistido({ userId: user.id, episodeIds: [Number(id)] })
      }
    } catch (err) {
      console.error('Erro ao marcar assistido:', err)
      setAssistido(false)
      setVezesAssistido((v) => Math.max(0, v - 1))
    }
  }

  async function marcarNaoVisto() {
    setAssistido(false)
    setVezesAssistido(0)
    setSheetAssistidoAberto(false)
    invalidateCache(['series', 'perfil'])

    const isRealUser = user && user.id && user.id !== 'demo-user-id'
    try {
      if (isRealUser) {
        await supabase
          .from('watched_episode')
          .delete()
          .eq('user_id', user.id)
          .eq('episode_id', Number(id))
        await apagarHistorico({ userId: user.id, episodeIds: [Number(id)] })
      }
    } catch (err) {
      console.error('Erro ao marcar como não visto:', err)
      setAssistido(true)
    }
  }

  function confirmarReassistir() {
    setSheetAssistidoAberto(false)
    marcarAssistido()
  }

  async function avaliarEpisodio(nota) {
    if (!episodio) return
    const notaDada = minhaNota === nota ? 0 : nota
    setMinhaNota(notaDada)
    invalidateCache(['perfil'])

    const isRealUser = user && user.id && user.id !== 'demo-user-id'

    try {
      if (notaDada > 0) {
        if (isRealUser) {
          const { error: upsertErr } = await supabase.from('user_rating_episode').upsert({
            user_id: user.id,
            episode_id: Number(id),
            rating_score: notaDada,
            review_texto: reviewTexto || null,
            rated_at: new Date().toISOString()
          })
          if (upsertErr) console.warn('Aviso upsert rating:', upsertErr)
        }
      } else {
        if (isRealUser) {
          const { error: delErr } = await supabase
            .from('user_rating_episode')
            .delete()
            .eq('user_id', user.id)
            .eq('episode_id', Number(id))
          if (delErr) console.warn('Aviso delete rating:', delErr)
          setReviewTexto('')
          setReviewRascunho('')
        }
      }

      // Buscar atualização do episódio
      const { data: epAtualizado } = await supabase
        .from('episode')
        .select('media_rating, total_avaliacoes')
        .eq('id', id)
        .maybeSingle()

      if (epAtualizado && epAtualizado.media_rating !== null) {
        setEpisodio((prev) => ({
          ...prev,
          media_rating: epAtualizado.media_rating,
          total_avaliacoes: epAtualizado.total_avaliacoes
        }))
      }
    } catch (err) {
      console.error('Erro ao avaliar episódio:', err)
    }
  }

  async function salvarReviewEpisodio() {
    if (!user || minhaNota <= 0) return
    setSalvandoReview(true)

    const { error } = await supabase.from('user_rating_episode').upsert({
      user_id: user.id,
      episode_id: Number(id),
      rating_score: minhaNota,
      review_texto: reviewRascunho || null,
      rated_at: new Date().toISOString(),
    })

    setSalvandoReview(false)
    if (error) {
      console.error('Erro ao salvar review do episódio:', error)
      return
    }
    setReviewTexto(reviewRascunho)
  }

  function handleVoltar() {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else if (titulo) {
      navigate(`/titulo/${titulo.id}?tipo=tv`)
    } else {
      navigate('/series')
    }
  }

  if (carregando) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm font-mono">
        Carregando episódio…
      </div>
    )
  }

  if (!episodio) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-muted font-sans text-sm mb-4">Episódio não encontrado.</p>
        <button
          onClick={handleVoltar}
          className="px-4 py-2 bg-surface rounded-xl text-ink font-display font-medium text-xs border border-white/10"
        >
          Voltar
        </button>
      </div>
    )
  }

  const sinopseTexto = episodio.sinopse || 'Nenhuma sinopse cadastrada para este episódio.'
  const sinopseLonga = sinopseTexto.length > 180

  return (
    <div className="flex-1 overflow-y-auto scroll-area relative pb-12">
      {/* Imagem de Capa e Header Superior */}
      <div className="relative w-full aspect-[16/9] max-h-[280px] bg-surface2 overflow-hidden">
        {titulo?.imagem ? (
          <img
            src={`${POSTER_BASE}${titulo.imagem}`}
            alt={episodio.episode_name}
            className="w-full h-full object-cover opacity-80"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-surface to-surface2 flex items-center justify-center text-muted font-mono text-xs">
            Sem Imagem
          </div>
        )}

        {/* Overlay escuro gradiente */}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-black/60" />

        {/* Botão de Voltar Flutuante */}
        <button
          onClick={handleVoltar}
          aria-label="Voltar"
          className="absolute top-3 left-3 w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-ink flex items-center justify-center transition-all shadow-lg active:scale-95 z-10"
        >
          <ChevronLeft size={22} />
        </button>

        {/* Atalho para a Série (Pill de Atalho da Série no Canto Superior Direito) */}
        {titulo && (
          <button
            onClick={() => navigate(`/titulo/${titulo.id}?tipo=tv`)}
            className="absolute top-3 right-3 max-w-[60%] flex items-center gap-2 pl-1.5 pr-2.5 py-1 bg-black/70 hover:bg-black/90 border border-white/20 rounded-full text-ink text-xs font-display font-semibold transition-all shadow-lg z-10 truncate backdrop-blur-md active:scale-95"
          >
            {titulo.imagem && (
              <img
                src={`${POSTER_BASE}${titulo.imagem}`}
                alt=""
                className="w-5 h-5 rounded-full object-cover flex-shrink-0 border border-white/20"
              />
            )}
            <span className="truncate text-amber">{titulo.nome}</span>
            <ChevronRight size={14} className="text-muted flex-shrink-0" />
          </button>
        )}

        {/* Avaliação Média do Episódio (Badge em Destaque sobre a imagem) */}
        <div className="absolute bottom-3 left-4 flex items-center gap-1.5 px-3 py-1 bg-black/75 backdrop-blur-md rounded-full border border-white/15 text-amber text-xs font-display font-extrabold shadow-md z-10">
          <Star size={14} fill="#f3c255" />
          <span>{episodio.media_rating ? Number(episodio.media_rating).toFixed(1) : '--'}</span>
          <span className="text-muted font-normal text-[11px] ml-0.5">
            ({episodio.total_avaliacoes ?? 0})
          </span>
        </div>
      </div>

      {/* Conteúdo do Episódio */}
      <div className="px-4 pt-3 flex flex-col gap-4">
        {/* Identificador de Temporada / Episódio + Nome da Série Clicável */}
        <div>
          <div className="flex items-center gap-2 flex-wrap text-xs font-display font-bold text-amber">
            <span className="bg-amber/15 border border-amber/30 text-amber px-2.5 py-0.5 rounded-full tracking-wide">
              S{String(episodio.season_number).padStart(2, '0')}E{String(episodio.episode_number).padStart(2, '0')}
            </span>

            {titulo && (
              <button
                onClick={() => navigate(`/titulo/${titulo.id}?tipo=tv`)}
                className="text-muted hover:text-ink transition-colors flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
              >
                <span>em</span>
                <span className="text-ink font-semibold">{titulo.nome}</span>
                <ChevronRight size={14} />
              </button>
            )}
          </div>

          {/* Nome do Episódio */}
          <h1 className="text-2xl font-display font-extrabold text-ink mt-2 leading-tight">
            {episodio.episode_name}
          </h1>

          {/* Metadados: Data de lançamento e Duração */}
          <div className="flex items-center gap-3 text-xs text-muted font-sans mt-2">
            <span className="flex items-center gap-1">
              <Calendar size={13} className="text-muted/70" />
              {formatarDataExtensa(episodio.launch_date)}
            </span>
            {episodio.duration && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock size={13} className="text-muted/70" />
                  {episodio.duration} min
                </span>
              </>
            )}
          </div>
        </div>

        {/* Botão Marcar como Visto */}
        <button
          onClick={alternarAssistido}
          className={`w-full py-3.5 px-4 rounded-2xl font-display font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 shadow-md active:scale-[0.98] ${
            assistido
              ? 'bg-teal/20 text-teal border border-teal/40 shadow-[0_0_15px_rgba(221,13,244,0.3)]'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/30'
          }`}
        >
          {assistido ? (
            <>
              <Check size={18} strokeWidth={2.5} />
              <span>Episódio assistido{vezesAssistido > 1 ? ` · ${vezesAssistido}x` : ''}</span>
            </>
          ) : (
            <>
              <Eye size={18} />
              <span>Marcar como visto</span>
            </>
          )}
        </button>

        {/* Sinopse do Episódio */}
        <div className="bg-surface/70 border border-white/5 rounded-2xl p-4 pt-3">
          <SectionLabel className="!px-0 !pt-0 mb-1">Sinopse</SectionLabel>
          <p className="text-sm font-sans text-ink/90 leading-relaxed">
            {sinopseLonga && !expandirSinopse
              ? `${sinopseTexto.slice(0, 180)}...`
              : sinopseTexto}
          </p>
          {sinopseLonga && (
            <button
              onClick={() => setExpandirSinopse(!expandirSinopse)}
              className="mt-2 text-xs font-display font-semibold text-amber hover:underline focus:outline-none"
            >
              {expandirSinopse ? 'Ver menos' : 'Ver mais'}
            </button>
          )}
        </div>

        {/* Seção de Avaliação (Sua Nota 1 a 10) */}
        <div className="bg-surface/70 border border-white/5 rounded-2xl p-4 pt-3">
          <div className="flex items-center justify-between mb-2">
            <SectionLabel className="!px-0 !pt-0">Sua nota</SectionLabel>
            {minhaNota > 0 && (
              <span className="text-xs font-display font-bold text-amber">
                Sua nota: {minhaNota}/10
              </span>
            )}
          </div>

          {/* Teclado Seletor de Notas com Estrelas de 1 a 10 e Número Embaixo */}
          <div className="grid grid-cols-10 gap-1 pt-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
              const selecionada = num <= minhaNota
              return (
                <button
                  key={num}
                  onClick={() => avaliarEpisodio(num)}
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

          {minhaNota > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              {reviewTexto && reviewRascunho === reviewTexto ? (
                <div>
                  <p className="text-sm text-ink/90 leading-relaxed whitespace-pre-wrap">{reviewTexto}</p>
                  <button
                    onClick={() => setReviewTexto('')}
                    className="mt-2 text-xs font-display font-semibold text-amber hover:underline"
                  >
                    Editar review
                  </button>
                </div>
              ) : (
                <div>
                  <textarea
                    value={reviewRascunho}
                    onChange={(e) => setReviewRascunho(e.target.value)}
                    placeholder="Deixar uma review (opcional)"
                    rows={3}
                    className="w-full bg-surface2/40 border border-white/10 rounded-xl p-2.5 text-sm text-ink placeholder:text-muted/60 resize-none focus:outline-none focus:border-amber/40"
                  />
                  <button
                    onClick={salvarReviewEpisodio}
                    disabled={salvandoReview}
                    className="mt-2 px-3 py-1.5 bg-amber text-bg rounded-xl text-xs font-display font-semibold disabled:opacity-60"
                  >
                    {salvandoReview ? 'Salvando…' : 'Salvar review'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={tentarAbrirComentarios}
          className="w-full flex items-center gap-3 bg-surface border border-white/10 rounded-2xl p-3.5 hover:border-white/20 transition-colors"
        >
          <MessageSquare size={18} className="text-teal flex-shrink-0" />
          <span className="flex-1 text-left text-sm font-display font-medium text-ink">Comentários</span>
          {contagemComentarios > 0 && (
            <span className="text-xs font-mono text-teal bg-teal/10 px-2 py-0.5 rounded-full">{contagemComentarios}</span>
          )}
          <ChevronRight size={16} className="text-muted flex-shrink-0" />
        </button>

        {/* Navegação Entre Episódios (Anterior / Próximo) */}
        {(episodioAnterior || proximoEpisodio) && (
          <div className="flex items-center justify-between gap-3 pt-2">
            {episodioAnterior ? (
              <button
                onClick={() => navigate(`/episodio/${episodioAnterior.id}`)}
                className="flex-1 min-w-0 p-3 bg-surface/50 hover:bg-surface border border-white/5 hover:border-white/15 rounded-xl flex items-center gap-2 text-left transition-all group"
              >
                <ChevronLeft size={16} className="text-muted group-hover:text-amber transition-colors flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] font-display text-muted uppercase">Anterior</div>
                  <div className="text-xs font-display font-semibold text-ink truncate">
                    E{String(episodioAnterior.episode_number).padStart(2, '0')} · {episodioAnterior.episode_name}
                  </div>
                </div>
              </button>
            ) : <div className="flex-1" />}

            {proximoEpisodio ? (
              <button
                onClick={() => navigate(`/episodio/${proximoEpisodio.id}`)}
                className="flex-1 min-w-0 p-3 bg-surface/50 hover:bg-surface border border-white/5 hover:border-white/15 rounded-xl flex items-center justify-end text-right gap-2 transition-all group"
              >
                <div className="min-w-0">
                  <div className="text-[10px] font-display text-muted uppercase">Próximo</div>
                  <div className="text-xs font-display font-semibold text-ink truncate">
                    E{String(proximoEpisodio.episode_number).padStart(2, '0')} · {proximoEpisodio.episode_name}
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted group-hover:text-amber transition-colors flex-shrink-0" />
              </button>
            ) : <div className="flex-1" />}
          </div>
        )}
      </div>

      <ActionSheet
        open={sheetAssistidoAberto}
        title="Episódio assistido"
        onClose={() => setSheetAssistidoAberto(false)}
        options={[
          { label: 'Marcar como reassistido', tone: 'primary', icon: <RotateCcw size={16} />, onClick: confirmarReassistir },
          { label: 'Marcar como não visto', tone: 'danger', onClick: marcarNaoVisto },
        ]}
      />

      <ActionSheet
        open={avisoSpoilerAberto}
        title="Você ainda não viu este episódio — os comentários podem ter spoilers"
        onClose={() => setAvisoSpoilerAberto(false)}
        options={[
          { label: 'Mostrar mesmo assim', onClick: abrirComentarios },
          { label: 'Assisti a este episódio', tone: 'primary', icon: <Check size={16} />, onClick: marcarVistoEAbrirComentarios },
        ]}
      />

      {comentariosAbertos && (
        <div className="fixed inset-0 bg-bg z-50 flex flex-col max-w-[480px] mx-auto w-full left-0 right-0">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
            <button onClick={() => setComentariosAbertos(false)} className="text-muted">
              <ChevronLeft size={22} />
            </button>
            <div className="text-base text-ink font-display font-semibold">Comentários</div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area px-4 py-4">
            {user && (
              <div className="mb-4">
                <ComentarioComposer onEnviar={enviarComentarioRaiz} />
              </div>
            )}
            {threadsComentarios.length === 0 ? (
              <div className="text-muted text-sm font-mono py-2">Nenhum comentário ainda.</div>
            ) : (
              threadsComentarios.map((t) => (
                <ComentarioThread key={t.raiz.id} thread={t} onResponder={enviarResposta} onReagir={reagirComentario} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
