import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabaseClient'
import { intercalar } from '../lib/format'
import { getCache, setCache } from '../lib/dataCache'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'
import PosterCard from '../components/PosterCard'

// Cada linha "Top 10" vem de um endpoint diferente (ver módulo docstring de
// cada função em supabase/functions) -- declaradas juntas pra a tela poder
// carregar/cachear as três do mesmo jeito sem repetir a lógica.
const SECOES_TOP10 = [
  { chave: 'filmes', titulo: 'Top 10 Filmes', funcao: 'popular-movies' },
  { chave: 'series', titulo: 'Top 10 Séries', funcao: 'popular-series' },
  { chave: 'jogos', titulo: 'Top 10 Jogos', funcao: 'popular-games' },
]

export default function Explorar() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState(null) // null = não buscou ainda
  const [trending, setTrending] = useState([])
  const [top10, setTop10] = useState({ filmes: [], series: [], jogos: [] })
  const [carregando, setCarregando] = useState(false)
  const queryEmVooRef = useRef('')

  useEffect(() => {
    carregarTrending()
    carregarTop10()
  }, [])

  // Busca automática com debounce de 400ms para otimizar chamadas de rede
  useEffect(() => {
    if (!query.trim()) {
      setResultados(null)
      return
    }

    const timer = setTimeout(async () => {
      const queryDaVez = query.trim()
      queryEmVooRef.current = queryDaVez
      setCarregando(true)
      try {
        // Paralelo e independente: se a IGDB falhar/demorar, a busca de série/filme
        // continua funcionando normalmente (e vice-versa).
        const [tmdbRes, igdbRes] = await Promise.all([
          callFunction('buscar-titulo', { query: queryDaVez }),
          callFunction('buscar-jogo', { query: queryDaVez }),
        ])
        // Se o usuário já digitou outra coisa enquanto essa busca estava em voo,
        // descarta — evita uma resposta antiga (rede lenta) sobrescrever uma mais nova.
        if (queryEmVooRef.current !== queryDaVez) return
        setResultados(intercalar(tmdbRes.results ?? [], igdbRes.results ?? []))
      } catch {
        if (queryEmVooRef.current === queryDaVez) setResultados([])
      } finally {
        if (queryEmVooRef.current === queryDaVez) setCarregando(false)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [query])

  async function carregarTrending() {
    const cacheKey = 'explorar_trending'
    const cached = getCache(cacheKey)
    if (cached?.data) {
      setTrending(cached.data)
      if (!cached.isStale) return
    }
    const { data } = await supabase.from('trending_semana').select('*').limit(15)
    setTrending(data ?? [])
    setCache(cacheKey, data ?? [])
  }

  // As três seções "Top 10" carregam em paralelo, cada uma com seu próprio
  // cache -- uma falhando (ex: IGDB fora do ar) não trava as outras duas.
  async function carregarTop10() {
    await Promise.all(
      SECOES_TOP10.map(async ({ chave, funcao }) => {
        const cacheKey = `explorar_top10_${chave}`
        const cached = getCache(cacheKey)
        if (cached?.data) {
          setTop10((prev) => ({ ...prev, [chave]: cached.data }))
          if (!cached.isStale) return
        }
        try {
          const { results } = await callFunction(funcao, { page: 1 })
          const dez = (results ?? []).slice(0, 10)
          setTop10((prev) => ({ ...prev, [chave]: dez }))
          setCache(cacheKey, dez)
        } catch {
          // mantém o que já tinha (do cache) em vez de limpar a seção
        }
      })
    )
  }

  function limparBusca() {
    setQuery('')
    setResultados(null)
  }

  async function abrirResultado(item) {
    // Resultado de busca (ou de um Top 10, ainda não ingerido) — o resolver
    // cria/encontra o registro e só então navega para o titulo_id real.
    const externalId = item.tmdb_id ?? item.igdb_id
    const fonte = item.fonte ?? 'tmdb'
    navigate(`/titulo/novo/${externalId}?tipo=${item.media_type}&fonte=${fonte}`)
  }

  function badgePorTipo(mediaType) {
    if (mediaType === 'tv') return 'Série'
    if (mediaType === 'movie') return 'Filme'
    return 'Jogo'
  }

  return (
    <>
      <style>{`
        nav, footer, [class*="bottom-"] {
          bottom: 0 !important;
          margin-bottom: 0 !important;
          padding-bottom: max(12px, env(safe-area-inset-bottom)) !important;
        }
      `}</style>

      <TopBar title="Explorar" />

      <div className="flex-1 overflow-y-auto scroll-area pb-24">
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 bg-surface border border-white/10 rounded-2xl px-4 py-3">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar série, filme ou jogo…"
              className="bg-transparent flex-1 text-sm text-ink placeholder:text-muted outline-none"
            />
            {query && (
              <button
                onClick={limparBusca}
                type="button"
                className="text-muted hover:text-ink transition-colors p-1"
                aria-label="Limpar busca"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {carregando && <div className="px-4 text-muted text-sm font-mono">Buscando…</div>}

        {resultados !== null ? (
          <>
            <SectionLabel>Resultados</SectionLabel>
            {resultados.length === 0 && (
              <div className="px-4 py-6 text-muted text-sm font-mono text-center">Nada encontrado.</div>
            )}
            <div className="grid grid-cols-3 gap-3 px-4 pb-6">
              {resultados.map((r) => (
                <PosterCard
                  key={`${r.media_type}-${r.tmdb_id ?? r.igdb_id}`}
                  imagem={r.imagem}
                  nome={r.nome}
                  badge={badgePorTipo(r.media_type)}
                  onClick={() => abrirResultado(r)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <SectionLabel>Popular</SectionLabel>
            <p className="px-4 text-xs text-muted -mt-1 mb-2">
              Com base em quantas pessoas marcaram como visto, jogado ou querem ver (inclui quem
              assistiu episódios recentes), sem identificar quem.
            </p>
            <div className="flex gap-3 px-4 pb-6 overflow-x-auto scroll-area">
              {trending.map((t) => (
                <div key={t.titulo_id} className="flex-shrink-0 w-28">
                  <PosterCard
                    imagem={t.imagem}
                    nome={t.nome}
                    badge={badgePorTipo(t.media_type)}
                    onClick={() => navigate(`/titulo/${t.titulo_id}?tipo=${t.media_type}`)}
                  />
                </div>
              ))}
            </div>

            {SECOES_TOP10.map(({ chave, titulo }) => (
              <div key={chave}>
                <SectionLabel>{titulo}</SectionLabel>
                {top10[chave].length === 0 ? (
                  <div className="px-4 pb-4 text-muted text-sm font-mono">Carregando…</div>
                ) : (
                  <div className="flex gap-3 px-4 pb-6 overflow-x-auto scroll-area">
                    {top10[chave].map((item, i) => (
                      <div key={`${chave}-${item.tmdb_id ?? item.igdb_id}`} className="flex-shrink-0 w-28">
                        <PosterCard
                          imagem={item.imagem}
                          nome={item.nome}
                          badge={`#${i + 1}`}
                          onClick={() => abrirResultado(item)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}
