import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical, Plus, ChevronRight, LayoutGrid, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { formatarDuracao } from '../lib/format'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'
import PosterCard from '../components/PosterCard'

// O Supabase/PostgREST tem um limite padrão de "max rows" por requisição
// (normalmente 1000), que corta a resposta mesmo se você pedir um .range()
// maior. Pra buscar tudo de verdade, pagina em lotes e concatena até a
// página voltar vazia ou menor que o tamanho pedido.
async function buscarTodasLinhas(construirQuery, tamanhoPagina = 1000) {
  let todas = []
  let inicio = 0
  while (true) {
    const { data, error } = await construirQuery().range(inicio, inicio + tamanhoPagina - 1)
    if (error) throw error
    todas = todas.concat(data ?? [])
    if (!data || data.length < tamanhoPagina) break
    inicio += tamanhoPagina
  }
  return todas
}

const POSTER_BASE_THUMB = 'https://image.tmdb.org/t/p/w200'

function urlPoster(caminho) {
  if (!caminho) return null
  return caminho.startsWith('http') ? caminho : `${POSTER_BASE_THUMB}${caminho}`
}

export default function Perfil() {
  const { user, perfil } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)

  const [seriesFavoritas, setSeriesFavoritas] = useState([])
  const [filmesFavoritos, setFilmesFavoritos] = useState([])
  const [minhasSeries, setMinhasSeries] = useState([])
  const [meusFilmes, setMeusFilmes] = useState([])

  const [listas, setListas] = useState([])
  const [criandoLista, setCriandoLista] = useState(false)
  const [todasListasAbertas, setTodasListasAbertas] = useState(false)
  const [listaAtualIndex, setListaAtualIndex] = useState(0)
  const listasScrollRef = useRef(null)

  // Seção atualmente expandida em tela cheia (ou null se nenhuma) - guarda o
  // título do cabeçalho e a lista completa de itens (já carregada em memória,
  // então abrir não precisa refazer nenhuma busca).
  const [secaoExpandida, setSecaoExpandida] = useState(null)

  useEffect(() => {
    if (user) carregar()
  }, [user])

  async function carregar() {
    // --- Estatísticas ---
    let eps = []
    try {
      eps = await buscarTodasLinhas(() =>
        supabase.from('watched_episode').select('episode(duration)').eq('user_id', user.id)
      )
    } catch (erroEps) {
      console.error('Erro ao buscar watched_episode:', erroEps)
    }
    const minutosTv = eps.reduce((soma, e) => soma + (e.episode?.duration ?? 0), 0)

    let itensVistos = []
    try {
      itensVistos = await buscarTodasLinhas(() =>
        supabase.from('user_item').select('titulo_id').eq('user_id', user.id).eq('status', 'visto')
      )
    } catch (erroItensVistos) {
      console.error('Erro ao buscar user_item (visto):', erroItensVistos)
    }

    const idsVistos = itensVistos.map((i) => i.titulo_id)
    let filmesDuracao = []
    try {
      filmesDuracao = idsVistos.length
        ? await buscarTodasLinhas(() =>
            supabase.from('movies').select('titulo_id, duration').in('titulo_id', idsVistos)
          )
        : []
    } catch (erroFilmes) {
      console.error('Erro ao buscar movies:', erroFilmes)
    }

    const minutosFilme = filmesDuracao.reduce((soma, f) => soma + (f.duration ?? 0), 0)

    setStats({
      tempoTv: formatarDuracao(minutosTv).texto,
      episodios: eps.length,
      tempoFilme: formatarDuracao(minutosFilme).texto,
      filmes: filmesDuracao.length,
    })

    // --- Favoritos (séries e filmes) ---
    const { data: favoritosRaw, error: erroFavoritos } = await supabase
      .from('user_item')
      .select('titulo_id, status_atualizado_em, titulo(id, nome, imagem)')
      .eq('user_id', user.id)
      .eq('favorito', true)
    if (erroFavoritos) console.error('Erro ao buscar favoritos:', erroFavoritos)

    const idsFavoritos = (favoritosRaw ?? []).map((f) => f.titulo_id)
    const { data: seriesEntreFavoritos } = idsFavoritos.length
      ? await supabase.from('series').select('titulo_id').in('titulo_id', idsFavoritos)
      : { data: [] }
    const idsSeriesFavoritas = new Set((seriesEntreFavoritos ?? []).map((s) => s.titulo_id))

    const ordenarPorData = (lista) =>
      [...lista].sort((a, b) => new Date(b.status_atualizado_em) - new Date(a.status_atualizado_em))

    setSeriesFavoritas(
      ordenarPorData((favoritosRaw ?? []).filter((f) => idsSeriesFavoritas.has(f.titulo_id)))
        .map((f) => f.titulo)
        .filter(Boolean)
    )
    setFilmesFavoritos(
      ordenarPorData((favoritosRaw ?? []).filter((f) => !idsSeriesFavoritas.has(f.titulo_id)))
        .map((f) => f.titulo)
        .filter(Boolean)
    )

    // --- Minhas séries (ordenadas pela data do último episódio assistido) ---
    let epsComData = []
    try {
      epsComData = await buscarTodasLinhas(() =>
        supabase.from('watched_episode').select('watched_at, episode(titulo_id)').eq('user_id', user.id)
      )
    } catch (e) {
      console.error('Erro ao buscar episódios assistidos p/ Minhas séries:', e)
    }

    const ultimaDataPorSerie = new Map()
    for (const e of epsComData) {
      const tid = e.episode?.titulo_id
      if (!tid || !e.watched_at) continue
      const atual = ultimaDataPorSerie.get(tid)
      if (!atual || new Date(e.watched_at) > new Date(atual)) {
        ultimaDataPorSerie.set(tid, e.watched_at)
      }
    }

    const idsMinhasSeries = [...ultimaDataPorSerie.keys()]
    const { data: titulosMinhasSeries } = idsMinhasSeries.length
      ? await supabase.from('titulo').select('id, nome, imagem').in('id', idsMinhasSeries)
      : { data: [] }
    const mapaTitulosSeries = new Map((titulosMinhasSeries ?? []).map((t) => [t.id, t]))

    setMinhasSeries(
      idsMinhasSeries
        .map((tid) => mapaTitulosSeries.get(tid))
        .filter(Boolean)
        .sort((a, b) => new Date(ultimaDataPorSerie.get(b.id)) - new Date(ultimaDataPorSerie.get(a.id)))
    )

    // --- Meus filmes (ordenados pela data em que foram marcados como vistos) ---
    const { data: filmesVistosRaw, error: erroFilmesVistos } = await supabase
      .from('user_item')
      .select('titulo_id, status_atualizado_em, titulo(id, nome, imagem)')
      .eq('user_id', user.id)
      .eq('status', 'visto')
    if (erroFilmesVistos) console.error('Erro ao buscar filmes vistos:', erroFilmesVistos)

    const idsFilmesVistos = (filmesVistosRaw ?? []).map((f) => f.titulo_id)
    const { data: moviesEntreVistos } = idsFilmesVistos.length
      ? await supabase.from('movies').select('titulo_id').in('titulo_id', idsFilmesVistos)
      : { data: [] }
    const idsMoviesConfirmados = new Set((moviesEntreVistos ?? []).map((m) => m.titulo_id))

    setMeusFilmes(
      [...(filmesVistosRaw ?? [])]
        .sort((a, b) => new Date(b.status_atualizado_em) - new Date(a.status_atualizado_em))
        .filter((f) => idsMoviesConfirmados.has(f.titulo_id))
        .map((f) => f.titulo)
        .filter(Boolean)
    )

    // --- Listas ---
    const { data: listasData, error: erroListas } = await supabase
      .from('lista')
      .select('id, nome, lista_item(titulo_id, added_at, titulo(nome, imagem))')
      .eq('user_id', user.id)
    if (erroListas) console.error('Erro ao buscar listas:', erroListas)

    const listasOrdenadas = (listasData ?? []).map((l) => ({
      ...l,
      lista_item: [...l.lista_item].sort((a, b) => new Date(b.added_at) - new Date(a.added_at)),
    }))
    setListas(listasOrdenadas)
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

  return (
    <>
      {/* Estilo CSS embutido para criar a barra de rolagem horizontal amarela fina */}
      <style>{`
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
      `}</style>

      <TopBar
        title="Perfil"
        rightSlot={
          <button onClick={() => navigate('/configuracoes')} className="text-muted">
            <MoreVertical size={20} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto scroll-area">
        <div className="px-4 py-3 text-sm text-muted font-mono">{perfil?.username}</div>

        <SectionLabel>Estatísticas</SectionLabel>
        {stats && (
          <div className="grid grid-cols-2 gap-3 px-4 mb-2">
            <StatCard label="Tempo vendo TV" valor={stats.tempoTv} />
            <StatCard label="Episódios assistidos" valor={stats.episodios} />
            <StatCard label="Tempo vendo filmes" valor={stats.tempoFilme} />
            <StatCard label="Filmes assistidos" valor={stats.filmes} />
          </div>
        )}

        <Prateleira
          titulo="Séries favoritas"
          itens={seriesFavoritas}
          navigate={navigate}
          aoExpandir={() => setSecaoExpandida({ titulo: 'Séries favoritas', itens: seriesFavoritas })}
        />
        <Prateleira
          titulo="Filmes favoritos"
          itens={filmesFavoritos}
          navigate={navigate}
          aoExpandir={() => setSecaoExpandida({ titulo: 'Filmes favoritos', itens: filmesFavoritos })}
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

        {/* Container mb-1 para manter o mesmo espaçamento das prateleiras anteriores */}
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
              {/* Estilização aplicada ao contêiner de listas */}
              <div
                ref={listasScrollRef}
                onScroll={aoRolarListas}
                className="flex flex-nowrap overflow-x-auto snap-x snap-mandatory custom-scrollbar pb-3"
                style={{ scrollbarWidth: 'thin', scrollbarColor: '#f3c255 rgba(255, 255, 255, 0.05)' }}
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
            <div className="text-base text-ink font-display font-semibold">Minhas listas</div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area px-4 py-4 space-y-4">
            {listas.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  setTodasListasAbertas(false)
                  navigate(`/lista/${l.id}`)
                }}
                className="w-full text-left block"
              >
                <div className="text-sm text-ink font-display font-medium truncate mb-1.5">{l.nome}</div>
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
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// Prateleira horizontal reutilizada pelas 4 seções de "top 10" (séries/filmes favoritos, minhas séries, meus filmes).
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
        /* Adicionada a classe custom-scrollbar e pb-3 para dar margem à nova barra amarela de 5px */
        <div 
          className="flex flex-nowrap gap-3 px-4 pb-3 overflow-x-auto custom-scrollbar"
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
