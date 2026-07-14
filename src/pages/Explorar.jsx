import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabaseClient'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'
import PosterCard from '../components/PosterCard'

export default function Explorar() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState(null) // null = não buscou ainda
  const [trending, setTrending] = useState([])
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    carregarTrending()
  }, [])

  async function carregarTrending() {
    const { data } = await supabase.from('trending_semana').select('*').limit(15)
    setTrending(data ?? [])
  }

  async function buscar(e) {
    e.preventDefault()
    if (!query.trim()) return
    setCarregando(true)
    try {
      const { results } = await callFunction('buscar-titulo', { query })
      setResultados(results ?? [])
    } catch {
      setResultados([])
    }
    setCarregando(false)
  }

  async function abrirResultado(item) {
    navigate(`/titulo/${item.tmdb_id}?tipo=${item.media_type}`)
  }

  return (
    <>
      <TopBar title="Explorar" />
      <div className="flex-1 overflow-y-auto scroll-area">
        <form onSubmit={buscar} className="px-4 py-3">
          <div className="flex items-center gap-2 bg-surface border border-surface2 rounded px-3 py-2">
            <Search size={16} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar série ou filme…"
              className="bg-transparent flex-1 text-sm text-ink placeholder:text-muted outline-none"
            />
          </div>
        </form>

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
                  key={`${r.media_type}-${r.tmdb_id}`}
                  imagem={r.imagem}
                  nome={r.nome}
                  badge={r.media_type === 'tv' ? 'Série' : 'Filme'}
                  onClick={() => abrirResultado(r)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <SectionLabel>Em alta essa semana</SectionLabel>
            <p className="px-4 text-xs text-muted -mt-1 mb-2">
              Com base em quantas pessoas marcaram como visto ou querem ver, sem identificar quem.
            </p>
            <div className="grid grid-cols-3 gap-3 px-4 pb-6">
              {trending.map((t) => (
                <PosterCard
                  key={t.titulo_id}
                  imagem={t.imagem}
                  nome={t.nome}
                  badge={t.media_type === 'tv' ? 'Série' : 'Filme'}
                  onClick={() => navigate(`/titulo/${t.titulo_id}?tipo=${t.media_type}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
