import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Heart, ChevronLeft, Star, Check, ChevronDown, ChevronUp, ChevronRight, Calendar, Lock, RotateCcw } from 'lucide-react'
import { supabase, callFunction, idiomaAtual } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { invalidateCache } from '../lib/dataCache'
import { registrarAssistido, apagarHistorico, contarAssistidosPorTitulo } from '../lib/watchLog'
import SectionLabel from '../components/SectionLabel'
import SubTabs from '../components/SubTabs'
import ActionSheet from '../components/ActionSheet'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w400'
const PROVIDER_LOGO_BASE = 'https://image.tmdb.org/t/p/w92'

// Imagens da TMDB vêm como path relativo (precisa prefixar POSTER_BASE); imagens
// da IGDB (jogos) já vêm como URL absoluta — usar direto.
function resolverUrlImagem(imagem) {
  if (!imagem) return null
  return imagem.startsWith('http') ? imagem : `${POSTER_BASE}${imagem}`
}

// Capa de jogo (IGDB) fica pixelada no hero se usar o mesmo tamanho pequeno
// do grid (t_cover_big, ~264x374) — troca pela variante 2x só aqui, onde a
// imagem ocupa a largura inteira da tela.
function resolverUrlImagemGrande(imagem) {
  const url = resolverUrlImagem(imagem)
  if (!url) return null
  return url.includes('images.igdb.com') ? url.replace('/t_cover_big/', '/t_cover_big_2x/') : url
}

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
  const [contagemEpisodios, setContagemEpisodios] = useState(new Map())
  const [contagemTitulo, setContagemTitulo] = useState(0)
  const [provedores, setProvedores] = useState([])
  const [linkProvedores, setLinkProvedores] = useState(null)
  const [temporadaAberta, setTemporadaAberta] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null)
  const [menuStatusAberto, setMenuStatusAberto] = useState(false)
  const [sheetAssistido, setSheetAssistido] = useState(null) // { episodeIds } | { tituloIdAlvo: true } | null
  const [abaAtiva, setAbaAtiva] = useState('sobre')

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
      if (serieRow) {
        tipo = 'tv'
      } else {
        const { data: gameRow } = await supabase.from('games').select('titulo_id').eq('titulo_id', id).maybeSingle()
        tipo = gameRow ? 'game' : 'movie'
      }
    }
    setMediaType(tipo)

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

    // Histórico de reassistidas (watch_log) desta série — paginado pelo mesmo motivo acima.
    const obterHistoricoEpisodiosPaginado = async () => {
      if (!user || tipo !== 'tv') return []
      let list = []
      let de = 0
      const tamanho = 1000
      while (true) {
        const { data, error } = await supabase
          .from('watch_log')
          .select('episode_id, episode!inner(titulo_id)')
          .eq('user_id', user.id)
          .eq('episode.titulo_id', id)
          .range(de, de + tamanho - 1)

        if (error) {
          console.error('Erro ao buscar histórico de episódios (paginado):', error)
          break
        }
        if (!data || data.length === 0) break
        list = [...list, ...data]
        if (data.length < tamanho) break
        de += tamanho
      }
      return list
    }

    // Re-busca provedores (streaming/loja) já cacheados no banco — chamado depois do
    // refresh em segundo plano, quando a Edge Function pode ter acabado de gravá-los.
    const recarregarProvedores = async () => {
      const [provedoresList, linkProv] = await Promise.all([
        supabase.from('titulo_provedor').select('*').eq('titulo_id', id).order('display_priority', { ascending: true }).then(res => res.data ?? []),
        tipo === 'tv'
          ? supabase.from('series').select('watch_providers_link').eq('titulo_id', id).maybeSingle().then(res => res.data?.watch_providers_link ?? null)
          : tipo === 'movie'
          ? supabase.from('movies').select('watch_providers_link').eq('titulo_id', id).maybeSingle().then(res => res.data?.watch_providers_link ?? null)
          : Promise.resolve(null),
      ])
      setProvedores(provedoresList)
      setLinkProvedores(linkProv)
    }

    // LOTE CONCORRENTE PARALELO: Carrega todos os dados paginados e metadados ao mesmo tempo.
    // Tradução só existe pra fonte TMDB (tv/movie) — pular pra jogo evita um round-trip
    // que nunca acha nada (IGDB não passa por esse fluxo de tradução).
    const [traduzido, base, cast, eps, watched, item, rating, historicoEpisodios, contagemTituloVal, provedoresList, linkProv] = await Promise.all([
      tipo === 'game'
        ? Promise.resolve(null)
        : callFunction('get-translate-title', { titulo_id: Number(id), idioma, media_type: tipo }).catch(() => null),
      supabase.from('titulo').select('nome, sinopse, imagem, genero, media_rating, total_avaliacoes, external_id').eq('id', id).maybeSingle().then(res => res.data),
      tipo === 'tv'
        ? supabase.from('elenco_serie').select('personagem, ator(name, image)').eq('titulo_id', id).then(res => res.data ?? [])
        : tipo === 'movie'
        ? supabase.from('elenco_movie').select('personagem, ator(name, image)').eq('titulo_id', id).then(res => res.data ?? [])
        : Promise.resolve([]),
      obterEpisodiosPaginados(),
      obterAssistidosPaginados(),
      user ? supabase.from('user_item').select('status, favorito').eq('user_id', user.id).eq('titulo_id', id).maybeSingle().then(res => res.data) : null,
      user ? supabase.from('user_rating').select('rating_score').eq('user_id', user.id).eq('titulo_id', id).maybeSingle().then(res => res.data) : null,
      obterHistoricoEpisodiosPaginado(),
      tipo !== 'tv' && user ? contarAssistidosPorTitulo(user.id, Number(id)) : Promise.resolve(0),
      supabase.from('titulo_provedor').select('*').eq('titulo_id', id).order('display_priority', { ascending: true }).then(res => res.data ?? []),
      tipo === 'tv'
        ? supabase.from('series').select('watch_providers_link').eq('titulo_id', id).maybeSingle().then(res => res.data?.watch_providers_link ?? null)
        : tipo === 'movie'
        ? supabase.from('movies').select('watch_providers_link').eq('titulo_id', id).maybeSingle().then(res => res.data?.watch_providers_link ?? null)
        : Promise.resolve(null),
    ])

    const mapaContagem = new Map()
    for (const row of historicoEpisodios) {
      mapaContagem.set(row.episode_id, (mapaContagem.get(row.episode_id) ?? 0) + 1)
    }

    setTitulo({ ...base, ...(traduzido ?? {}) })
    setElenco(cast)
    setEpisodios(eps)
    setAssistidos(new Set((watched ?? []).map((w) => w.episode_id)))
    setContagemEpisodios(mapaContagem)
    setContagemTitulo(contagemTituloVal ?? 0)
    setProvedores(provedoresList)
    setLinkProvedores(linkProv)
    setUserItem(item)
    setMinhaNota((prev) => rating?.rating_score ?? prev ?? 0)

    // Sincronização em Background Reativa silenciosa (reaproveita "base" — se veio
    // preenchido, o título já existia antes desta carga, sem precisar de outra query).
    // Usa base.external_id (id real na TMDB/IGDB) — "id" aqui é a PK sintética interna
    // de `titulo`, não o id externo, então nunca deve ser mandado pras Edge Functions.
    if (base && base.external_id && user) {
      if (tipo === 'tv') {
        callFunction('adicionar-titulo', {
          tmdb_id: base.external_id,
          media_type: 'tv',
          status: 'none'
        })
        .then(async () => {
          const novosEps = await obterEpisodiosPaginados()
          if (novosEps && novosEps.length > eps.length) {
            setEpisodios(novosEps)
            console.log(`[Importador] Novas temporadas e episódios sincronizados em background (${novosEps.length - eps.length} novos).`)
          }
          await recarregarProvedores()
        })
        .catch((err) => console.error('Erro na atualização em background:', err))
      } else if (tipo === 'movie') {
        callFunction('adicionar-titulo', {
          tmdb_id: base.external_id,
          media_type: 'movie',
          status: 'none'
        })
        .then(recarregarProvedores)
        .catch((err) => console.error('Erro na atualização em background:', err))
      } else if (tipo === 'game') {
        callFunction('adicionar-jogo', {
          igdb_id: base.external_id,
          status: 'none'
        })
        .then(recarregarProvedores)
        .catch((err) => console.error('Erro na atualização em background:', err))
      }
    }
  }

  // Otimização: Gravação direta e otimista na tabela user_item (sem chamar função na nuvem)
  async function adicionar(status = 'quero_ver') {
    const estadoTemporario = { status, favorito: false }
    setUserItem(estadoTemporario) // Atualização Visual Instantânea
    invalidateCache(['series', 'perfil', 'filmes', 'jogos'])

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
    invalidateCache(['series', 'perfil', 'filmes', 'jogos'])

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
    invalidateCache(['series', 'perfil', 'filmes', 'jogos'])

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
    invalidateCache(['series', 'perfil', 'filmes', 'jogos'])

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
    invalidateCache(['perfil'])

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
    invalidateCache(['series', 'perfil', 'filmes', 'jogos'])

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

    // Toda marcação (primeira vez ou reassistir) soma no histórico; desmarcar zera de volta
    setContagemEpisodios(prev => {
      const novo = new Map(prev)
      episodeIds.forEach(eid => {
        if (desmarcar) novo.delete(eid)
        else novo.set(eid, (novo.get(eid) ?? 0) + 1)
      })
      return novo
    })

    // 2. Processa a sincronização com o banco em segundo plano de forma silenciosa
    try {
      const { error } = desmarcar
        ? await supabase.from('watched_episode').delete().eq('user_id', user.id).in('episode_id', episodeIds)
        : await supabase.from('watched_episode').upsert(
            episodeIds.map((eid) => ({ user_id: user.id, episode_id: eid, watched_at: new Date().toISOString() }))
          )

      if (error) throw error

      const { error: erroStatus } = await supabase.from('user_item').upsert({
        user_id: user.id,
        titulo_id: Number(id),
        status: novoStatus,
        favorito: userItem?.favorito ?? false,
      })
      if (erroStatus) throw erroStatus

      if (!desmarcar) {
        await registrarAssistido({ userId: user.id, episodeIds })
      } else {
        await apagarHistorico({ userId: user.id, episodeIds })
      }
    } catch (err) {
      console.error('[Importador] Erro na gravação:', err)
      carregar() // Se der erro, puxa os dados corretos do banco de volta
    }
  }

  async function marcarEpisodio(episodeObj, marcado) {
    if (marcado) {
      // Já assistido: abre o menu de reassistir/não visto em vez de desmarcar direto
      setSheetAssistido({ episodeIds: [episodeObj.id] })
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
      // Temporada inteira já assistida: abre o menu de reassistir/não visto em vez de desmarcar direto
      setSheetAssistido({ episodeIds: epsDaTemporada.map((e) => e.id) })
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

  // Marca (ou abre o menu de reassistir, se já estiver tudo visto) todos os episódios
  // já lançados da série de uma vez — botão novo no topo da aba Episódios.
  function marcarTudoComoVisto() {
    if (todosEpisodiosAssistidos) {
      setSheetAssistido({ episodeIds: episodiosLancados.map((e) => e.id) })
      return
    }
    const faltantes = episodiosLancados.filter((e) => !assistidos.has(e.id))
    if (faltantes.length > 0) {
      aplicarMarcacao(faltantes.map((e) => e.id), false)
    }
  }

  // Marca/desmarca (ou reassiste) o filme/jogo — status fica só em user_item, sem episódios envolvidos
  async function alternarStatusFilmeOuJogo(desmarcar) {
    const novoStatus = desmarcar ? 'quero_ver' : 'visto'

    setUserItem(prev => prev ? { ...prev, status: novoStatus } : { status: novoStatus, favorito: false })
    setContagemTitulo((c) => (desmarcar ? 0 : c + 1))

    const { error } = await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status: novoStatus,
      favorito: userItem?.favorito ?? false,
    })

    if (error) {
      console.error('Erro ao marcar filme/jogo:', error)
      carregar() // Reverte se falhar
      return
    }

    if (!desmarcar) {
      await registrarAssistido({ userId: user.id, tituloId: Number(id) })
    } else {
      await apagarHistorico({ userId: user.id, tituloId: Number(id) })
    }
  }

  function marcarFilmeVisto() {
    if (userItem?.status === 'visto') {
      // Já assistido/jogado: abre o menu de reassistir/não visto em vez de desmarcar direto
      setSheetAssistido({ tituloIdAlvo: true })
      return
    }
    alternarStatusFilmeOuJogo(false)
  }

  function confirmarReassistir() {
    if (!sheetAssistido) return
    if (sheetAssistido.episodeIds) aplicarMarcacao(sheetAssistido.episodeIds, false)
    else alternarStatusFilmeOuJogo(false)
    setSheetAssistido(null)
  }

  function confirmarNaoVisto() {
    if (!sheetAssistido) return
    if (sheetAssistido.episodeIds) aplicarMarcacao(sheetAssistido.episodeIds, true)
    else alternarStatusFilmeOuJogo(true)
    setSheetAssistido(null)
  }

  function handleVoltar() {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1)
    } else {
      const isTV = mediaType === 'tv' || searchParams.get('tipo') === 'tv' || (titulo && (titulo.temporadas > 0 || mediaType === 'tv'))
      if (isTV) navigate('/series')
      else if (mediaType === 'game') navigate('/jogos')
      else navigate('/filmes')
    }
  }

  const temporadas = useMemo(() => {
    return [...new Set(episodios.map((e) => e.season_number))].sort((a, b) => a - b)
  }, [episodios])

  const episodiosLancados = useMemo(
    () => episodios.filter((e) => e.launch_date && e.launch_date <= hojeString),
    [episodios, hojeString],
  )
  const todosEpisodiosAssistidos = episodiosLancados.length > 0 && episodiosLancados.every((e) => assistidos.has(e.id))

  if (!titulo) return <div className="p-4 text-muted text-sm font-mono">Carregando…</div>

  const rotuloReassistir = mediaType === 'game' ? 'Marcar como rejogado' : 'Marcar como reassistido'
  const rotuloNaoVisto = mediaType === 'game' ? 'Marcar como não jogado' : 'Marcar como não visto'
  const rotuloSheetTitulo = sheetAssistido?.episodeIds
    ? sheetAssistido.episodeIds.length > 1 ? 'Vários episódios assistidos' : 'Episódio assistido'
    : mediaType === 'game' ? 'Já jogado' : 'Já assistido'

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
        {titulo.imagem && <img src={resolverUrlImagemGrande(titulo.imagem)} alt={titulo.nome} className="w-full aspect-[2/3] object-cover" />}
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

          {(mediaType === 'movie' || mediaType === 'game') && (
            <button
              onClick={marcarFilmeVisto}
              aria-label={mediaType === 'game' ? 'Marcar como jogado' : 'Marcar como visto'}
              className={`flex-shrink-0 w-12 h-12 rounded-2xl border flex items-center justify-center ${
                userItem?.status === 'visto' ? 'bg-teal border-teal text-bg shadow-[0_0_14px_rgba(221,13,244,0.45)]' : 'border-white/15 text-muted'
              }`}
            >
              <Check size={20} />
            </button>
          )}
        </div>

        {(mediaType === 'movie' || mediaType === 'game') && userItem?.status === 'visto' && contagemTitulo > 1 && (
          <div className="text-[11px] text-teal font-display font-medium mt-1.5 text-right">
            {mediaType === 'game' ? 'Jogado' : 'Assistido'} · {contagemTitulo}x
          </div>
        )}
      </div>

      {mediaType === 'tv' && (
        <SubTabs
          tabs={[
            { value: 'sobre', label: 'Sobre' },
            { value: 'episodios', label: 'Episódios' },
          ]}
          active={abaAtiva}
          onChange={setAbaAtiva}
        />
      )}

      {(mediaType !== 'tv' || abaAtiva === 'sobre') && (
        <>
          {/* Seção de Avaliação (Sua Nota 1 a 10) com Estrelas e Número Embaixo */}
          <div className="px-4">
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

            {mediaType === 'tv' && episodios.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-muted font-sans mb-1.5">
                  {assistidos.size}/{episodios.length} episódios assistidos
                </div>
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-amber h-full transition-all duration-300 rounded-full"
                    style={{ width: `${Math.round((assistidos.size / episodios.length) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {elenco.length > 0 && (
            <>
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
            </>
          )}

          {(mediaType === 'tv' || mediaType === 'movie') && provedores.length > 0 && (
            <>
              <SectionLabel>Onde assistir</SectionLabel>
              <div className="flex gap-3 px-4 pb-4 overflow-x-auto scroll-area">
                {provedores.map((p) => (
                  <a
                    key={`${p.tipo}-${p.provider_name}`}
                    href={linkProvedores || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-shrink-0 w-14 text-center"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-surface2 overflow-hidden border border-white/5 flex items-center justify-center">
                      {p.logo_path ? (
                        <img
                          src={`${PROVIDER_LOGO_BASE}${p.logo_path}`}
                          alt={p.provider_name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-[9px] text-muted px-1 leading-tight">{p.provider_name}</span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}

          {mediaType === 'game' && provedores.length > 0 && (
            <>
              <SectionLabel>Onde jogar/comprar</SectionLabel>
              <div className="flex flex-wrap gap-2 px-4 pb-4">
                {provedores.map((p) => (
                  <a
                    key={p.provider_name}
                    href={p.url || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-xl bg-surface2 border border-white/5 text-xs font-display font-medium text-ink hover:border-white/20 transition-colors"
                  >
                    {p.provider_name}
                  </a>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {mediaType === 'tv' && abaAtiva === 'episodios' && (
        <>
          <SectionLabel>Episódios</SectionLabel>
          <div className="px-4 pb-12 flex flex-col gap-3">
            {episodiosLancados.length > 0 && (
              <button
                onClick={marcarTudoComoVisto}
                className={`w-full py-3 rounded-2xl font-display font-semibold text-sm flex items-center justify-center gap-2 border transition-all ${
                  todosEpisodiosAssistidos
                    ? 'bg-teal/15 text-teal border-teal/40'
                    : 'bg-surface border-white/10 text-ink hover:border-white/25'
                }`}
              >
                <Check size={16} strokeWidth={2.5} />
                {todosEpisodiosAssistidos ? 'Tudo assistido' : 'Marcar tudo como visto'}
              </button>
            )}

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
                        title={todasAssistidas ? "Reassistir ou desmarcar temporada" : "Marcar toda a temporada como assistida"}
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
                        const vezesAssistido = contagemEpisodios.get(e.id) ?? 0

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
                                    <span className="text-teal font-medium">
                                      Assistido{vezesAssistido > 1 ? ` · ${vezesAssistido}x` : ''}
                                    </span>
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

      <ActionSheet
        open={menuStatusAberto}
        title="Gerenciar série"
        onClose={() => setMenuStatusAberto(false)}
        options={
          userItem?.status === 'interrompida'
            ? [
                { label: 'Voltar a Seguir (Ativa)', icon: <Check size={16} className="text-teal" />, onClick: () => mudarStatus('quero_ver') },
                { label: 'Deixar de seguir', tone: 'danger', onClick: deixarDeSeguir },
              ]
            : [
                { label: 'Interrompida', onClick: () => mudarStatus('interrompida') },
                { label: 'Deixar de seguir', tone: 'danger', onClick: deixarDeSeguir },
              ]
        }
      />

      <ActionSheet
        open={!!sheetAssistido}
        title={rotuloSheetTitulo}
        onClose={() => setSheetAssistido(null)}
        options={[
          { label: rotuloReassistir, tone: 'primary', icon: <RotateCcw size={16} />, onClick: confirmarReassistir },
          { label: rotuloNaoVisto, tone: 'danger', onClick: confirmarNaoVisto },
        ]}
      />
    </div>
  )
}
