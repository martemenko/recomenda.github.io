import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import TopBar from '../components/TopBar'
import SubTabs from '../components/SubTabs'
import SectionLabel from '../components/SectionLabel'
import EpisodioRow from '../components/EpisodioRow'

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000
const DURACAO_ANIMACAO_MS = 260

// Função auxiliar para buscar episódios de forma paginada e segura contra estouro de URL
async function obterEpisodios(tituloIds) {
  if (!tituloIds || tituloIds.length === 0) return []
  let eps = []
  let de = 0
  const tamanho = 1000

  while (true) {
    const { data, error } = await supabase
      .from('episode')
      .select('id, titulo_id, season_number, episode_number, episode_name, launch_date')
      .in('titulo_id', tituloIds)
      .order('titulo_id', { ascending: true })
      .order('season_number', { ascending: true })
      .order('episode_number', { ascending: true })
      .range(de, de + tamanho - 1)

    if (error) {
      console.error('Erro ao buscar episode (paginado):', error)
      break
    }
    
    if (!data || data.length === 0) break
    eps = [...eps, ...data]
    
    if (data.length < tamanho) break
    de += tamanho
  }
  return eps
}

// Função auxiliar para buscar episódios assistidos de forma paginada
async function obterAssistidos(userId) {
  let list = []
  let de = 0
  const tamanho = 1000

  while (true) {
    const { data, error } = await supabase
      .from('watched_episode')
      .select('episode_id, watched_at')
      .eq('user_id', userId)
      .range(de, de + tamanho - 1)

    if (error) {
      console.error('Erro ao buscar watched_episode (paginado):', error)
      break
    }
    
    if (!data || data.length === 0) break
    list = [...list, ...data]
    
    if (data.length < tamanho) break
    de += tamanho
  }
  return list
}

export default function SeriesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [aba, setAba] = useState('lista')
  const [carregando, setCarregando] = useState(true)
  const [saindoIds, setSaindoIds] = useState(new Set())

  // Referências para controlar a posição inicial do scroll
  const scrollContainerRef = useRef(null)
  const paraAssistirRef = useRef(null)

  // Dados brutos guardados em memória, pra recalcular localmente sem reconsultar o banco
  const [itensCache, setItensCache] = useState([])
  const [episodiosCache, setEpisodiosCache] = useState([])
  const [assistidosMapa, setAssistidosMapa] = useState(new Map())

  const [assistirASeguir, setAssistirASeguir] = useState([])
  const [semAssistirHaTempo, setSemAssistirHaTempo] = useState([])
  const [historico, setHistorico] = useState([])
  const [emBreve, setEmBreve] = useState([])

