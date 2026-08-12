import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical, Plus, ChevronRight, LayoutGrid, ArrowLeft, Camera, Loader2, X, Check } from 'lucide-react'
import Cropper from 'react-easy-crop'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { getCache, setCache, onCacheInvalidate } from '../lib/dataCache'
import { formatarDuracao } from '../lib/format'
import { getCroppedImg } from '../lib/cropImage'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'
import PosterCard from '../components/PosterCard'

// O Supabase/PostgREST tem um limite padrão de "max rows" por requisição
// (normalmente 1000), que corta a resposta mesmo se você pedir um .range()
// maior. Pra buscar tudo de verdade, pagina em lotes com ordenação determinística
// e concatena até a página voltar vazia ou menor que o tamanho pedido.
async function buscarTodasLinhas(construirQuery, tamanhoPagina = 1000) {
  let todas = []
  let inicio = 0
  while (true) {
    const { data, error } = await construirQuery().range(inicio, inicio + tamanhoPagina - 1)
    if (error) {
      console.error('[buscarTodasLinhas] Erro ao carregar pagina:', error)
      break
    }
    todas = todas.concat(data ?? [])
    if (!data || data.length < tamanhoPagina) break
    inicio += tamanhoPagina
  }
  return todas
}

// Auxiliar para fatiar consultas `.in(...)` em lotes menores (evita estouro de tamanho de URL HTTP 414)
async function buscarEmLotesIn(construirQueryBase, coluna, ids, tamanhoLote = 200) {
  if (!ids || ids.length === 0) return []
  let resultados = []
  for (let i = 0; i < ids.length; i += tamanhoLote) {
    const lote = ids.slice(i, i + tamanhoLote)
    const res = await buscarTodasLinhas(() =>
      construirQueryBase().in(coluna, lote)
    )
    resultados = resultados.concat(res)
  }
  return resultados
}

const POSTER_BASE_THUMB = 'https://image.tmdb.org/t/p/w200'

function urlPoster(caminho) {
  if (!caminho) return null
  return caminho.startsWith('http') ? caminho : `${POSTER_BASE_THUMB}${caminho}`
}

