import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Heart, ChevronLeft, Star, Check } from 'lucide-react'
import { supabase, callFunction, idiomaAtual } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import SectionLabel from '../components/SectionLabel'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w400'

// Função auxiliar para formatar datas de YYYY-MM-DD para DD/MM/YYYY
function formatarData(dataStr) {
  if (!dataStr) return 'TBA'
  const partes = dataStr.split('-')
  if (partes.length < 3) return 'TBA'
  return `${partes[2]}/${partes[1]}/${partes[0]}`
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
  const [temporadaAberta, setTemporadaAberta] = useState(null)
  const [confirmacao, setConfirmacao] = useState(null)
  const [menuStatusAberto, setMenuStatusAberto] = useState(false)

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
      tipo = serieRow ? 'tv' : 'movie'
    }
    setMediaType(tipo)

    const { data: existente } = await supabase
      .from('titulo')
      .select('id')
      .eq('id', id)
      .maybeSingle()

    // Se o título for inédito no banco local, acionamos a ingestão base rápida com status "none"
    if (!existente && user) {
      await callFunction('adicionar-titulo', { 
        tmdb_id: Number(id), 
        media_type: tipo, 
        status: 'none' 
      }).catch((err) => console.error('Erro ao registrar dados base:', err))
    }

    // Funções auxiliares locais de paginação concorrente para superar o limite de 1000 linhas
    const obterEpisodiosPaginados = async () => {
      if (tipo !== 'tv') return []
      let eps = []
      let de = 0
      const tamanho = 1000
      while (true) {
        const { data, error } = await supabase
          .from('episode')
          .select('id, season_number, episode_number, episode_name, launch_date')
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

    // LOTE CONCORRENTE PARALELO: Carrega todos os dados paginados e metadados ao mesmo tempo
    const [traduzido, base, cast, eps, watched, item, rating] = await Promise.all([
      callFunction('get-translate-title', { titulo_id: Number(id), idioma, media_type: tipo }).catch(() => null),
      supabase.from('titulo').select('nome, sinopse, imagem, genero, media_rating, total_avaliacoes').eq('id', id).maybeSingle().then(res => res.data),
      tipo === 'tv'
        ? supabase.from('elenco_serie').select('personagem, ator(name, image)').eq('titulo_id', id).then(res => res.data ?? [])
        : supabase.from('elenco_movie').select('personagem, ator(name, image)').eq('titulo_id', id).then(res => res.data ?? []),
      obterEpisodiosPaginados(),
      obterAssistidosPaginados(),
      user ? supabase.from('user_item').select('status, favorito').eq('user_id', user.id).eq('titulo_id', id).maybeSingle().then(res => res.data) : null,
      user ? supabase.from('user_rating').select('rating_score').eq('user_id', user.id).eq('titulo_id', id).maybeSingle().then(res => res.data) : null
    ])

    setTitulo({ ...base, ...(traduzido ?? {}) })
    setElenco(cast)
    setEpisodios(eps)
    setAssistidos(new Set((watched ?? []).map((w) => w.episode_id)))
    setUserItem(item)
    setMinhaNota(rating?.rating_score ?? 0)

    // Sincronização em Background Reativa silenciosa
    if (existente && tipo === 'tv' && user) {
      callFunction('adicionar-titulo', { 
        tmdb_id: Number(id), 
        media_type: 'tv', 
        status: 'none' 
      })
      .then(async () => {
        const novosEps = await obterEpisodiosPaginados()
        if (novosEps && novosEps.length > eps.length) {
          setEpisodios(novosEps)
          console.log(`[Importador] Novas temporadas e episódios sincronizados em background (${novosEps.length - eps.length} novos).`)
        }
      })
      .catch((err) => console.error('Erro na atualização em background:', err))
    }
  }

  // Otimização: Gravação direta e otimista na tabela user_item (sem chamar função na nuvem)
  async function adicionar(status = 'quero_ver') {
    const estadoTemporario = { status, favorito: false }
    setUserItem(estadoTemporario) // Atualização Visual Instantânea

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
    setMinhaNota(nota)
    await callFunction('avaliar', { titulo_id: Number(id), rating_score: nota })
    carregar()
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

    // 2. Processa a sincronização com o banco em segundo plano de forma silenciosa
    try {
      const { error } = desmarcar
        ? await supabase.from('watched_episode').delete().eq('user_id', user.id).in('episode_id', episodeIds)
        : await supabase.from('watched_episode').upsert(episodeIds.map((eid) => ({ user_id: user.id, episode_id: eid })))
      
      if (error) throw error

      const { error: erroStatus } = await supabase.from('user_item').upsert({
        user_id: user.id,
        titulo_id: Number(id),
        status: novoStatus,
        favorito: userItem?.favorito ?? false,
      })
      if (erroStatus) throw erroStatus
    } catch (err) {
      console.error('[Importador] Erro na gravação:', err)
      carregar() // Se der erro, puxa os dados corretos do banco de volta
    }
  }

  async function marcarEpisodio(episodeObj, marcado) {
    if (marcado) {
      await aplicarMarcacao([episodeObj.id], true)
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
      await aplicarMarcacao(epsDaTemporada.map((e) => e.id), true)
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

  async function marcarFilmeVisto() {
    const novoStatus = userItem?.status === 'visto' ? 'quero_ver' : 'visto'
    
    // Atualização Visual Instantânea
    setUserItem(prev => prev ? { ...prev, status: novoStatus } : { status: novoStatus, favorito: false })

    const { error } = await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status: novoStatus,
      favorito: userItem?.favorito ?? false,
    })
    
    if (error) {
      console.error('Erro ao marcar filme visto:', error)
      carregar() // Reverte se falhar
    }
  }

  if (!titulo) return <div className="p-4 text-muted text-sm font-mono">Carregando…</div>

  const temporadas = [...new Set(episodios.map((e) => e.season_number))]

  return (
    <div className="flex-1 overflow-y-auto scroll-area">
      <div className="relative">
        {titulo.imagem && <img src={`${POSTER_BASE}${titulo.imagem}`} alt={titulo.nome} className="w-full aspect-[2/3] object-cover" />}
        <button onClick={() => navigate(-1)} className="absolute top-3 left-3 bg-bg/70 rounded-full p-2 text-ink">
          <ChevronLeft size={18} />
        </button>
        <button onClick={favoritar} className="absolute top-3 right-3 bg-bg/70 rounded-full p-2">
          <Heart size={18} fill={userItem?.favorito ? '#ff4b5c' : 'none'} className={userItem?.favorito ? 'text-heart' : 'text-ink'} />
        </button>
      </div>

      <div className="px-4 py-3">
        <h1 className="font-display font-semibold text-xl text-ink">{titulo.nome}</h1>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted font-mono">
          <span>{titulo.genero}</span>
          {titulo.media_rating && (
            <span className="flex items-center gap-1 text-teal">
              <Star size={12} fill="currentColor
