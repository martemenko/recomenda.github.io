import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { getCache, setCache, onCacheInvalidate, invalidateCache } from '../lib/dataCache'
import { registrarAssistido } from '../lib/watchLog'
import TopBar from '../components/TopBar'
import SubTabs from '../components/SubTabs'
import SectionLabel from '../components/SectionLabel'
import { ChevronRight, Check } from 'lucide-react'

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000
const DURACAO_ANIMACAO_MS = 260

// Função auxiliar para obter a data atual local formatada como 'YYYY-MM-DD' sem interferência de fuso horário
function obterDataLocalISO(date = new Date()) {
  const ano = date.getFullYear()
  const mes = String(date.getMonth() + 1).padStart(2, '0')
  const dia = String(date.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

// Função auxiliar para resolver o canal e horário de lançamento baseado na identidade de cada série
function obterCanalEHorario(tituloId, tituloNome) {
  const nomeLower = String(tituloNome ?? '').toLowerCase();
  
  if (nomeLower.includes('masterchef')) {
    return { canal: 'YOUTUBE', horario: '22:30' };
  }
  if (nomeLower.includes('x-men') || nomeLower.includes('x-men \'97')) {
    return { canal: 'DISNEY+', horario: '04:00' };
  }
  if (nomeLower.includes('pokémon') || nomeLower.includes('pokemon')) {
    return { canal: 'TV TOKYO', horario: '' };
  }
  if (nomeLower.includes('house of the dragon') || nomeLower.includes('casa do dragão')) {
    return { canal: 'SKY ATLANTIC (UK)', horario: '22:00' };
  }
  if (nomeLower.includes('my adventures with superman') || nomeLower.includes('superman')) {
    return { canal: 'ADULT SWIM', horario: '01:00' };
  }
  if (nomeLower.includes('one piece')) {
    return { canal: 'FUJI TV', horario: '11:15' };
  }
  if (nomeLower.includes('cem anos de solidão') || nomeLower.includes('solidão')) {
    return { canal: 'NETFLIX', horario: '04:00' };
  }

  // Fallback padrão para séries genéricas
  return { canal: 'STREAMING', horario: '12:00' };
}

// Função auxiliar para buscar todas as linhas sem o limite padrão de 1000 do PostgREST
async function buscarTodasLinhas(construirQuery, tamanhoPagina = 1000) {
  let todas = []
  let inicio = 0
  while (true) {
    const { data, error } = await construirQuery().range(inicio, inicio + tamanhoPagina - 1)
    if (error) {
      console.error('[buscarTodasLinhas] Erro ao carregar pagina:', error)
      break
    }
    if (!data || data.length === 0) break
    todas = todas.concat(data)
    if (data.length < tamanhoPagina) break
    inicio += tamanhoPagina
  }
  return todas
}

// Função auxiliar para fatiar consultas .in() em lotes menores de 200 IDs (evita erro HTTP 414 de URL longa)
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

// Função auxiliar para buscar episódios de forma paginada e fatiada em lotes
async function obterEpisodios(tituloIds) {
  if (!tituloIds || tituloIds.length === 0) return []
  return buscarEmLotesIn(
    () =>
      supabase
        .from('episode')
        .select('id, titulo_id, season_number, episode_number, episode_name, launch_date')
        .order('titulo_id', { ascending: true })
        .order('season_number', { ascending: true })
        .order('episode_number', { ascending: true }),
    'titulo_id',
    tituloIds
  )
}

// Função auxiliar para buscar episódios assistidos sem limite de linhas
async function obterAssistidos(userId) {
  return buscarTodasLinhas(() =>
    supabase
      .from('watched_episode')
      .select('episode_id, watched_at')
      .eq('user_id', userId)
      .order('episode_id', { ascending: true })
  )
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

  useEffect(() => {
    if (!user) return

    const cacheKey = `series_data_${user.id}`
    const cached = getCache(cacheKey)

    if (cached?.data) {
      const { itens, episodios, assistidosEntries, historicoData, emBreveData } = cached.data
      setItensCache(itens)
      setEpisodiosCache(episodios)
      const novoAssistidosMapa = new Map(assistidosEntries)
      setAssistidosMapa(novoAssistidosMapa)
      recalcularBuckets(itens, episodios, novoAssistidosMapa)
      setHistorico(historicoData ?? [])
      setEmBreve(emBreveData ?? [])
      setCarregando(false)

      if (cached.isStale) {
        carregar(true)
      }
    } else {
      carregar(false)
    }

    const unsubscribe = onCacheInvalidate((keys) => {
      if (!keys || keys.includes('series') || keys.includes('user_item')) {
        carregar(false)
      }
    })

    return () => unsubscribe()
  }, [user])

  // O container de scroll é o mesmo elemento pras duas sub-abas (só o conteúdo interno
  // troca) — sem isso, "Em breve" abre na posição de scroll que "Minha Lista" deixou.
  useEffect(() => {
    if (aba === 'em_breve' && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [aba])

  // Alinha o scroll perfeitamente na seção "Para assistir" sempre que a aba lista é exibida, ocultando o histórico acima do topo
  useEffect(() => {
    if (!carregando && aba === 'lista' && scrollContainerRef.current && paraAssistirRef.current) {
      const alinharScroll = () => {
        const container = scrollContainerRef.current
        const target = paraAssistirRef.current
        if (container && target) {
          container.scrollTop = target.offsetTop
        }
      }
      alinharScroll()
      const t1 = setTimeout(alinharScroll, 50)
      const t2 = setTimeout(alinharScroll, 150)
      const t3 = setTimeout(alinharScroll, 350)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
        clearTimeout(t3)
      }
    }
  }, [carregando, aba])

  async function carregar(isSilent = false) {
    if (!isSilent) setCarregando(true)
    try {
      const itensBrutos = await buscarTodasLinhas(() =>
        supabase
          .from('user_item')
          .select('titulo_id, status, added_at, titulo(nome, imagem)')
          .eq('user_id', user.id)
          .in('status', ['vendo', 'visto', 'quero_ver'])
          .order('titulo_id', { ascending: true })
      )

      const idsCandidatos = itensBrutos.map((i) => i.titulo_id)
      const seriesEncontradas = idsCandidatos.length
        ? await buscarEmLotesIn(
            () => supabase.from('series').select('titulo_id').order('titulo_id', { ascending: true }),
            'titulo_id',
            idsCandidatos
          )
        : []

      const idsDeSerie = new Set(seriesEncontradas.map((s) => s.titulo_id))
      const itens = itensBrutos.filter((i) => idsDeSerie.has(i.titulo_id))
      setItensCache(itens)

      const tituloIds = itens.map((i) => i.titulo_id)
      if (tituloIds.length === 0) {
        setEpisodiosCache([]); setAssistidosMapa(new Map())
        setAssistirASeguir([]); setSemAssistirHaTempo([]); setEmBreve([])
        const histRes = await carregarHistorico()
        setCache(`series_data_${user.id}`, {
          itens: [],
          episodios: [],
          assistidosEntries: [],
          historicoData: histRes ?? [],
          emBreveData: []
        })
        return
      }

      // Otimização: Filtra para buscar episódios apenas das séries que estão ativas ('vendo')
      const activeTituloIds = itens.filter(i => i.status === 'vendo').map(i => i.titulo_id)
      const hojeLocalStr = obterDataLocalISO()

      // Dispara todas as consultas de forma concorrente em paralelo para máxima velocidade de carregamento
      const [episodiosCompletos, assistidos, futurosBrutos, histRes] = await Promise.all([
        obterEpisodios(activeTituloIds),
        obterAssistidos(user.id),
        buscarEmLotesIn(
          () =>
            supabase
              .from('episode')
              .select('id, titulo_id, season_number, episode_number, episode_name, launch_date')
              .gt('launch_date', hojeLocalStr)
              .order('launch_date', { ascending: true }),
          'titulo_id',
          tituloIds
        ),
        carregarHistorico() // Processa a carga de histórico também em paralelo
      ])

      setEpisodiosCache(episodiosCompletos)

      const novoAssistidosMapa = new Map((assistidos ?? []).map((a) => [a.episode_id, a.watched_at]))
      setAssistidosMapa(novoAssistidosMapa)

      recalcularBuckets(itens, episodiosCompletos, novoAssistidosMapa)

      const tituloPorId = new Map(itens.map((i) => [i.titulo_id, i.titulo]))
      const emBreveFormatado = (futurosBrutos ?? []).map((e) => ({ ...e, titulo: tituloPorId.get(e.titulo_id) }))
      setEmBreve(emBreveFormatado)

      // Grava no cache central
      setCache(`series_data_${user.id}`, {
        itens,
        episodios: episodiosCompletos,
        assistidosEntries: Array.from(novoAssistidosMapa.entries()),
        historicoData: histRes ?? [],
        emBreveData: emBreveFormatado
      })

    } catch (err) {
      console.error('Erro geral ao carregar as séries:', err)
    } finally {
      setCarregando(false)
    }
  }

  // Recalcula "assistir a seguir" / "sem assistir há tempo" a partir dos dados já em
  // memória - não bate no banco de novo. Usado no carregamento inicial E depois de
  // marcar um episódio (atualização local, sem recarregar a tela toda).
  function recalcularBuckets(itens, episodios, assistidosAtual) {
    const hoje = new Date()
    const hojeLocalStr = obterDataLocalISO(hoje)
    const seguir = []
    const semTempo = []

    // Agrupa episódios por série uma única vez (O(episódios)) em vez de filtrar a lista
    // inteira pra cada série (O(séries × episódios)) — a ordem por temporada/episódio da
    // query original (obterEpisodios) é preservada dentro de cada grupo.
    const episodiosPorTitulo = new Map()
    for (const e of episodios) {
      if (!episodiosPorTitulo.has(e.titulo_id)) episodiosPorTitulo.set(e.titulo_id, [])
      episodiosPorTitulo.get(e.titulo_id).push(e)
    }

    for (const item of itens.filter((i) => i.status === 'vendo')) {
      // eps já vem ordenado por temporada/episódio (query em obterEpisodios). Acha o
      // episódio assistido "mais adiante" na ordem e só considera "próximo" a partir
      // dali - assim quem começou a ver do meio (ex: temporada 6) não recebe de volta
      // o episódio 1 da temporada 1, que nunca foi assistido mas já ficou pra trás.
      const eps = episodiosPorTitulo.get(item.titulo_id) ?? []
      let indiceInicial = 0
      for (let i = eps.length - 1; i >= 0; i--) {
        if (assistidosAtual.has(eps[i].id)) { indiceInicial = i + 1; break }
      }
      const proximo = eps
        .slice(indiceInicial)
        .find((e) => !assistidosAtual.has(e.id) && (!e.launch_date || e.launch_date <= hojeLocalStr))
      if (!proximo) continue

      const inlineLine = {
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

      if (hoje - ultimaAtividade > TRINTA_DIAS_MS) semTempo.push(inlineLine)
      else seguir.push(inlineLine)
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

    // Invertemos a ordem do histórico mapeado em memória (.reverse()) para que o mais recente fique no fundo, colado com "Para assistir"
    const historicoOrdenadoCrescente = (histBruto ?? [])
      .map((h) => ({ ...h, episode: { ...h.episode, titulo: mapaTitulos.get(h.episode?.titulo_id) } }))
      .reverse()

    setHistorico(historicoOrdenadoCrescente)
    return historicoOrdenadoCrescente
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
      : await supabase.from('watched_episode').upsert({ user_id: user.id, episode_id: episodeId, watched_at: new Date().toISOString() })

    if (error) {
      console.error('Erro ao marcar episódio assistido:', error)
      setSaindoIds((prev) => { const n = new Set(prev); n.delete(episodeId); return n })
      return
    }

    if (!jaMarcado) {
      registrarAssistido({ userId: user.id, episodeIds: [episodeId] })
    }

    // Invalida cache do perfil para atualizar estatísticas no perfil
    invalidateCache('perfil')

    const novoAssistidosMapa = new Map(assistidosMapa)
    if (jaMarcado) novoAssistidosMapa.delete(episodeId)
    else novoAssistidosMapa.set(episodeId, new Date().toISOString())
    setAssistidosMapa(novoAssistidosMapa)

    recalcularBuckets(itensCache, episodiosCache, novoAssistidosMapa)
    setSaindoIds((prev) => { const n = new Set(prev); n.delete(episodeId); return n })

    // Histórico continua vindo do banco (ordenado pela data real do servidor),
    // mas isso não bloqueia a atualização visual acima.
    const histNovo = await carregarHistorico()

    // Atualiza cache local
    setCache(`series_data_${user.id}`, {
      itens: itensCache,
      episodios: episodiosCache,
      assistidosEntries: Array.from(novoAssistidosMapa.entries()),
      historicoData: histNovo ?? [],
      emBreveData: emBreve
    })
  }

  // --- LÓGICA DE PROCESSO E AGRUPAMENTO DOS LANÇAMENTOS (EM BREVE) ---
  const gruposOrdenados = useMemo(() => {
    const hojeCalculo = new Date()
    hojeCalculo.setHours(0, 0, 0, 0)

    const DIAS_SEMANA = ['DOMINGO', 'SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA', 'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO']
    const gruposMapa = new Map()

    for (const e of emBreve) {
      if (!e.launch_date) continue

      const partes = e.launch_date.split('-')
      const dataLanc = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10))
      dataLanc.setHours(0, 0, 0, 0)

      const diffTempo = dataLanc.getTime() - hojeCalculo.getTime()
      const diffDias = Math.round(diffTempo / (1000 * 60 * 60 * 24))

      if (diffDias < 0) continue

      let chaveGrupo = ''
      let ordemGrupo = 0

      if (diffDias === 0) {
        chaveGrupo = 'HOJE'
        ordemGrupo = 0
      } else if (diffDias === 1) {
        chaveGrupo = 'AMANHÃ'
        ordemGrupo = 1
      } else if (diffDias > 1 && diffDias < 7) {
        chaveGrupo = DIAS_SEMANA[dataLanc.getDay()]
        ordemGrupo = diffDias
      } else {
        chaveGrupo = 'MAIS TARDE'
        ordemGrupo = 100 + diffDias
      }

      const { canal, horario } = obterCanalEHorario(e.titulo_id, e.titulo?.nome)

      const epFormatado = {
        ...e,
        diffDias,
        canal,
        horario,
      }

      if (!gruposMapa.has(chaveGrupo)) {
        gruposMapa.set(chaveGrupo, { chave: chaveGrupo, ordem: ordemGrupo, itens: [] })
      }
      gruposMapa.get(chaveGrupo).itens.push(epFormatado)
    }

    return [...gruposMapa.values()].sort((a, b) => a.ordem - b.ordem)
  }, [emBreve])

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

      {/* pb-24, relative e Ref adicionadas para garantir o scroll correto e o respiro do menu */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scroll-area pb-24 relative">
        {carregando && <div className="p-4 text-muted text-sm font-mono">Carregando…</div>}

        {!carregando && aba === 'lista' && (
          <>
            {/* O histórico de exibição fica no topo da lista (acima do Para Assistir) */}
            {historico.length > 0 && (
              <>
                <SectionLabel>Histórico de exibição</SectionLabel>
                <div className="flex flex-col gap-2.5 px-4 pb-4">
                  {historico.map((h, i) => (
                    <div 
                      key={`${h.episode.id}-${i}`} 
                      className="opacity-40 hover:opacity-75 transition-all duration-300"
                    >
                      <div className="bg-surface border border-white/5 rounded-2xl p-3 flex gap-3 items-center justify-between">
                        {/* Lado Esquerdo: Poster (Navega para a tela EpisodioDetalhe) */}
                        <div
                          onClick={() => navigate(`/episodio/${h.episode.id}`)}
                          className="w-14 aspect-[2/3] rounded-xl bg-surface2 overflow-hidden flex-shrink-0 cursor-pointer"
                        >
                          {h.episode.titulo?.imagem && (
                            <img
                              src={`https://image.tmdb.org/t/p/w200${h.episode.titulo.imagem}`}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>

                        {/* Centro: Informações do Episódio */}
                        <div className="flex-1 flex flex-col justify-center min-w-0">
                          <div className="flex">
                            {/* Nome da Série (Clica para ir para a série) */}
                            <button
                              onClick={() => navigate(`/titulo/${h.episode.titulo_id}?tipo=tv`)}
                              className="text-[10px] font-display font-extrabold text-indigo-400 hover:text-indigo-300 text-left uppercase truncate flex items-center gap-0.5 tracking-wider bg-white/5 border border-white/5 px-2 py-0.5 rounded-full"
                            >
                              {h.episode.titulo?.nome} <ChevronRight size={10} strokeWidth={3} />
                            </button>
                          </div>
                          
                          {/* Temporada e Episódio (Navega para a tela EpisodioDetalhe) */}
                          <button
                            onClick={() => navigate(`/episodio/${h.episode.id}`)}
                            className="text-sm font-display font-bold text-ink mt-1.5 text-left hover:text-amber transition-colors"
                          >
                            S{String(h.episode.season_number).padStart(2, '0')} | E{String(h.episode.episode_number).padStart(2, '0')}
                          </button>

                          {/* Nome do Episódio (Navega para a tela EpisodioDetalhe) */}
                          <button
                            onClick={() => navigate(`/episodio/${h.episode.id}`)}
                            className="text-xs text-muted font-display font-medium truncate mt-0.5 text-left hover:text-ink transition-colors"
                          >
                            {h.episode.episode_name || 'TBA'}
                          </button>
                        </div>

                        {/* Lado Direito: Círculo de Visto */}
                        <button
                          onClick={() => marcarAssistido(h.episode.id, true)}
                          className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center border bg-teal border-teal text-bg shadow-[0_0_10px_rgba(221,13,244,0.45)]"
                        >
                          <Check size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Este elemento recebe a referência e é a posição inicial visível da página */}
            <div ref={paraAssistirRef}>
              <SectionLabel>Para assistir</SectionLabel>
            </div>
            
            {assistirASeguir.length === 0 && <EmptyRow texto="Nenhum episódio novo por aqui." />}
            <div className="flex flex-col gap-2.5 px-4 pb-4">
              {assistirASeguir.map((l) => (
                <div
                  key={l.episodeId}
                  className={`bg-surface border border-white/5 rounded-2xl p-3 flex gap-3 items-center justify-between transition-all duration-300 ${
                    saindoIds.has(l.episodeId) ? 'scale-95 opacity-0' : ''
                  }`}
                >
                  {/* Lado Esquerdo: Poster (Navega para a tela EpisodioDetalhe) */}
                  <div
                    onClick={() => navigate(`/episodio/${l.episodeId}`)}
                    className="w-14 aspect-[2/3] rounded-xl bg-surface2 overflow-hidden flex-shrink-0 cursor-pointer"
                  >
                    {l.imagem && (
                      <img
                        src={`https://image.tmdb.org/t/p/w200${l.imagem}`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>

                  {/* Centro: Informações do Episódio */}
                  <div className="flex-1 flex flex-col justify-center min-w-0">
                    <div className="flex">
                      {/* Nome da Série (Clica para ir para a série) */}
                      <button
                        onClick={() => navigate(`/titulo/${l.tituloId}?tipo=tv`)}
                        className="text-[10px] font-display font-extrabold text-indigo-400 hover:text-indigo-300 text-left uppercase truncate flex items-center gap-0.5 tracking-wider bg-white/5 border border-white/5 px-2 py-0.5 rounded-full"
                      >
                        {l.tituloNome} <ChevronRight size={10} strokeWidth={3} />
                      </button>
                    </div>
                    
                    {/* Temporada e Episódio (Navega para a tela EpisodioDetalhe) */}
                    <button
                      onClick={() => navigate(`/episodio/${l.episodeId}`)}
                      className="text-sm font-display font-bold text-ink mt-1.5 text-left hover:text-amber transition-colors"
                    >
                      S{String(l.temporada).padStart(2, '0')} | E{String(l.episodio).padStart(2, '0')}
                    </button>

                    {/* Nome do Episódio (Navega para a tela EpisodioDetalhe) */}
                    <button
                      onClick={() => navigate(`/episodio/${l.episodeId}`)}
                      className="text-xs text-muted font-display font-medium truncate mt-0.5 text-left hover:text-ink transition-colors"
                    >
                      {l.episodioNome || 'TBA'}
                    </button>
                  </div>

                  {/* Lado Direito: Círculo de Visto Desmarcado */}
                  <button
                    onClick={() => marcarAssistido(l.episodeId, false)}
                    className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center border border-white/15 text-muted hover:border-white/30"
                  >
                    <Check size={18} />
                  </button>
                </div>
              ))}
            </div>

            {semAssistirHaTempo.length > 0 && (
              <>
                <SectionLabel>Sem assistir há algum tempo</SectionLabel>
                <div className="flex flex-col gap-2.5 px-4 pb-4">
                  {semAssistirHaTempo.map((l) => (
                    <div
                      key={l.episodeId}
                      className={`bg-surface border border-white/5 rounded-2xl p-3 flex gap-3 items-center justify-between transition-all duration-300 ${
                        saindoIds.has(l.episodeId) ? 'scale-95 opacity-0' : ''
                      }`}
                    >
                      {/* Lado Esquerdo: Poster (Navega para a tela EpisodioDetalhe) */}
                      <div
                        onClick={() => navigate(`/episodio/${l.episodeId}`)}
                        className="w-14 aspect-[2/3] rounded-xl bg-surface2 overflow-hidden flex-shrink-0 cursor-pointer"
                      >
                        {l.imagem && (
                          <img
                            src={`https://image.tmdb.org/t/p/w200${l.imagem}`}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>

                      {/* Centro: Informações do Episódio */}
                      <div className="flex-1 flex flex-col justify-center min-w-0">
                        <div className="flex">
                          {/* Nome da Série (Clica para ir para a série) */}
                          <button
                            onClick={() => navigate(`/titulo/${l.tituloId}?tipo=tv`)}
                            className="text-[10px] font-display font-extrabold text-indigo-400 hover:text-indigo-300 text-left uppercase truncate flex items-center gap-0.5 tracking-wider bg-white/5 border border-white/5 px-2 py-0.5 rounded-full"
                          >
                            {l.tituloNome} <ChevronRight size={10} strokeWidth={3} />
                          </button>
                        </div>
                        
                        {/* Temporada e Episódio (Navega para a tela EpisodioDetalhe) */}
                        <button
                          onClick={() => navigate(`/episodio/${l.episodeId}`)}
                          className="text-sm font-display font-bold text-ink mt-1.5 text-left hover:text-amber transition-colors"
                        >
                          S{String(l.temporada).padStart(2, '0')} | E{String(l.episodio).padStart(2, '0')}
                        </button>

                        {/* Nome do Episódio (Navega para a tela EpisodioDetalhe) */}
                        <button
                          onClick={() => navigate(`/episodio/${l.episodeId}`)}
                          className="text-xs text-muted font-display font-medium truncate mt-0.5 text-left hover:text-ink transition-colors"
                        >
                          {l.episodioNome || 'TBA'}
                        </button>
                      </div>

                      {/* Lado Direito: Círculo de Visto Desmarcado */}
                      <button
                        onClick={() => marcarAssistido(l.episodeId, false)}
                        className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center border border-white/15 text-muted hover:border-white/30"
                      >
                        <Check size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* Interface "Em breve" redesenhada com fontes robustas da marca (font-display) */}
        {!carregando && aba === 'em_breve' && (
          <div className="px-4 pb-12 flex flex-col gap-4">
            {gruposOrdenados.length === 0 && <EmptyRow texto="Nada anunciado ainda pras suas séries." />}
            {gruposOrdenados.map((grupo) => (
              <div key={grupo.chave} className="flex flex-col gap-2">
                {/* Rótulo do Dia (Pill Centralizada) com fonte display robusta */}
                <div className="flex justify-center my-3">
                  <span className="bg-white/5 border border-white/5 text-ink text-[10px] font-display font-extrabold uppercase px-3 py-1 rounded-full tracking-wider">
                    {grupo.chave}
                  </span>
                </div>

                {/* Lista de episódios do dia */}
                <div className="flex flex-col gap-2.5">
                  {grupo.itens.map((e) => (
                    <div
                      key={e.id}
                      className="bg-surface border border-white/5 rounded-2xl p-3 flex gap-3 items-center justify-between"
                    >
                      {/* Lado Esquerdo: Poster (Navega para a tela EpisodioDetalhe) */}
                      <div
                        onClick={() => navigate(`/episodio/${e.id}`)}
                        className="w-14 aspect-[2/3] rounded-xl bg-surface2 overflow-hidden flex-shrink-0 cursor-pointer"
                      >
                        {e.titulo?.imagem && (
                          <img
                            src={`https://image.tmdb.org/t/p/w200${e.titulo.imagem}`}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>

                      {/* Centro: Metadados do Episódio com fontes display fortes */}
                      <div className="flex-1 flex flex-col justify-center min-w-0">
                        {/* Nome da Série (Clica para ir para a série) */}
                        <div className="flex">
                          <button
                            onClick={() => navigate(`/titulo/${e.titulo_id}?tipo=tv`)}
                            className="text-[10px] font-display font-extrabold text-indigo-400 hover:text-indigo-300 text-left uppercase truncate flex items-center gap-0.5 tracking-wider bg-white/5 border border-white/5 px-2 py-0.5 rounded-full"
                          >
                            {e.titulo?.nome} <ChevronRight size={10} strokeWidth={3} />
                          </button>
                        </div>
                        
                        {/* Temporada e Episódio (Navega para a tela EpisodioDetalhe) */}
                        <button
                          onClick={() => navigate(`/episodio/${e.id}`)}
                          className="text-sm font-display font-bold text-ink mt-1.5 text-left hover:text-amber transition-colors"
                        >
                          S{String(e.season_number).padStart(2, '0')} | E{String(e.episode_number).padStart(2, '0')}
                        </button>

                        {/* Nome do Episódio (Navega para a tela EpisodioDetalhe) */}
                        <button
                          onClick={() => navigate(`/episodio/${e.id}`)}
                          className="text-xs text-muted font-display font-medium truncate mt-0.5 text-left hover:text-ink transition-colors"
                        >
                          {e.episode_name || 'TBA'}
                        </button>
                      </div>

                      {/* Lado Direito: Dias Restantes, Horário e Canal com fontes display de alta nitidez */}
                      <div className="flex flex-col items-end justify-center text-right flex-shrink-0 min-w-[70px]">
                        {e.diffDias === 0 || e.diffDias === 1 ? (
                          <>
                            <div className="text-[10px] font-display font-extrabold text-muted uppercase tracking-wider">
                              {e.diffDias === 0 ? 'HOJE' : 'AMANHÃ'}
                            </div>
                            {e.horario && (
                              <div className="text-xs font-display font-bold text-ink mt-0.5">
                                {e.horario}
                              </div>
                            )}
                            <div className="text-[9.5px] font-display font-semibold text-muted uppercase mt-0.5 truncate max-w-[100px] tracking-wide">
                              {e.canal}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-xl font-display font-extrabold text-ink leading-none">
                              {e.diffDias}
                            </div>
                            <div className="text-[9px] font-display font-bold text-muted uppercase leading-none mt-0.5 tracking-wider">
                              DIAS
                            </div>
                            {e.horario && (
                              <div className="text-[10px] font-display font-semibold text-ink mt-1">
                                {e.horario}
                              </div>
                            )}
                            <div className="text-[9.5px] font-display font-semibold text-muted uppercase mt-0.5 truncate max-w-[100px] tracking-wide">
                              {e.canal}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function EmptyRow({ texto }) {
  return <div className="px-4 py-6 text-muted text-sm font-mono text-center">{texto}</div>
}