export default function Perfil() {
  const { user, perfil, recarregarPerfil } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)

  const [seriesFavoritas, setSeriesFavoritas] = useState([])
  const [filmesFavoritos, setFilmesFavoritos] = useState([])
  const [jogosFavoritos, setJogosFavoritos] = useState([])
  const [minhasSeries, setMinhasSeries] = useState([])
  const [meusFilmes, setMeusFilmes] = useState([])
  const [meusJogos, setMeusJogos] = useState([])

  const [listas, setListas] = useState([])
  const [criandoLista, setCriandoLista] = useState(false)
  const [todasListasAbertas, setTodasListasAbertas] = useState(false)
  const [listaAtualIndex, setListaAtualIndex] = useState(0)
  const listasScrollRef = useRef(null)

  // Upload de foto de perfil (avatar) e capa
  const [enviandoAvatar, setEnviandoAvatar] = useState(false)
  const [enviandoCapa, setEnviandoCapa] = useState(false)
  const inputAvatarRef = useRef(null)
  const inputCapaRef = useRef(null)

  // Modal de recorte (zoom/arrastar) exibido antes de enviar a foto escolhida.
  // { tipo: 'avatar' | 'capa', imagemSrc: objectURL } | null
  const [modalRecorte, setModalRecorte] = useState(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [areaRecortePixels, setAreaRecortePixels] = useState(null)
  const [salvandoRecorte, setSalvandoRecorte] = useState(false)

  // Seção atualmente expandida em tela cheia (ou null se nenhuma) - guarda o
  // título do cabeçalho e a lista completa de itens (já carregada em memória,
  // então abrir não precisa refazer nenhuma busca).
  const [secaoExpandida, setSecaoExpandida] = useState(null)

  useEffect(() => {
    if (!user) return

    const cacheKey = `perfil_data_${user.id}`
    const cached = getCache(cacheKey)

    if (cached?.data) {
      const {
        stats: cachedStats,
        seriesFavoritas: sf,
        filmesFavoritos: ff,
        jogosFavoritos: jf,
        minhasSeries: ms,
        meusFilmes: mf,
        meusJogos: mj,
        listas: ls,
      } = cached.data
      setStats(cachedStats)
      setSeriesFavoritas(sf ?? [])
      setFilmesFavoritos(ff ?? [])
      setJogosFavoritos(jf ?? [])
      setMinhasSeries(ms ?? [])
      setMeusFilmes(mf ?? [])
      setMeusJogos(mj ?? [])
      setListas(ls ?? [])

      if (cached.isStale) {
        carregar()
      }
    } else {
      carregar()
    }

    const unsubscribe = onCacheInvalidate((keys) => {
      if (!keys || keys.includes('perfil') || keys.includes('user_item') || keys.includes('watched_episode')) {
        carregar()
      }
    })

    return () => unsubscribe()
  }, [user])

  async function carregar() {
    try {
      // --- LOTE PARALELO 1: Dispara as 4 buscas iniciais pesadas ao mesmo tempo ---
      const [epsComDataRes, filmesVistosRaw, favoritosRaw, listasData] = await Promise.all([
        buscarTodasLinhas(() =>
          supabase
            .from('watched_episode')
            .select('episode_id, watched_at, episode(duration, titulo_id)')
            .eq('user_id', user.id)
            .order('episode_id', { ascending: true })
        ),
        buscarTodasLinhas(() =>
          supabase
            .from('user_item')
            .select('titulo_id, status_atualizado_em, status, titulo(id, nome, imagem)')
            .eq('user_id', user.id)
            .eq('status', 'visto')
            .order('titulo_id', { ascending: true })
        ),
        buscarTodasLinhas(() =>
          supabase
            .from('user_item')
            .select('titulo_id, status_atualizado_em, titulo(id, nome, imagem)')
            .eq('user_id', user.id)
            .eq('favorito', true)
            .order('titulo_id', { ascending: true })
        ),
        supabase
          .from('lista')
          .select('id, nome, lista_item(titulo_id, added_at, titulo(nome, imagem))')
          .eq('user_id', user.id)
          .then((res) => {
            if (res.error) console.error('Erro ao buscar listas:', res.error)
            return res.data ?? []
          })
      ])

      const epsComData = epsComDataRes ?? []

      const minutosTv = epsComData.reduce((soma, e) => soma + (e.episode?.duration ?? 0), 0)
      const ultimaDataPorSerie = new Map()
      for (const e of epsComData) {
        const tid = e.episode?.titulo_id
        if (!tid) continue
        const dataValida = e.watched_at ?? '1970-01-01T00:00:00Z'
        const atual = ultimaDataPorSerie.get(tid)
        if (!atual || new Date(dataValida) > new Date(atual)) {
          ultimaDataPorSerie.set(tid, dataValida)
        }
      }

      const idsMinhasSeries = [...ultimaDataPorSerie.keys()]
      const idsFavoritos = (favoritosRaw ?? []).map((f) => f.titulo_id)
      const idsVistos = (filmesVistosRaw ?? []).map((i) => i.titulo_id)

      // --- LOTE PARALELO 2: Dispara as 5 consultas dependentes simultaneamente em lotes seguros ---
      const [moviesDuracaoRes, seriesEntreFavoritos, titulosMinhasSeries, gamesEntreFavoritos, gamesVistosRes] = await Promise.all([
        idsVistos.length
          ? buscarEmLotesIn(
              () => supabase.from('movies').select('titulo_id, duration').order('titulo_id', { ascending: true }),
              'titulo_id',
              idsVistos
            )
          : [],
        idsFavoritos.length
          ? buscarEmLotesIn(
              () => supabase.from('series').select('titulo_id').order('titulo_id', { ascending: true }),
              'titulo_id',
              idsFavoritos
            )
          : [],
        idsMinhasSeries.length
          ? buscarEmLotesIn(
              () => supabase.from('titulo').select('id, nome, imagem').order('id', { ascending: true }),
              'id',
              idsMinhasSeries
            )
          : [],
        idsFavoritos.length
          ? buscarEmLotesIn(
              () => supabase.from('games').select('titulo_id').order('titulo_id', { ascending: true }),
              'titulo_id',
              idsFavoritos
            )
          : [],
        idsVistos.length
          ? buscarEmLotesIn(
              () => supabase.from('games').select('titulo_id').order('titulo_id', { ascending: true }),
              'titulo_id',
              idsVistos
            )
          : []
      ])

      const moviesDuracao = moviesDuracaoRes ?? []
      const gamesVistos = gamesVistosRes ?? []

      const minutosFilme = moviesDuracao.reduce((soma, f) => soma + (f.duration ?? 0), 0)
      const novoStats = {
        tempoTv: formatarDuracao(minutosTv).texto,
        episodios: epsComData.length,
        tempoFilme: formatarDuracao(minutosFilme).texto,
        filmes: moviesDuracao.length,
        jogos: gamesVistos.length,
      }
      setStats(novoStats)

      const idsSeriesFavoritas = new Set((seriesEntreFavoritos ?? []).map((s) => s.titulo_id))
      const idsGamesFavoritos = new Set((gamesEntreFavoritos ?? []).map((g) => g.titulo_id))
      const ordenarPorData = (lista) =>
        [...lista].sort((a, b) => new Date(b.status_atualizado_em) - new Date(a.status_atualizado_em))

      const sfList = ordenarPorData((favoritosRaw ?? []).filter((f) => idsSeriesFavoritas.has(f.titulo_id)))
        .map((f) => f.titulo)
        .filter(Boolean)
      setSeriesFavoritas(sfList)

      const ffList = ordenarPorData(
        (favoritosRaw ?? []).filter((f) => !idsSeriesFavoritas.has(f.titulo_id) && !idsGamesFavoritos.has(f.titulo_id))
      )
        .map((f) => f.titulo)
        .filter(Boolean)
      setFilmesFavoritos(ffList)

      const jfList = ordenarPorData((favoritosRaw ?? []).filter((f) => idsGamesFavoritos.has(f.titulo_id)))
        .map((f) => f.titulo)
        .filter(Boolean)
      setJogosFavoritos(jfList)

      const mapaTitulosSeries = new Map((titulosMinhasSeries ?? []).map((t) => [t.id, t]))
      const msList = idsMinhasSeries
        .map((tid) => mapaTitulosSeries.get(tid))
        .filter(Boolean)
        .sort((a, b) => new Date(ultimaDataPorSerie.get(b.id)) - new Date(ultimaDataPorSerie.get(a.id)))
      setMinhasSeries(msList)

      const idsMoviesConfirmados = new Set(moviesDuracao.map((m) => m.titulo_id))
      const mfList = [...(filmesVistosRaw ?? [])]
        .sort((a, b) => new Date(b.status_atualizado_em) - new Date(a.status_atualizado_em))
        .filter((f) => idsMoviesConfirmados.has(f.titulo_id))
        .map((f) => f.titulo)
        .filter(Boolean)
      setMeusFilmes(mfList)

      const idsGamesConfirmados = new Set(gamesVistos.map((g) => g.titulo_id))
      const mjList = [...(filmesVistosRaw ?? [])]
        .sort((a, b) => new Date(b.status_atualizado_em) - new Date(a.status_atualizado_em))
        .filter((f) => idsGamesConfirmados.has(f.titulo_id))
        .map((f) => f.titulo)
        .filter(Boolean)
      setMeusJogos(mjList)

      const listasOrdenadas = (listasData ?? []).map((l) => ({
        ...l,
        lista_item: [...l.lista_item].sort((a, b) => new Date(b.added_at) - new Date(a.added_at)),
      }))
      setListas(listasOrdenadas)

      setCache(`perfil_data_${user.id}`, {
        stats: novoStats,
        seriesFavoritas: sfList,
        filmesFavoritos: ffList,
        jogosFavoritos: jfList,
        minhasSeries: msList,
        meusFilmes: mfList,
        meusJogos: mjList,
        listas: listasOrdenadas
      })

    } catch (err) {
      console.error('[Perfil] Falha no carregamento paralelo:', err)
    }
  }

  async function criarLista() {
    const nome = window.prompt('Nome da nova lista:')
    if (!nome || !nome.trim()) return
    setCriandoLista(true)
    try {
      const { data: novaLista, error } = await supabase
        .from('lista')
        .insert({ user_id: user.id, nome: nome.trim() })
        .select('id, nome')
        .single()
      if (error) {
        alert(`Erro ao criar lista: ${error.message}`)
        return
      }
      setListas((prev) => [...prev, { ...novaLista, lista_item: [] }])
    } finally {
      setCriandoLista(false)
    }
  }

  function aoRolarListas() {
    const el = listasScrollRef.current
    if (!el || el.clientWidth === 0) return
    const index = Math.round(el.scrollLeft / el.clientWidth)
    setListaAtualIndex(index)
  }

  function aoSelecionarArquivo(file, tipo) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('Selecione um arquivo de imagem válido.')
      return
    }
    const TAMANHO_MAX_MB = 8
    if (file.size > TAMANHO_MAX_MB * 1024 * 1024) {
      alert(`A imagem precisa ter no máximo ${TAMANHO_MAX_MB}MB.`)
      return
    }
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setAreaRecortePixels(null)
    setModalRecorte({ tipo, imagemSrc: URL.createObjectURL(file) })
  }

  const aoCompletarRecorte = useCallback((_areaRecorte, areaEmPixels) => {
    setAreaRecortePixels(areaEmPixels)
  }, [])

  function fecharModalRecorte() {
    if (modalRecorte) URL.revokeObjectURL(modalRecorte.imagemSrc)
    setModalRecorte(null)
  }

  async function confirmarRecorte() {
    if (!modalRecorte || !areaRecortePixels) return
    setSalvandoRecorte(true)
    try {
      const isAvatar = modalRecorte.tipo === 'avatar'
      const { blob, mimeType, extension } = await getCroppedImg(
        modalRecorte.imagemSrc,
        areaRecortePixels,
        isAvatar
      )
      await enviarImagem(blob, modalRecorte.tipo, mimeType, extension)
      URL.revokeObjectURL(modalRecorte.imagemSrc)
      setModalRecorte(null)
    } catch (err) {
      console.error('Erro ao recortar imagem:', err)
      alert('Não foi possível recortar a imagem. Tenta de novo.')
    } finally {
      setSalvandoRecorte(false)
    }
  }

  async function enviarImagem(blob, tipo, mimeType = 'image/jpeg', extension = 'jpg') {
    if (!blob || !user) return
    const isAvatar = tipo === 'avatar'
    const bucket = isAvatar ? 'avatars' : 'capas'
    const colunaDb = isAvatar ? 'foto_perfil' : 'foto_capa'
    const setEnviando = isAvatar ? setEnviandoAvatar : setEnviandoCapa

    setEnviando(true)
    try {
      const path = `${user.id}/foto.${extension}`

      const { error: erroUpload } = await supabase.storage
        .from(bucket)
        .upload(path, blob, { upsert: true, cacheControl: '3600', contentType: mimeType })
      if (erroUpload) throw erroUpload

      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path)
      const urlComCacheBust = `${urlData.publicUrl}?v=${Date.now()}`

      const { error: erroUpdate } = await supabase
        .from('usuarios')
        .update({ [colunaDb]: urlComCacheBust })
        .eq('id', user.id)
      if (erroUpdate) throw erroUpdate

      await recarregarPerfil?.()
    } catch (err) {
      console.error(`Erro ao enviar ${tipo}:`, err)
      alert(`Não foi possível enviar a imagem: ${err.message}`)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none !important;
        }
        .custom-scrollbar::-webkit-scrollbar {
          height: 5px !important;
          display: block !important;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05) !important;
          border-radius: 10px !important;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #f3c255 !important;
          border-radius: 10px !important;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #e2b144 !important;
        }
        nav, footer {
          bottom: 0 !important;
          margin-bottom: 0 !important;
          padding-bottom: max(12px, env(safe-area-inset-bottom)) !important;
        }
      `}</style>

      <TopBar
        title="Perfil"
        rightSlot={
          <button onClick={() => navigate('/configuracoes')} className="text-muted">
            <MoreVertical size={20} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto scroll-area pb-24">
        <div className="relative">
          <div className="w-full h-32 bg-surface2 relative overflow-hidden">
            {perfil?.foto_capa && (
              <img src={perfil.foto_capa} alt="Capa" className="w-full h-full object-cover" />
            )}
            <input
              ref={inputCapaRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                aoSelecionarArquivo(e.target.files?.[0], 'capa')
                e.target.value = ''
              }}
            />
            <button
              onClick={() => inputCapaRef.current?.click()}
              disabled={enviandoCapa}
              aria-label="Editar capa"
              className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-ink flex items-center justify-center leading-none transition-all active:scale-95"
            >
              {enviandoCapa ? (
                <Loader2 size={15} className="block animate-spin" />
              ) : (
                <Camera size={15} className="block" />
              )}
            </button>
          </div>

          <div className="flex justify-center -mt-10 relative z-10 pointer-events-none">
            <div className="relative pointer-events-auto">
              <div className="w-20 h-20 rounded-full bg-surface2 border-4 border-bg overflow-hidden flex items-center justify-center">
                {perfil?.foto_perfil ? (
                  <img src={perfil.foto_perfil} alt="Foto de perfil" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-display font-semibold text-muted">
                    {perfil?.username?.[0]?.toUpperCase() ?? '?'}
                  </span>
                )}
              </div>
              <input
                ref={inputAvatarRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  aoSelecionarArquivo(e.target.files?.[0], 'avatar')
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => inputAvatarRef.current?.click()}
                disabled={enviandoAvatar}
                aria-label="Editar foto de perfil"
                className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-amber text-bg flex items-center justify-center leading-none border-2 border-bg active:scale-95"
              >
                {enviandoAvatar ? (
                  <Loader2 size={13} className="block animate-spin" />
                ) : (
                  <Camera size={13} className="block" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 text-center text-sm text-muted font-mono">{perfil?.username}</div>

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

        <Prateleira
          titulo="Séries favoritas"
          itens={seriesFavoritas}
          navigate={navigate}
          aoExpandir={() => setSecaoExpandida({ titulo: 'Séries favoritas', itens: seriesFavoritas })}
        />
        <Prateleira
          titulo="Filmes favoritas"
          itens={filmesFavoritos}
          navigate={navigate}
          aoExpandir={() => setSecaoExpandida({ titulo: 'Filmes favoritos', itens: filmesFavoritos })}
        />
        <Prateleira
          titulo="Jogos favoritos"
          itens={jogosFavoritos}
          navigate={navigate}
          aoExpandir={() => setSecaoExpandida({ titulo: 'Jogos favoritos', itens: jogosFavoritos })}
        />
        <Prateleira
          titulo="Minhas séries"
          itens={minhasSeries}
          navigate={navigate}
          aoExpandir={() => setSecaoExpandida({ titulo: 'Minhas séries', itens: minhasSeries })}
        />
        <Prateleira
          titulo="Meus filmes"
          itens={meusFilmes}
          navigate={navigate}
          aoExpandir={() => setSecaoExpandida({ titulo: 'Meus filmes', itens: meusFilmes })}
        />
        <Prateleira
          titulo="Meus jogos"
          itens={meusJogos}
          navigate={navigate}
          aoExpandir={() => setSecaoExpandida({ titulo: 'Meus jogos', itens: meusJogos })}
        />

        <div className="mb-1">
          <div className="flex items-center justify-between pr-4">
            <SectionLabel>Minhas listas</SectionLabel>
            <div className="flex items-center gap-3">
              <button onClick={criarLista} disabled={criandoLista} className="text-amber disabled:opacity-50">
                <Plus size={18} />
              </button>
              {listas.length > 0 && (
                <button onClick={() => setTodasListasAbertas(true)} className="text-muted">
                  <LayoutGrid size={18} />
                </button>
              )}
            </div>
          </div>

          {listas.length === 0 ? (
            <div className="px-4 pb-8 text-muted text-sm font-mono">Nenhuma lista criada ainda.</div>
          ) : (
            <>
              <div
                ref={listasScrollRef}
                onScroll={aoRolarListas}
                className="flex flex-nowrap items-start overflow-x-auto snap-x snap-mandatory no-scrollbar pb-3"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {listas.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => navigate(`/lista/${l.id}`)}
                    className="w-full flex-shrink-0 snap-center text-left px-4"
                  >
                    <div className="bg-surface border border-white/5 rounded-2xl p-4">
                      <div className="text-sm text-ink font-display font-medium truncate mb-2">{l.nome}</div>
                      <div className="flex gap-1">
                        {l.lista_item.slice(0, 5).map((item) => (
                          <div
                            key={item.titulo_id}
                            className="w-10 aspect-[2/3] rounded-sm bg-surface2 flex-shrink-0 bg-cover bg-center"
                            style={
                              item.titulo?.imagem
                                ? { backgroundImage: `url(${urlPoster(item.titulo.imagem)})` }
                                : undefined
                            }
                          />
                        ))}
                        {l.lista_item.length === 0 && (
                          <div className="w-10 aspect-[2/3] rounded-sm bg-surface2 flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {listas.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 pt-2 pb-8">
                  {listas.map((_, i) => (
                    <div
                      key={i}
                      className={`w-1.5 h-1.5 rounded-full ${i === listaAtualIndex ? 'bg-amber' : 'bg-white/15'}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {secaoExpandida && (
        <div className="fixed inset-0 bg-bg z-50 flex flex-col max-w-[480px] mx-auto w-full left-0 right-0">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
            <button onClick={() => setSecaoExpandida(null)} className="text-muted">
              <ArrowLeft size={20} />
            </button>
            <div className="text-base text-ink font-display font-semibold">{secaoExpandida.titulo}</div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area grid grid-cols-3 gap-3 px-4 py-4 content-start">
            {secaoExpandida.itens.map((t) => (
              <PosterCard
                key={t.id}
                imagem={t.imagem}
                nome={t.nome}
                onClick={() => {
                  setSecaoExpandida(null)
                  navigate(`/titulo/${t.id}`)
                }}
              />
            ))}
          </div>
        </div>
      )}

      {todasListasAbertas && (
        <div className="fixed inset-0 bg-bg z-50 flex flex-col max-w-[480px] mx-auto w-full left-0 right-0">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
            <button onClick={() => setTodasListasAbertas(false)} className="text-muted">
              <ArrowLeft size={20} />
            </button>
            <div className="text-base text-ink font-display font-semibold font-medium">Minhas listas</div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area px-4 py-4 space-y-4">
            {listas.map((l) => (
              <div key={l.id} className="mb-2">
                <div className="flex items-center justify-between pr-4">
                  <div className="text-sm font-display font-medium text-ink truncate mb-1 pl-1">{l.nome}</div>
                  <button
                    onClick={() => {
                      setTodasListasAbertas(false)
                      navigate(`/lista/${l.id}`)
                    }}
                    className="text-muted"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
                {l.lista_item.length === 0 ? (
                  <div className="pl-1 pb-2 text-muted text-sm font-mono">Nenhum título nessa lista ainda.</div>
                ) : (
                  <div
                    className="flex flex-nowrap items-start gap-3 pb-3 overflow-x-auto custom-scrollbar h-[220px]"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: '#f3c255 rgba(255, 255, 255, 0.05)' }}
                  >
                    {l.lista_item.slice(0, 10).map((item) => (
                      <div key={item.titulo_id} className="flex-shrink-0 w-28">
                        <PosterCard
                          imagem={item.titulo?.imagem}
                          nome={item.titulo?.nome}
                          onClick={() => {
                            setTodasListasAbertas(false)
                            navigate(`/titulo/${item.titulo_id}`)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {modalRecorte && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col max-w-[480px] mx-auto w-full left-0 right-0">
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
            <button onClick={fecharModalRecorte} className="text-ink p-1">
              <X size={22} />
            </button>
            <div className="text-sm text-ink font-display font-semibold">
              {modalRecorte.tipo === 'avatar' ? 'Recortar foto de perfil' : 'Recortar capa'}
            </div>
            <button
              onClick={confirmarRecorte}
              disabled={salvandoRecorte || !areaRecortePixels}
              className="text-amber p-1 disabled:opacity-40"
              aria-label="Confirmar recorte"
            >
              {salvandoRecorte ? <Loader2 size={20} className="animate-spin" /> : <Check size={22} />}
            </button>
          </div>

          <div className="relative flex-1 bg-black">
            <Cropper
              image={modalRecorte.imagemSrc}
              crop={crop}
              zoom={zoom}
              aspect={modalRecorte.tipo === 'avatar' ? 1 : 3}
              cropShape={modalRecorte.tipo === 'avatar' ? 'round' : 'rect'}
              showGrid={modalRecorte.tipo !== 'avatar'}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={aoCompletarRecorte}
            />
          </div>

          <div className="px-6 py-4 flex-shrink-0">
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-amber"
              aria-label="Zoom"
            />
          </div>
        </div>
      )}
    </>
  )
}

function Prateleira({ titulo, itens, navigate, aoExpandir }) {
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between pr-4">
        <SectionLabel>{titulo}</SectionLabel>
        {itens.length > 0 && (
          <button onClick={aoExpandir} className="text-muted">
            <ChevronRight size={18} />
          </button>
        )}
      </div>
      {itens.length === 0 ? (
        <div className="px-4 pb-2 text-muted text-sm font-mono">Nada por aqui ainda.</div>
      ) : (
        <div 
          className="flex flex-nowrap items-start gap-3 px-4 pb-3 overflow-x-auto custom-scrollbar h-[220px]"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#f3c255 rgba(255, 255, 255, 0.05)' }}
        >
          {itens.slice(0, 10).map((t) => (
            <div key={t.id} className="flex-shrink-0 w-28">
              <PosterCard imagem={t.imagem} nome={t.nome} onClick={() => navigate(`/titulo/${t.id}`)} />
            </div>
          ))}
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
