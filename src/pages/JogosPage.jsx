import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, callFunction } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { getCache, setCache, onCacheInvalidate } from '../lib/dataCache'
import TopBar from '../components/TopBar'
import SubTabs from '../components/SubTabs'
import SectionLabel from '../components/SectionLabel'
import PosterCard from '../components/PosterCard'

export default function JogosPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [aba, setAba] = useState('lista')
  const [meusJogos, setMeusJogos] = useState([])
  const [emBreve, setEmBreve] = useState([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (!user || aba !== 'lista') return

    const cacheKey = `jogos_lista_${user.id}`
    const cached = getCache(cacheKey)

    if (cached?.data) {
      setMeusJogos(cached.data)
      setCarregando(false)
      if (cached.isStale) carregarMeusJogos(true)
    } else {
      carregarMeusJogos(false)
    }

    const unsubscribe = onCacheInvalidate((keys) => {
      if (!keys || keys.includes('jogos') || keys.includes('user_item')) {
        carregarMeusJogos(false)
      }
    })

    return () => unsubscribe()
  }, [user, aba])

  useEffect(() => {
    if (aba !== 'em_breve') return

    const cacheKey = 'jogos_em_breve'
    const cached = getCache(cacheKey)

    if (cached?.data) {
      setEmBreve(cached.data)
      setCarregando(false)
      if (cached.isStale) carregarEmBreve(true)
    } else {
      carregarEmBreve(false)
    }
  }, [aba])

  async function carregarMeusJogos(isSilent = false) {
    if (!isSilent) setCarregando(true)
    const { data: itensBrutos, error: erroItens } = await supabase
      .from('user_item')
      .select('titulo_id, titulo(nome, imagem)')
      .eq('user_id', user.id)
      .eq('status', 'quero_ver')
    if (erroItens) console.error('Erro ao buscar user_item:', erroItens)

    const ids = (itensBrutos ?? []).map((i) => i.titulo_id)
    const { data: gamesEncontrados, error: erroGames } = await supabase
      .from('games')
      .select('titulo_id')
      .in('titulo_id', ids.length ? ids : [0])
    if (erroGames) console.error('Erro ao buscar games:', erroGames)

    const idsDeJogo = new Set((gamesEncontrados ?? []).map((g) => g.titulo_id))
    const resultado = (itensBrutos ?? []).filter((i) => idsDeJogo.has(i.titulo_id))
    setMeusJogos(resultado)
    setCache(`jogos_lista_${user.id}`, resultado)
    setCarregando(false)
  }

  async function carregarEmBreve(isSilent = false) {
    if (!isSilent) setCarregando(true)
    try {
      const { results } = await callFunction('soon-games', { page: 1 })
      const res = results ?? []
      setEmBreve(res)
      setCache('jogos_em_breve', res)
    } catch (e) {
      setEmBreve([])
    }
    setCarregando(false)
  }

  return (
    <>
      <TopBar title="Jogos" />
      <SubTabs
        tabs={[{ value: 'lista', label: 'Minha Lista' }, { value: 'em_breve', label: 'Em breve' }]}
        active={aba}
        onChange={setAba}
      />

      <div className="flex-1 overflow-y-auto scroll-area">
        {aba === 'lista' && (
          <>
            <SectionLabel>Seguindo</SectionLabel>
            {carregando && <div className="p-4 text-muted text-sm font-mono">Carregando…</div>}
            {!carregando && meusJogos.length === 0 && (
              <div className="px-4 py-6 text-muted text-sm font-mono text-center">
                Nenhum jogo seguido ainda. Busque algo em Explorar.
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 px-4 pb-6">
              {meusJogos.map((j) => (
                <PosterCard
                  key={j.titulo_id}
                  imagem={j.titulo.imagem}
                  nome={j.titulo.nome}
                  onClick={() => navigate(`/titulo/${j.titulo_id}?tipo=game`)}
                />
              ))}
            </div>
          </>
        )}

        {aba === 'em_breve' && (
          <>
            {carregando && <div className="p-4 text-muted text-sm font-mono">Carregando…</div>}
            {!carregando && emBreve.length === 0 && (
              <div className="px-4 py-6 text-muted text-sm font-mono text-center">
                Não foi possível carregar lançamentos agora.
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 px-4 pb-6 pt-3">
              {emBreve.map((j) => (
                <PosterCard
                  key={j.igdb_id}
                  imagem={j.imagem}
                  nome={j.nome}
                  badge={j.data_lancamento?.slice(0, 4)}
                  onClick={() => navigate(`/titulo/novo/${j.igdb_id}?tipo=game&fonte=igdb`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