// Efeito matemático para alinhar o scroll perfeitamente em "Para assistir" ocultando o histórico no topo
  useEffect(() => {
    if (!carregando && aba === 'lista' && scrollContainerRef.current && paraAssistirRef.current) {
      // Reduzido para 30ms para resposta visual instantânea e imperceptível, dando o tempo mínimo para o navegador processar as alturas
      const t = setTimeout(() => {
        if (scrollContainerRef.current && paraAssistirRef.current) {
          const parentRect = scrollContainerRef.current.getBoundingClientRect()
          const childRect = paraAssistirRef.current.getBoundingClientRect()
          
          // Fórmula matemática que calcula o deslocamento exato de pixel em qualquer navegador
          const targetScrollTop = childRect.top - parentRect.top + scrollContainerRef.current.scrollTop
          
          scrollContainerRef.current.scrollTop = targetScrollTop
        }
      }, 30) 
      return () => clearTimeout(t)
    }
  }, [carregando, aba, historico.length])

  async function carregar() {
    setCarregando(true)

    const { data: itensBrutos, error: erroItens } = await supabase
      .from('user_item')
      .select('titulo_id, status, added_at, titulo(nome, imagem)')
      .eq('user_id', user.id)
      .in('status', ['vendo', 'visto'])
    if (erroItens) console.error('Erro ao buscar user_item:', erroItens)

    const idsCandidatos = (itensBrutos ?? []).map((i) => i.titulo_id)
    const { data: seriesEncontradas, error: erroSeries } = await supabase
      .from('series')
      .select('titulo_id')
      .in('titulo_id', idsCandidatos.length ? idsCandidatos : [0])
    if (erroSeries) console.error('Erro ao buscar series:', erroSeries)

    const idsDeSerie = new Set((seriesEncontradas ?? []).map((s) => s.titulo_id))
    const itens = (itensBrutos ?? []).filter((i) => idsDeSerie.has(i.titulo_id))
    setItensCache(itens)

    const tituloIds = itens.map((i) => i.titulo_id)
    if (tituloIds.length === 0) {
      setEpisodiosCache([]); setAssistidosMapa(new Map())
      setAssistirASeguir([]); setSemAssistirHaTempo([]); setEmBreve([])
      await carregarHistorico()
      setCarregando(false)
      return
    }

    const activeTituloIds = itens.filter(i => i.status === 'vendo').map(i => i.titulo_id)
    const hoje = new Date()

    // Dispara todas as consultas de forma concorrente em paralelo para máxima velocidade de carregamento
    const [episodiosCompletos, assistidos, futurosBrutos] = await Promise.all([
      obterEpisodios(activeTituloIds),
      obterAssistidos(user.id),
      supabase
        .from('episode')
        .select('id, titulo_id, season_number, episode_number, episode_name, launch_date')
        .in('titulo_id', tituloIds) // Próximos lançamentos buscam de todas as seguidas
        .gt('launch_date', hoje.toISOString().slice(0, 10))
        .order('launch_date', { ascending: true })
        .then(res => {
          if (res.error) console.error('Erro ao buscar em breve:', res.error)
          return res.data ?? []
        }),
      carregarHistorico() // Processa a carga de histórico também em paralelo
    ])

    setEpisodiosCache(episodiosCompletos)

    const novoAssistidosMapa = new Map((assistidos ?? []).map((a) => [a.episode_id, a.watched_at]))
    setAssistidosMapa(novoAssistidosMapa)

    recalcularBuckets(itens, episodiosCompletos, novoAssistidosMapa)

    const tituloPorId = new Map(itens.map((i) => [i.titulo_id, i.titulo]))
    setEmBreve((futurosBrutos ?? []).map((e) => ({ ...e, titulo: tituloPorId.get(e.titulo_id) })))

    setCarregando(false)
  }

  // Recalcula "assistir a seguir" / "sem assistir há tempo" a partir dos dados já em
  // memória - não bate no banco de novo. Usado no carregamento inicial E depois de
  // marcar um episódio (atualização local, sem recarregar a tela toda).
  function recalcularBuckets(itens, episodios, assistidosAtual) {
    const hoje = new Date()
    const seguir = []
    const semTempo = []

    for (const item of itens.filter((i) => i.status === 'vendo')) {
      const eps = episodios.filter((e) => e.titulo_id === item.titulo_id)
      let indiceInicial = 0
      for (let i = eps.length - 1; i >= 0; i--) {
        if (assistidosAtual.has(eps[i].id)) { indiceInicial = i + 1; break }
      }
      const proximo = eps
        .slice(indiceInicial)
        .find((e) => !assistidosAtual.has(e.id) && (!e.launch_date || new Date(e.launch_date) <= hoje))
      if (!proximo) continue

      const linha = {
        tituloId: item.titulo_id,
        tituloNome: item.titulo.nome,
        imagem: item.titulo.imagem,
        temporada: proximo.season_number,
        episodio: proximo.episode_number,
        episodioNome: proximo.episode_name,
        episodeId: proximo.id,
      }

      const datasAssistidas = eps.map((e) => assistidosAtual.get(e.id)).filter(Boolean).map((d) => new Date(d))
      const ultimaAtividade = datasAssistidas.length ? new Date(Math.max(...datasAssistidas)) : new Date(item.added_at)

      if (hoje - ultimaAtividade > TRINTA_DIAS_MS) semTempo.push(linha)
      else seguir.push(linha)
    }

    setAssistirASeguir(seguir)
    setSemAssistirHaTempo(semTempo)
  }

  async function carregarHistorico() {
    const { data: histBruto, error: erroHist } = await supabase
      .from('watched_episode')
      .select('watched_at, episode(id, season_number, episode_number, episode_name, titulo_id)')
      .eq('user_id', user.id)
      .order('watched_at', { ascending: false })
      .limit(10) // Ajustado de 30 para os 10 últimos vistos
    if (erroHist) console.error('Erro ao buscar histórico:', erroHist)

    const idsHist = [...new Set((histBruto ?? []).map((h) => h.episode?.titulo_id).filter(Boolean))]
    const { data: titulosHist } = idsHist.length
      ? await supabase.from('titulo').select('id, nome, imagem').in('id', idsHist)
      : { data: [] }
    const mapaTitulos = new Map((titulosHist ?? []).map((t) => [t.id, t]))

    setHistorico(
      (histBruto ?? []).map((h) => ({ ...h, episode: { ...h.episode, titulo: mapaTitulos.get(h.episode?.titulo_id) } })),
    )
  }

  // Marca/desmarca um episódio com atualização LOCAL (sem recarregar a tela toda):
  // 1. Dispara a animação de saída na linha clicada.
  // 2. Grava no banco.
  // 3. Atualiza o cache local de assistidos e recalcula só os buckets, na memória.
  async function marcarAssistido(episodeId, jaMarcado) {
    setSaindoIds((prev) => new Set(prev).add(episodeId))
    await new Promise((r) => setTimeout(r, DURACAO_ANIMACAO_MS))

    const { error } = jaMarcado
      ? await supabase.from('watched_episode').delete().eq('user_id', user.id).eq('episode_id', episodeId)
      : await supabase.from('watched_episode').upsert({ user_id: user.id, episode_id: episodeId })

    if (error) {
      console.error('Erro ao marcar episódio assistido:', error)
      setSaindoIds((prev) => { const n = new Set(prev); n.delete(episodeId); return n })
      return
    }

    const novoAssistidosMapa = new Map(assistidosMapa)
    if (jaMarcado) novoAssistidosMapa.delete(episodeId)
    else novoAssistidosMapa.set(episodeId, new Date().toISOString())
    setAssistidosMapa(novoAssistidosMapa)

    recalcularBuckets(itensCache, episodiosCache, novoAssistidosMapa)
    setSaindoIds((prev) => { const n = new Set(prev); n.delete(episodeId); return n })

    carregarHistorico()
  }

  return (
    <>
      {/* Corrige o alinhamento do menu inferior de navegação na borda física da tela */}
      <style>{`
        nav, footer, [class*="bottom-"] {
          bottom: 0 !important;
          margin-bottom: 0 !important;
          padding-bottom: max(12px, env(safe-area-inset-bottom)) !important;
        }
      `}</style>

      <TopBar title="Séries" />
      <SubTabs
        tabs={[{ value: 'lista', label: 'Minha Lista' }, { value: 'em_breve', label: 'Em breve' }]}
        active={aba}
        onChange={setAba}
      />

      {/* pb-24 e relative adicionados para dar folga e isolamento ao rolar o conteúdo */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-area pb-24 relative">
        {carregando && <div className="p-4 text-muted text-sm font-mono">Carregando…</div>}

        {!carregando && aba === 'lista' && (
          <>
            {/* O histórico de exibição fica no topo do fluxo de rolagem */}
            {historico.length > 0 && (
              <>
                <SectionLabel>Histórico de exibição</SectionLabel>
                {/* opacity-40 e hover:opacity-75 para deixar o histórico visualmente mais escuro que a lista ativa */}
                <div className="flex flex-col gap-0.5">
                  {historico.map((h, i) => (
                    <div key={`${h.episode.id}-${i}`} className="opacity-40 hover:opacity-75 transition-opacity duration-200">
                      <EpisodioRow
                        posterPath={h.episode.titulo?.imagem}
                        tituloNome={h.episode.titulo?.nome}
                        temporada={h.episode.season_number}
                        episodio={h.episode.episode_number}
                        episodioNome={h.episode.episode_name}
                        marcado={true}
                        saindo={saindoIds.has(h.episode.id)}
                        onMarcar={() => marcarAssistido(h.episode.id, true)}
                        onAbrirTitulo={() => navigate(`/titulo/${h.episode.titulo_id}?tipo=tv`)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Este elemento recebe a referência que dita a posição padrão de abertura da página */}
            <div ref={paraAssistirRef}>
              <SectionLabel>Para assistir</SectionLabel>
            </div>
            
            {assistirASeguir.length === 0 && <EmptyRow texto="Nenhum episódio novo por aqui." />}
            {assistirASeguir.map((l) => (
              <EpisodioRow
                key={l.episodeId}
                posterPath={l.imagem}
                tituloNome={l.tituloNome}
                temporada={l.temporada}
                episodio={l.episodio}
                episodioNome={l.episodioNome}
                marcado={false}
                saindo={saindoIds.has(l.episodeId)}
                onMarcar={() => marcarAssistido(l.episodeId, false)}
                onAbrirTitulo={() => navigate(`/titulo/${l.tituloId}?tipo=tv`)}
              />
            ))}

            {semAssistirHaTempo.length > 0 && (
              <>
                <SectionLabel>Sem assistir há algum tempo</SectionLabel>
                {semAssistirHaTempo.map((l) => (
                  <EpisodioRow
                    key={l.episodeId}
                    posterPath={l.imagem}
                    tituloNome={l.tituloNome}
                    temporada={l.temporada}
                    episodio={l.episodio}
                    episodioNome={l.episodioNome}
                    marcado={false}
                    saindo={saindoIds.has(l.episodeId)}
                    onMarcar={() => marcarAssistido(l.episodeId, false)}
                    onAbrirTitulo={() => navigate(`/titulo/${l.tituloId}?tipo=tv`)}
                  />
                ))}
              </>
            )}
          </>
        )}

        {!carregando && aba === 'em_breve' && (
          <>
            <SectionLabel>Próximos lançamentos</SectionLabel>
            {emBreve.length === 0 && <EmptyRow texto="Nada anunciado ainda pras suas séries." />}
            {emBreve.map((e) => (
              <EpisodioRow
                key={e.id}
                posterPath={e.titulo?.imagem}
                tituloNome={e.titulo?.nome}
                temporada={e.season_number}
                episodio={e.episode_number}
                episodioNome={`${e.episode_name} · ${new Date(e.launch_date).toLocaleDateString()}`}
                marcado={false}
                onMarcar={() => {}}
                onAbrirTitulo={() => navigate(`/titulo/${e.titulo_id}`)}
              />
            ))}
          </>
        )}
      </div>
    </>
  )
}

function EmptyRow({ texto }) {
  return <div className="px-4 py-6 text-muted text-sm font-mono text-center">{texto}</div>
}
