import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { callFunction } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import TopBar from '../components/TopBar'
import SubTabs from '../components/SubTabs'
import SectionLabel from '../components/SectionLabel'
import PosterCard from '../components/PosterCard'

const GENEROS = [
  { id: null, nome: 'Todos' },
  { id: 28, nome: 'Ação' },
  { id: 35, nome: 'Comédia' },
  { id: 18, nome: 'Drama' },
  { id: 27, nome: 'Terror' },
  { id: 10749, nome: 'Romance' },
  { id: 878, nome: 'Ficção' },
  { id: 16, nome: 'Animação' },
]

export default function FilmesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [aba, setAba] = useState('lista')
  const [meusFilmes, setMeusFilmes] = useState([])
  const [filmesVistos, setFilmesVistos] = useState([])
  const [generoAtivo, setGeneroAtivo] = useState(null)
  const [emBreve, setEmBreve] = useState([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (user && aba === 'lista') carregarMeusFilmes()
  }, [user, aba])

  useEffect(() => {
    if (aba === 'em_breve') carregarEmBreve()
  }, [aba, generoAtivo])

  async function carregarMeusFilmes() {
    setCarregando(true)
    
    // Busca tanto 'quero_ver' quanto 'visto' para capturar os importados do ZIP
    const { data: itensBrutos, error: erroItens } = await supabase
      .from('user_item')
      .select('titulo_id, status, titulo(nome, imagem)')
      .eq('user_id', user.id)
      .in('status', ['quero_ver', 'visto'])
    if (erroItens) console.error('Erro ao buscar user_item:', erroItens)

    const ids = (itensBrutos ?? []).map((i) => i.titulo_id)
    const { data: moviesEncontrados, error: erroMovies } = await supabase
      .from('movies')
      .select('titulo_id')
      .in('titulo_id', ids.length ? ids : [0])
    if (erroMovies) console.error('Erro ao buscar movies:', erroMovies)

    const idsDeFilme = new Set((moviesEncontrados ?? []).map((m) => m.titulo_id))
    const filmesFiltrados = (itensBrutos ?? []).filter((i) => idsDeFilme.has(i.titulo_id))
    
    // Separa os filmes em listas de exibição diferentes
    setMeusFilmes(filmesFiltrados.filter(f => f.status === 'quero_ver'))
    setFilmesVistos(filmesFiltrados.filter(f => f.status === 'visto'))
    setCarregando(false)
  }

  async function carregarEmBreve() {
    setCarregando(true)
    try {
      const { results } = await callFunction('em-breve-filmes', { genre_id: generoAtivo, page: 1 })
      setEmBreve(results ?? [])
    } catch (e) {
      setEmBreve([])
    }
    setCarregando(false)
  }

  return (
    <>
      <TopBar title="Filmes" />
      <SubTabs
        tabs={[{ value: 'lista', label: 'Minha Lista' }, { value: 'em_breve', label: 'Em breve' }]}
        active={aba}
        onChange={setAba}
      />

      <div className="flex-1 overflow-y-auto scroll-area">
        {aba === 'lista' && (
          <>
            <SectionLabel>Quero ver</SectionLabel>
            {carregando && <div className="p-4 text-muted text-sm font-mono">Carregando…</div>}
            {!carregando && meusFilmes.length === 0 && (
              <div className="px-4 py-6 text-muted text-sm font-mono text-center">
                Nenhum filme na lista "Quero ver" ainda.
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 px-4 pb-6">
              {meusFilmes.map((f) => (
                <PosterCard
                  key={f.titulo_id}
                  imagem={f.titulo.imagem}
                  nome={f.titulo.nome}
                  onClick={() => navigate(`/titulo/${f.titulo_id}`)}
                />
              ))}
            </div>

            {filmesVistos.length > 0 && (
              <>
                <SectionLabel>Já Assistidos</SectionLabel>
                <div className="grid grid-cols-3 gap-3 px-4 pb-6">
                  {filmesVistos.map((f) => (
                    <PosterCard
                      key={f.titulo_id}
                      imagem={f.titulo.imagem}
                      nome={f.titulo.nome}
                      onClick={() => navigate(`/titulo/${f.titulo_id}`)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {aba === 'em_breve' && (
          <>
            <div className="flex gap-2 px-4 py-3 overflow-x-auto scroll-area">
              {GENEROS.map((g) => (
                <button
                  key={g.id ?? 'todos'}
                  onClick={() => setGeneroAtivo(g.id)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-mono uppercase border ${
                    generoAtivo === g.id ? 'bg-amber text-bg border-amber shadow-[0_0_12px_rgba(243,194,85,0.35)]' : 'text-muted border-white/10'
                  }`}
                >
                  {g.nome}
                </button>
              ))}
            </div>
            {carregando && <div className="p-4 text-muted text-sm font-mono">Carregando…</div>}
            <div className="grid grid-cols-3 gap-3 px-4 pb-6">
              {emBreve.map((f) => (
                <PosterCard
                  key={f.tmdb_id}
                  imagem={f.imagem}
                  nome={f.nome}
                  badge={f.data_lancamento?.slice(0, 4)}
                  onClick={() => navigate(`/titulo/${f.tmdb_id}?tipo=movie`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
