import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { invalidateCache } from '../lib/dataCache'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'

// Função auxiliar para carregar o JSZip dinamicamente via CDN e evitar erros de build
function carregarJSZip() {
  return new Promise((resolve, reject) => {
    if (window.JSZip) {
      resolve(window.JSZip)
      return
    }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    script.async = true
    script.onload = () => {
      if (window.JSZip) {
        resolve(window.JSZip)
      } else {
        reject(new Error('Não foi possível inicializar o JSZip.'))
      }
    }
    script.onerror = () => reject(new Error('Erro ao carregar a biblioteca JSZip.'))
    document.head.appendChild(script)
  })
}

// Acha a coluna de "assistido" (true/false) sem confundir com "watched_at"
// (timestamp) - o TV Time exporta as duas no mesmo CSV e "watched_at" aparece
// antes de "is_watched" na ordem das colunas, então um includes('watched')
// ingênuo pega a coluna errada e acaba marcando tudo como não assistido.
function acharIndiceAssistido(headers) {
  const exato = headers.findIndex((h) => h === 'is_watched' || h === 'iswatched' || h === 'watched')
  if (exato >= 0) return exato
  return headers.findIndex((h) => h.includes('watched') && !h.endsWith('_at') && !h.includes('date'))
}

// O TV Time exporta os mesmos dados em CSV e JSON dentro do mesmo ZIP. A ordem
// em que o JSZip lista os arquivos não é garantida, então um find() ingênuo
// pode pegar o .json em vez do .csv (ou vice-versa) dependendo do zip. Os dois
// formatos nem sempre têm os mesmos nomes de campo (ex: "status" no CSV pode
// não existir com esse nome no JSON), então padronizamos: sempre que houver
// as duas versões do mesmo arquivo, prioriza o .csv.
function acharArquivoPreferindoCsv(files, incluiTodos, excluiAlgum) {
  const candidatos = files.filter((name) =>
    incluiTodos.every((termo) => name.includes(termo)) &&
    (!excluiAlgum || !excluiAlgum.some((termo) => name.includes(termo)))
  )
  return candidatos.find((name) => name.toLowerCase().endsWith('.csv')) || candidatos[0]
}

// Resolve o tmdb_id de um título a partir do que o TV Time exportou (tvdb_id
// e/ou imdb_id, já que filmes não vêm com tmdb_id direto), com fallback pra
// busca por nome quando a busca por ID externo não acha nada.
async function resolverTmdbId({ tmdbId, tvdbId, imdbId, nomeInicial, mediaType, prefixoIdDesconhecido }) {
  let tmdbIdNum = tmdbId ? Number(tmdbId) : null
  let nomeExibicao = nomeInicial

  if (!tmdbIdNum && (tvdbId || imdbId)) {
    try {
      const { data: tvdbData, error: erroTvdb } = await supabase.functions.invoke('tvdb-search', {
        body: { tvdb_id: tvdbId, imdb_id: imdbId, media_type: mediaType },
      })

      if (erroTvdb) {
        console.error(`[Importador] Erro na função 'tvdb-search' para "${nomeExibicao}" (TVDB: ${tvdbId}, IMDB: ${imdbId}):`, erroTvdb)
      } else if (tvdbData?.resultado?.tmdb_id) {
        tmdbIdNum = Number(tvdbData.resultado.tmdb_id)
        if (tvdbData.resultado.nome) nomeExibicao = tvdbData.resultado.nome
      }
    } catch (e) {
      console.error(`[Importador] Erro de rede/CORS na rota de ID para "${nomeExibicao}":`, e)
    }
  }

  if (!tmdbIdNum && nomeExibicao && !nomeExibicao.startsWith(prefixoIdDesconhecido)) {
    try {
      const { data: buscaData, error: erroBusca } = await supabase.functions.invoke('buscar-titulo', {
        body: { query: nomeExibicao },
      })

      if (erroBusca) {
        console.error(`[Importador] Erro ao buscar por nome "${nomeExibicao}":`, erroBusca)
      } else {
        const melhor = mediaType === 'movie'
          ? (buscaData?.results?.find((r) => r.media_type === 'movie') || buscaData?.results?.[0])
          : buscaData?.results?.[0]
        if (melhor?.tmdb_id) tmdbIdNum = Number(melhor.tmdb_id)
      }
    } catch (e) {
      console.error(`[Importador] Exceção no fallback para "${nomeExibicao}":`, e)
    }
  }

  return { tmdbIdNum, nomeExibicao }
}

// Toggles de privacidade por seção — cada um mapeia direto pra uma coluna
// booleana em usuarios (ver migração 20260828010000_onboarding_e_privacidade.sql).
const SECOES_PRIVACIDADE = [
  { campo: 'privado_estatisticas', titulo: 'Estatísticas', descricao: 'Tempo assistido, episódios, filmes e jogos' },
  { campo: 'privado_historico', titulo: 'Histórico', descricao: 'O que você marcou como visto/jogado' },
  { campo: 'privado_favoritos', titulo: 'Favoritos', descricao: 'Seus títulos favoritados' },
  { campo: 'privado_listas', titulo: 'Listas', descricao: 'Suas listas personalizadas' },
]

const CAMPOS_DADOS_PESSOAIS = [
  { campo: 'compartilhar_nome', titulo: 'Nome', descricao: 'Mostrar seu nome no seu perfil público' },
  { campo: 'compartilhar_idade', titulo: 'Idade', descricao: 'Mostrar sua idade no seu perfil público' },
]

export default function Configuracoes() {
  const navigate = useNavigate()
  const { user, perfil, recarregarPerfil } = useAuth()
  const [perfilPrivado, setPerfilPrivado] = useState(false)
  const [privacidadeSecoes, setPrivacidadeSecoes] = useState({
    privado_estatisticas: false,
    privado_historico: false,
    privado_favoritos: false,
    privado_listas: false,
    compartilhar_nome: false,
    compartilhar_idade: false,
  })
  const [nomeEditavel, setNomeEditavel] = useState('')
  const [idadeEditavel, setIdadeEditavel] = useState('')
  const [salvandoDadosPessoais, setSalvandoDadosPessoais] = useState(false)
  const [dadosPessoaisMsg, setDadosPessoaisMsg] = useState('')
  const [zipFile, setZipFile] = useState(null)
  const [importando, setImportando] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [porcentagemProgresso, setPorcentagemProgresso] = useState(0)
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  // `perfil` (AuthProvider, select('*') em usuarios) carrega de forma
  // assíncrona -- sincroniza os toggles locais assim que os dados chegarem.
  useEffect(() => {
    if (!perfil) return
    setPerfilPrivado(!!perfil.perfil_privado)
    setPrivacidadeSecoes({
      privado_estatisticas: !!perfil.privado_estatisticas,
      privado_historico: !!perfil.privado_historico,
      privado_favoritos: !!perfil.privado_favoritos,
      privado_listas: !!perfil.privado_listas,
      compartilhar_nome: !!perfil.compartilhar_nome,
      compartilhar_idade: !!perfil.compartilhar_idade,
    })
    setNomeEditavel(perfil.nome ?? '')
    setIdadeEditavel(perfil.user_age != null ? String(perfil.user_age) : '')
  }, [perfil])

  // nome/user_age só eram preenchidos pelo fluxo de onboarding -- contas
  // criadas antes dele (backfilled com onboarding_completo=true, ver
  // migração 20260828010000_onboarding_e_privacidade.sql) nunca passam por
  // ali, e mesmo quem passou pode querer editar depois. Esse é o único outro
  // lugar que escreve esses dois campos.
  async function salvarDadosPessoais() {
    setDadosPessoaisMsg('')
    const idadeNum = idadeEditavel === '' ? null : Number(idadeEditavel)
    if (idadeEditavel !== '' && (!Number.isInteger(idadeNum) || idadeNum < 13 || idadeNum > 120)) {
      setDadosPessoaisMsg('Informa uma idade válida.')
      return
    }

    setSalvandoDadosPessoais(true)
    const { error } = await supabase
      .from('usuarios')
      .update({ nome: nomeEditavel.trim() || null, user_age: idadeNum })
      .eq('id', user.id)
    setSalvandoDadosPessoais(false)

    if (error) {
      console.error('[Configuracoes] Erro ao salvar dados pessoais:', error)
      setDadosPessoaisMsg('Não deu pra salvar, tenta de novo.')
      return
    }

    setDadosPessoaisMsg('Salvo!')
    recarregarPerfil()
    setTimeout(() => setDadosPessoaisMsg(''), 2500)
  }

  async function atualizarPrivacidade(campo, valor) {
    const anterior = campo === 'perfil_privado' ? perfilPrivado : privacidadeSecoes[campo]

    if (campo === 'perfil_privado') setPerfilPrivado(valor)
    else setPrivacidadeSecoes((prev) => ({ ...prev, [campo]: valor }))

    const { error } = await supabase.from('usuarios').update({ [campo]: valor }).eq('id', user.id)

    if (error) {
      console.error(`[Configuracoes] Erro ao salvar ${campo}:`, error)
      if (campo === 'perfil_privado') setPerfilPrivado(anterior)
      else setPrivacidadeSecoes((prev) => ({ ...prev, [campo]: anterior }))
      return
    }

    recarregarPerfil()
  }

  // Parser robusto de CSV para lidar com aspas e vírgulas em campos ISO/strings
  function parseCSV(texto) {
    const linhasBrutas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0)
    return linhasBrutas.map((linha) => {
      const resultado = []
      let dentroDeAspas = false
      let campoAtual = ''
      for (let i = 0; i < linha.length; i++) {
        const char = linha[i]
        if (char === '"') {
          dentroDeAspas = !dentroDeAspas
        } else if (char === ',' && !dentroDeAspas) {
          resultado.push(campoAtual.trim().replace(/^["']|["']$/g, ''))
          campoAtual = ''
        } else {
          campoAtual += char
        }
      }
      resultado.push(campoAtual.trim().replace(/^["']|["']$/g, ''))
      return resultado
    })
  }

  function selecionarArquivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setZipFile(file)
    setStatusMsg('')
  }

  async function importar() {
    if (!zipFile) {
      alert('Selecione o arquivo .zip exportado do TV Time.')
      return
    }

    setImportando(true)
    setProgresso('Iniciando importação...')
    setPorcentagemProgresso(0)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não autenticado.')

      setProgresso('Carregando biblioteca de descompactação...')
      const JSZip = await carregarJSZip()

      setProgresso('Descompactando arquivo ZIP...')
      const zip = await JSZip.loadAsync(zipFile)
      
      const files = Object.keys(zip.files).filter(name => 
        !name.includes('__MACOSX') && 
        !name.split('/').pop().startsWith('._')
      )

      console.log('[Importador] Arquivos válidos encontrados no ZIP:', files)

      // 1. Processar o arquivo de séries para mapear nome por tvdb_id
      const seriesFileKey = acharArquivoPreferindoCsv(files, ['tvtime-series-'], ['tvtime-series-episodes'])

      console.log('[Importador] Arquivo de séries escolhido:', seriesFileKey)
      
      const seriesNamesMap = new Map()
      const seriesStatusMap = new Map() // Armazena o status original (continuing, stopped, up_to_date)
      const seriesMap = new Map()

      if (seriesFileKey) {
        const seriesContent = (await zip.files[seriesFileKey].async('string')).replace(/^\uFEFF/, '')
        const isJson = seriesFileKey.endsWith('.json') || seriesContent.trim().startsWith('[') || seriesContent.trim().startsWith('{')
        
        if (isJson) {
          try {
            const seriesList = JSON.parse(seriesContent)
            if (Array.isArray(seriesList)) {
              for (const s of seriesList) {
                const tvdbId = s.tvdb_id || s.tvdbId
                const title = s.title || s.name
                const statusVal = s.status || s.status_name

                if (tvdbId) {
                  const tvdbIdStr = String(tvdbId).trim()
                  if (title) seriesNamesMap.set(tvdbIdStr, String(title).trim())
                  if (statusVal) seriesStatusMap.set(tvdbIdStr, String(statusVal).trim().toLowerCase())
                }
                
                if (Array.isArray(s.seasons)) {
                  for (const season of s.seasons) {
                    const sNum = parseInt(season.season, 10)
                    if (isNaN(sNum) || !Array.isArray(season.episodes)) continue
                    for (const ep of season.episodes) {
                      const isWatchedVal = ep.is_watched !== undefined ? ep.is_watched : ep.isWatched
                      const isWatched = isWatchedVal === true || isWatchedVal === 1 || String(isWatchedVal).toLowerCase() === 'true'
                      if (!isWatched) continue

                      const epNum = parseInt(ep.episode, 10)
                      if (isNaN(epNum)) continue

                      const tvdbIdStr = String(tvdbId).trim()
                      const nomeSerie = String(title || `Série (ID: ${tvdbIdStr})`).trim()

                      if (!seriesMap.has(tvdbIdStr)) {
                        seriesMap.set(tvdbIdStr, { tvdbId: tvdbIdStr, nomeSerie, episodios: [] })
                      }
                      seriesMap.get(tvdbIdStr).episodios.push({ temporada: sNum, episodio: epNum, assistido: true })
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.error('[Importador] Erro ao processar JSON de séries:', e)
          }
        } else {
          const seriesRows = parseCSV(seriesContent)
          if (seriesRows.length > 1) {
            const headers = seriesRows[0].map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/^["']|["']$/g, ''))
            const idIdx = headers.findIndex(h => h === 'tvdb_id' || h.includes('tvdb'))
            const titleIdx = headers.findIndex(h => h === 'title' || h === 'name' || h.includes('titulo') || h.includes('título'))
            const statusIdx = headers.findIndex(h => h === 'status')
            
            if (idIdx >= 0) {
              for (let i = 1; i < seriesRows.length; i++) {
                const row = seriesRows[i]
                const tvdbIdVal = row[idIdx]?.replace(/^["']|["']$/g, '').trim()
                
                if (tvdbIdVal) {
                  if (titleIdx >= 0 && row[titleIdx]) {
                    const titleVal = row[titleIdx]?.replace(/^["']|["']$/g, '').trim()
                    seriesNamesMap.set(tvdbIdVal, titleVal)
                  }
                  if (statusIdx >= 0 && row[statusIdx]) {
                    const statusVal = row[statusIdx]?.replace(/^["']|["']$/g, '').trim().toLowerCase()
                    seriesStatusMap.set(tvdbIdVal, statusVal)
                  }
                }
              }
            }
          }
        }
      }

      console.log(`[Importador] Mapeamento de nomes de séries carregado: ${seriesNamesMap.size} títulos.`)
      console.log(`[Importador] Mapeamento de status de séries carregado: ${seriesStatusMap.size} entradas.`, [...seriesStatusMap.entries()].slice(0, 10))

      // 2. Processar o arquivo de episódios de séries
      const episodesFileKey = acharArquivoPreferindoCsv(files, ['tvtime-series-episodes'])

      if (episodesFileKey) {
        setProgresso('Lendo arquivo de episódios...')
        const epContent = (await zip.files[episodesFileKey].async('string')).replace(/^\uFEFF/, '')
        const isEpJson = episodesFileKey.endsWith('.json') || epContent.trim().startsWith('[') || epContent.trim().startsWith('{')

        if (isEpJson) {
          try {
            const epList = JSON.parse(epContent)
            if (Array.isArray(epList)) {
              for (const ep of epList) {
                const isWatchedVal = ep.is_watched !== undefined ? ep.is_watched : ep.isWatched
                const isWatched = isWatchedVal === true || isWatchedVal === 1 || String(isWatchedVal).toLowerCase() === 'true'
                if (!isWatched) continue

                const tvdbId = ep.series_tvdb_id || ep.seriesTvdbId
                const temporadaNum = parseInt(ep.season, 10)
                const episodioNum = parseInt(ep.episode, 10)

                if (!tvdbId || isNaN(temporadaNum) || isNaN(episodioNum)) continue

                const sTvdbIdStr = String(tvdbId).trim()
                const nomeSerie = seriesNamesMap.get(sTvdbIdStr) || `Série (ID: ${sTvdbIdStr})`

                if (!seriesMap.has(sTvdbIdStr)) {
                  seriesMap.set(sTvdbIdStr, { tvdbId: sTvdbIdStr, nomeSerie, episodios: [] })
                }
                seriesMap.get(sTvdbIdStr).episodios.push({ temporada: temporadaNum, episodio: episodioNum, assistido: true })
              }
            }
          } catch (e) {
            throw new Error('Erro ao processar JSON de episódios: ' + e.message)
          }
        } else {
          const epRows = parseCSV(epContent)
          if (epRows.length < 2) {
            throw new Error('O arquivo CSV de episódios está vazio ou inválido.')
          }

          const headers = epRows[0].map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/^["']|["']$/g, ''))
          const sIdIdx = headers.findIndex(h => h === 'series_tvdb_id' || h.includes('series_tvdb'))
          const seasonIdx = headers.findIndex(h => h === 'season' || h.includes('season'))
          const episodeIdx = headers.findIndex(h => h === 'episode' || h.includes('episode'))
          const isWatchedIdx = acharIndiceAssistido(headers)

          if (sIdIdx < 0 || seasonIdx < 0 || episodeIdx < 0) {
            throw new Error('As colunas obrigatórias do TV Time não foram identificadas no CSV.')
          }

          for (let i = 1; i < epRows.length; i++) {
            const row = epRows[i]
            
            let isWatched = true
            if (isWatchedIdx >= 0) {
              const val = String(row[isWatchedIdx] ?? '').toLowerCase().trim()
              isWatched = val === 'true' || val === '1' || val === 'yes'
            }
            if (!isWatched) continue

            const tvdbId = row[sIdIdx]?.replace(/^["']|["']$/g, '').trim()
            const temporadaNum = parseInt(row[seasonIdx], 10)
            const episodioNum = parseInt(row[episodeIdx], 10)

            if (!tvdbId || isNaN(temporadaNum) || isNaN(episodioNum)) continue

            const nomeSerie = seriesNamesMap.get(tvdbId) || `Série (ID: ${tvdbId})`

            if (!seriesMap.has(tvdbId)) {
              seriesMap.set(tvdbId, { tvdbId, nomeSerie, episodios: [] })
            }
            seriesMap.get(tvdbId).episodios.push({ temporada: temporadaNum, episodio: episodioNum, assistido: true })
          }
        }
      }

      // 3. Processar o arquivo de filmes (tvtime-movies-)
      const moviesFileKey = acharArquivoPreferindoCsv(files, ['tvtime-movies-'])
      const moviesList = []

      if (moviesFileKey) {
        setProgresso('Lendo arquivo de filmes...')
        const moviesContent = (await zip.files[moviesFileKey].async('string')).replace(/^\uFEFF/, '')
        const isMoviesJson = moviesFileKey.endsWith('.json') || moviesContent.trim().startsWith('[') || moviesContent.trim().startsWith('{')

        if (isMoviesJson) {
          try {
            const parsedMovies = JSON.parse(moviesContent)
            if (Array.isArray(parsedMovies)) {
              for (const m of parsedMovies) {
                const isWatchedVal = m.is_watched !== undefined ? m.is_watched : m.isWatched
                const isWatched = isWatchedVal === true || isWatchedVal === 1 || String(isWatchedVal).toLowerCase() === 'true'
                if (!isWatched) continue

                const tvdbId = m.tvdb_id || m.tvdbId
                const imdbId = m.imdb_id || m.imdbId
                const tmdbId = m.tmdb_id || m.tmdbId
                const title = m.title || m.name
                if (tvdbId || imdbId || tmdbId) {
                  moviesList.push({
                    tvdbId: tvdbId ? String(tvdbId).trim() : null,
                    imdbId: imdbId ? String(imdbId).trim() : null,
                    tmdbId: tmdbId ? String(tmdbId).trim() : null,
                    nome: String(title || `Filme (ID: ${tvdbId || imdbId || tmdbId})`).trim()
                  })
                }
              }
            }
          } catch (e) {
            console.error('[Importador] Erro ao processar JSON de filmes:', e)
          }
        } else {
          const movieRows = parseCSV(moviesContent)
          if (movieRows.length > 1) {
            const headers = movieRows[0].map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/^["']|["']$/g, ''))
            const tvdbIdIdx = headers.findIndex(h => h === 'tvdb_id' || h.includes('tvdb'))
            const imdbIdIdx = headers.findIndex(h => h === 'imdb_id' || h.includes('imdb'))
            const tmdbIdIdx = headers.findIndex(h => h === 'tmdb_id' || h.includes('tmdb'))
            const titleIdx = headers.findIndex(h => h === 'title' || h === 'name' || h.includes('titulo') || h.includes('título'))
            const isWatchedIdx = acharIndiceAssistido(headers)

            if ((tvdbIdIdx >= 0 || imdbIdIdx >= 0 || tmdbIdIdx >= 0) && titleIdx >= 0) {
              for (let i = 1; i < movieRows.length; i++) {
                const row = movieRows[i]

                let isWatched = true
                if (isWatchedIdx >= 0) {
                  const val = String(row[isWatchedIdx] ?? '').toLowerCase().trim()
                  isWatched = val === 'true' || val === '1' || val === 'yes'
                }
                if (!isWatched) continue

                const tvdbIdVal = tvdbIdIdx >= 0 ? row[tvdbIdIdx]?.replace(/^["']|["']$/g, '').trim() : null
                const imdbIdVal = imdbIdIdx >= 0 ? row[imdbIdIdx]?.replace(/^["']|["']$/g, '').trim() : null
                const tmdbIdVal = tmdbIdIdx >= 0 ? row[tmdbIdIdx]?.replace(/^["']|["']$/g, '').trim() : null
                const titleVal = row[titleIdx]?.replace(/^["']|["']$/g, '').trim()
                if (tvdbIdVal || imdbIdVal || tmdbIdVal) {
                  moviesList.push({
                    tvdbId: tvdbIdVal || null,
                    imdbId: imdbIdVal || null,
                    tmdbId: tmdbIdVal || null,
                    nome: titleVal || `Filme (ID: ${tvdbIdVal || imdbIdVal || tmdbIdVal})`
                  })
                }
              }
            }
          }
        }
      }

      // 4. Processar o arquivo de listas customizadas (tvtime-lists-)
      const listsFileKey = acharArquivoPreferindoCsv(files, ['tvtime-lists-'])
      const listasMap = new Map() // list_id -> { nome, itens: [{tvdbId, imdbId, tmdbId, nome, mediaType}] }

      // TV Time não documenta os valores exatos de item_type - assume que qualquer
      // coisa que mencione "movie/filme/film" é filme, e o resto é série.
      function tipoMidiaItemLista(itemType) {
        const v = String(itemType ?? '').trim().toLowerCase()
        return v.includes('movie') || v.includes('filme') || v.includes('film') ? 'movie' : 'tv'
      }

      if (listsFileKey) {
        setProgresso('Lendo arquivo de listas...')
        const listsContent = (await zip.files[listsFileKey].async('string')).replace(/^﻿/, '')
        const isListsJson = listsFileKey.endsWith('.json') || listsContent.trim().startsWith('[') || listsContent.trim().startsWith('{')

        if (isListsJson) {
          try {
            const parsedLists = JSON.parse(listsContent)
            if (Array.isArray(parsedLists)) {
              for (const l of parsedLists) {
                const listId = l.list_id || l.listId
                const listName = l.list_name || l.listName
                const tvdbId = l.tvdb_id || l.tvdbId
                const imdbId = l.imdb_id || l.imdbId
                const tmdbId = l.tmdb_id || l.tmdbId
                const nome = l.name || l.title
                if (!listId || !listName || (!tvdbId && !imdbId && !tmdbId)) continue

                const listIdStr = String(listId).trim()
                if (!listasMap.has(listIdStr)) {
                  listasMap.set(listIdStr, { nome: String(listName).trim(), itens: [] })
                }
                listasMap.get(listIdStr).itens.push({
                  tvdbId: tvdbId ? String(tvdbId).trim() : null,
                  imdbId: imdbId ? String(imdbId).trim() : null,
                  tmdbId: tmdbId ? String(tmdbId).trim() : null,
                  nome: String(nome || `Título (ID: ${tvdbId || imdbId || tmdbId})`).trim(),
                  mediaType: tipoMidiaItemLista(l.item_type || l.itemType),
                })
              }
            }
          } catch (e) {
            console.error('[Importador] Erro ao processar JSON de listas:', e)
          }
        } else {
          const listRows = parseCSV(listsContent)
          if (listRows.length > 1) {
            const headers = listRows[0].map(h => h.replace(/^﻿/, '').trim().toLowerCase().replace(/^["']|["']$/g, ''))
            const listIdIdx = headers.findIndex(h => h === 'list_id')
            const listNameIdx = headers.findIndex(h => h === 'list_name')
            const itemTypeIdx = headers.findIndex(h => h === 'item_type')
            const tvdbIdIdx = headers.findIndex(h => h === 'tvdb_id' || h.includes('tvdb'))
            const imdbIdIdx = headers.findIndex(h => h === 'imdb_id' || h.includes('imdb'))
            const tmdbIdIdx = headers.findIndex(h => h === 'tmdb_id' || h.includes('tmdb'))
            const nameIdx = headers.findIndex(h => h === 'name' || h === 'title')

            if (listIdIdx >= 0 && listNameIdx >= 0 && (tvdbIdIdx >= 0 || imdbIdIdx >= 0 || tmdbIdIdx >= 0)) {
              for (let i = 1; i < listRows.length; i++) {
                const row = listRows[i]
                const listIdVal = row[listIdIdx]?.replace(/^["']|["']$/g, '').trim()
                const listNameVal = row[listNameIdx]?.replace(/^["']|["']$/g, '').trim()
                const tvdbIdVal = tvdbIdIdx >= 0 ? row[tvdbIdIdx]?.replace(/^["']|["']$/g, '').trim() : null
                const imdbIdVal = imdbIdIdx >= 0 ? row[imdbIdIdx]?.replace(/^["']|["']$/g, '').trim() : null
                const tmdbIdVal = tmdbIdIdx >= 0 ? row[tmdbIdIdx]?.replace(/^["']|["']$/g, '').trim() : null
                const nomeVal = nameIdx >= 0 ? row[nameIdx]?.replace(/^["']|["']$/g, '').trim() : null

                if (!listIdVal || !listNameVal || (!tvdbIdVal && !imdbIdVal && !tmdbIdVal)) continue

                if (!listasMap.has(listIdVal)) {
                  listasMap.set(listIdVal, { nome: listNameVal, itens: [] })
                }
                listasMap.get(listIdVal).itens.push({
                  tvdbId: tvdbIdVal || null,
                  imdbId: imdbIdVal || null,
                  tmdbId: tmdbIdVal || null,
                  nome: nomeVal || `Título (ID: ${tvdbIdVal || imdbIdVal || tmdbIdVal})`,
                  mediaType: tipoMidiaItemLista(row[itemTypeIdx]),
                })
              }
            }
          }
        }
      }

      const totalSeries = seriesMap.size
      const totalFilmes = moviesList.length
      const totalItensListas = [...listasMap.values()].reduce((soma, l) => soma + l.itens.length, 0)
      const totalGeral = totalSeries + totalFilmes + totalItensListas

      if (totalGeral === 0) {
        throw new Error('Nenhum episódio, filme ou item de lista foi identificado nos arquivos do ZIP.')
      }

      let processados = 0

      // --- Loop 1: Processamento de Séries ---
      for (const [tvdbId, grupo] of seriesMap.entries()) {
        const { nomeSerie, episodios: listaEpisodios } = grupo
        processados++
        setPorcentagemProgresso(Math.round((processados / totalGeral) * 100))
        
        let nomeExibicao = nomeSerie;
        setProgresso(`Processando ${processados}/${totalGeral}: "${nomeExibicao}" (Série)...`)

        let tmdbIdNum = null

        try {
          const { data: tvdbData, error: erroTvdb } = await supabase.functions.invoke('tvdb-search', {
            body: { tvdb_id: tvdbId },
          })

          if (erroTvdb) {
            console.error(`[Importador] Erro na função 'tvdb-search' para "${nomeExibicao}" (TVDB: ${tvdbId}):`, erroTvdb)
          } else if (tvdbData?.resultado?.tmdb_id) {
            tmdbIdNum = Number(tvdbData.resultado.tmdb_id)
            if (tvdbData.resultado.nome) {
              nomeExibicao = tvdbData.resultado.nome;
              setProgresso(`Processando ${processados}/${totalGeral}: "${nomeExibicao}" (Série)...`)
            }
          }
        } catch (e) {
          console.error(`[Importador] Erro de rede/CORS na rota de ID para "${nomeExibicao}":`, e)
        }

        if (!tmdbIdNum && nomeExibicao && !nomeExibicao.startsWith('Série (ID:')) {
          try {
            console.log(`[Importador] Recuperação: Buscando por nome no TMDB para "${nomeExibicao}"...`)
            const { data: buscaData, error: erroBusca } = await supabase.functions.invoke('buscar-titulo', {
              body: { query: nomeExibicao },
            })

            if (erroBusca) {
              console.error(`[Importador] Erro ao buscar por nome "${nomeExibicao}":`, erroBusca)
            } else {
              const melhor = buscaData?.results?.[0]
              if (melhor?.tmdb_id) {
                tmdbIdNum = Number(melhor.tmdb_id)
              }
            }
          } catch (e) {
            console.error(`[Importador] Exceção no fallback para "${nomeExibicao}":`, e)
          }
        }

        if (!tmdbIdNum) {
          console.warn(`[Importador] TMDB ID não encontrado para a série "${nomeExibicao}" (TVDB: ${tvdbId}). Pulando série.`)
          continue
        }

        const { error: erroAdd } = await supabase.functions.invoke('adicionar-titulo', {
          body: { tmdb_id: tmdbIdNum, media_type: 'tv' },
        })
        if (erroAdd) { 
          console.error(`[Importador] Erro ao adicionar o título "${nomeExibicao}" (TMDB: ${tmdbIdNum}):`, erroAdd)
          continue 
        }

        const { data: episodiosBanco, error: erroEps } = await supabase
          .from('episode')
          .select('id, season_number, episode_number')
          .eq('titulo_id', tmdbIdNum)

        if (erroEps) console.error(`[Importador] Erro ao carregar episódios de "${nomeExibicao}":`, erroEps)
        if (!episodiosBanco || episodiosBanco.length === 0) continue

        const idsParaMarcar = []
        for (const epCsv of listaEpisodios) {
          if (!epCsv.assistido) continue
          const match = episodiosBanco.find(
            (e) => Number(e.season_number) === epCsv.temporada && Number(e.episode_number) === epCsv.episodio
          )
          if (match) {
            idsParaMarcar.push(match.id)
          }
        }

        if (idsParaMarcar.length > 0) {
          // Filtragem local pré-insert para evitar erros de restrição/CORS no Postgres
          const { data: epsExistentes } = await supabase
            .from('watched_episode')
            .select('episode_id')
            .eq('user_id', user.id)
            .in('episode_id', idsParaMarcar)

          const idsExistentes = new Set((epsExistentes ?? []).map(e => e.episode_id))
          const novosIdsParaMarcar = idsParaMarcar.filter(id => !idsExistentes.has(id))

          if (novosIdsParaMarcar.length > 0) {
            const payload = novosIdsParaMarcar.map((epId) => ({
              user_id: user.id,
              episode_id: epId,
            }))

            const { error: erroInsertWatched } = await supabase
              .from('watched_episode')
              .insert(payload)

            if (erroInsertWatched) {
              console.error(`[Importador] Erro ao registrar episódios assistidos de "${nomeExibicao}":`, erroInsertWatched)
            }
          }
        }

        const totalEpisodiosSerie = episodiosBanco.length
        const { count: assistidosCount, error: erroCount } = await supabase
          .from('watched_episode')
          .select('episode_id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .in('episode_id', episodiosBanco.map(e => e.id))

        if (erroCount) console.error(`[Importador] Erro ao contar episódios de "${nomeExibicao}":`, erroCount)

        console.log(`[Importador] "${nomeExibicao}" tvdbId=${tvdbId} status TV Time encontrado=${seriesStatusMap.get(tvdbId) ?? '(nenhum)'}`)

        if (assistidosCount && assistidosCount > 0) {
          let status = 'vendo'
          const tvtimeStatus = seriesStatusMap.get(tvdbId) || 'continuing'

          if (assistidosCount >= totalEpisodiosSerie) {
            status = 'visto'
          } else if (tvtimeStatus === 'stopped') {
            status = 'interrompida' // Série marcada como "stopped" no TV Time some da lista de "assistir a seguir"
          }
          
          const { error: erroUpsertUserItem } = await supabase.from('user_item').upsert({
            user_id: user.id,
            titulo_id: tmdbIdNum,
            status,
            favorito: false,
          })

          if (erroUpsertUserItem) {
            console.error(`[Importador] Erro ao atualizar status de "${nomeExibicao}" em user_item:`, erroUpsertUserItem)
          }
        }
      }

      // --- Loop 2: Processamento de Filmes ---
      for (const movie of moviesList) {
        const { tmdbId, tvdbId, imdbId, nome: nomeFilme } = movie
        processados++
        setPorcentagemProgresso(Math.round((processados / totalGeral) * 100))
        setProgresso(`Processando ${processados}/${totalGeral}: "${nomeFilme}" (Filme)...`)

        const { tmdbIdNum, nomeExibicao } = await resolverTmdbId({
          tmdbId,
          tvdbId,
          imdbId,
          nomeInicial: nomeFilme,
          mediaType: 'movie',
          prefixoIdDesconhecido: 'Filme (ID:',
        })

        if (!tmdbIdNum) {
          console.warn(`[Importador] TMDB ID não encontrado para o filme "${nomeExibicao}" (TVDB: ${tvdbId}, IMDB: ${imdbId}). Pulando filme.`)
          continue
        }

        const { error: erroAdd } = await supabase.functions.invoke('adicionar-titulo', {
          body: { tmdb_id: tmdbIdNum, media_type: 'movie' },
        })
        if (erroAdd) {
          console.error(`[Importador] Erro ao adicionar o filme "${nomeExibicao}" (TMDB: ${tmdbIdNum}):`, erroAdd)
          continue
        }

        const { error: erroUpsertUserItem } = await supabase.from('user_item').upsert({
          user_id: user.id,
          titulo_id: tmdbIdNum,
          status: 'visto',
          favorito: false,
        })

        if (erroUpsertUserItem) {
          console.error(`[Importador] Erro ao atualizar status de "${nomeExibicao}" em user_item:`, erroUpsertUserItem)
        }
      }

      // --- Loop 3: Processamento de Listas customizadas ---
      for (const [, lista] of listasMap.entries()) {
        const { nome: nomeLista, itens } = lista

        const { data: listaExistente, error: erroBuscaLista } = await supabase
          .from('lista')
          .select('id')
          .eq('user_id', user.id)
          .eq('nome', nomeLista)
          .maybeSingle()
        if (erroBuscaLista) console.error(`[Importador] Erro ao buscar lista "${nomeLista}":`, erroBuscaLista)

        let listaId = listaExistente?.id ?? null
        if (!listaId) {
          const { data: listaCriada, error: erroCriarLista } = await supabase
            .from('lista')
            .insert({ user_id: user.id, nome: nomeLista })
            .select('id')
            .single()
          if (erroCriarLista) {
            console.error(`[Importador] Erro ao criar lista "${nomeLista}":`, erroCriarLista)
            processados += itens.length
            continue
          }
          listaId = listaCriada.id
        }

        for (const item of itens) {
          processados++
          setPorcentagemProgresso(Math.round((processados / totalGeral) * 100))
          setProgresso(`Processando ${processados}/${totalGeral}: "${item.nome}" (Lista "${nomeLista}")...`)

          const { tmdbIdNum, nomeExibicao } = await resolverTmdbId({
            tmdbId: item.tmdbId,
            tvdbId: item.tvdbId,
            imdbId: item.imdbId,
            nomeInicial: item.nome,
            mediaType: item.mediaType,
            prefixoIdDesconhecido: 'Título (ID:',
          })

          if (!tmdbIdNum) {
            console.warn(`[Importador] TMDB ID não encontrado para "${nomeExibicao}" da lista "${nomeLista}". Pulando item.`)
            continue
          }

          // Garante que o título exista no catálogo sem tocar no status de
          // assistido do usuário - fazer parte de uma lista customizada não
          // significa "vendo"/"visto"/"quero ver".
          const { data: tituloExistente } = await supabase.from('titulo').select('id').eq('id', tmdbIdNum).maybeSingle()
          if (!tituloExistente) {
            const { error: erroAdd } = await supabase.functions.invoke('adicionar-titulo', {
              body: { tmdb_id: tmdbIdNum, media_type: item.mediaType, status: 'quero_ver' },
            })
            if (erroAdd) {
              console.error(`[Importador] Erro ao adicionar título "${nomeExibicao}" (TMDB: ${tmdbIdNum}) da lista "${nomeLista}":`, erroAdd)
              continue
            }
          }

          const { data: itemExistente } = await supabase
            .from('lista_item')
            .select('titulo_id')
            .eq('lista_id', listaId)
            .eq('titulo_id', tmdbIdNum)
            .maybeSingle()

          if (!itemExistente) {
            const { error: erroInsertItem } = await supabase
              .from('lista_item')
              .insert({ lista_id: listaId, titulo_id: tmdbIdNum })
            if (erroInsertItem) {
              console.error(`[Importador] Erro ao adicionar "${nomeExibicao}" à lista "${nomeLista}":`, erroInsertItem)
            }
          }
        }
      }

      invalidateCache(['series', 'perfil', 'filmes', 'jogos'])
      setPorcentagemProgresso(100)
      setProgresso('Importação concluída com sucesso!')
      setTimeout(() => {
        setProgresso('')
        setPorcentagemProgresso(0)
      }, 5000)
    } catch (err) {
      console.error('[Importador] Falha no fluxo:', err)
      setProgresso(`Erro na importação: ${err.message}`)
    } finally {
      setImportando(false)
    }
  }

  async function sairDaConta() {
    try {
      await supabase.auth.signOut()
      navigate('/login')
    } catch (err) {
      alert(`Erro ao sair: ${err.message}`)
    }
  }

  async function excluirConta() {
    if (confirmacaoExclusao !== 'EXCLUIR') {
      alert('Digite EXCLUIR para confirmar.')
      return
    }
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      await supabase.from('watched_episode').delete().eq('user_id', user.id)
      await supabase.from('user_item').delete().eq('user_id', user.id)
      await supabase.auth.signOut()
      window.location.reload()
    } catch (err) {
      alert(`Erro ao excluir conta: ${err.message}`)
    }
  }

  return (
    <div className="flex-1 pb-10">
      <TopBar
        title="Configurações"
        rightSlot={
          <button onClick={() => navigate('/perfil')} className="text-muted">
            <ArrowLeft size={20} />
          </button>
        }
      />
      <SectionLabel>Privacidade</SectionLabel>
      <div className="mx-4 p-4 bg-surface rounded-2xl border border-white/5 flex items-center justify-between">
        <div>
          <div className="font-display font-medium text-sm text-ink">Perfil Privado</div>
          <div className="text-xs text-muted">Ninguém além de você poderá ver seu perfil</div>
        </div>
        <input
          type="checkbox"
          checked={perfilPrivado}
          onChange={(e) => atualizarPrivacidade('perfil_privado', e.target.checked)}
          className="w-5 h-5 accent-amber rounded"
        />
      </div>

      {!perfilPrivado && (
        <div className="mx-4 mt-3 bg-surface rounded-2xl border border-white/5 divide-y divide-white/5">
          {SECOES_PRIVACIDADE.map(({ campo, titulo, descricao }) => (
            <label key={campo} className="p-4 flex items-center justify-between cursor-pointer">
              <div>
                <div className="font-display font-medium text-sm text-ink">Ocultar {titulo}</div>
                <div className="text-xs text-muted">{descricao}</div>
              </div>
              <input
                type="checkbox"
                checked={privacidadeSecoes[campo]}
                onChange={(e) => atualizarPrivacidade(campo, e.target.checked)}
                className="w-5 h-5 accent-amber rounded"
              />
            </label>
          ))}
        </div>
      )}

      <SectionLabel>Dados Pessoais</SectionLabel>
      <div className="mx-4 bg-surface rounded-2xl border border-white/5 divide-y divide-white/5">
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs text-muted font-mono">Nome</label>
            <input
              type="text"
              placeholder="Nome (opcional)"
              value={nomeEditavel}
              onChange={(e) => setNomeEditavel(e.target.value)}
              className="mt-1 w-full bg-surface2 border border-white/10 rounded-xl px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </div>
          <div>
            <label className="text-xs text-muted font-mono">Idade</label>
            <input
              type="number"
              placeholder="Idade"
              value={idadeEditavel}
              onChange={(e) => setIdadeEditavel(e.target.value)}
              min={13}
              max={120}
              className="mt-1 w-full bg-surface2 border border-white/10 rounded-xl px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </div>
          {dadosPessoaisMsg && <div className="text-xs font-mono text-amber">{dadosPessoaisMsg}</div>}
          <button
            onClick={salvarDadosPessoais}
            disabled={salvandoDadosPessoais}
            className="px-4 py-2 bg-amber text-bg rounded-xl text-xs font-display font-semibold disabled:opacity-60"
          >
            {salvandoDadosPessoais ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
        <div className="p-4 text-xs text-muted">
          Escolha o que aparece no seu perfil público — o resto fica só com você.
        </div>
        {CAMPOS_DADOS_PESSOAIS.map(({ campo, titulo, descricao }) => (
          <label key={campo} className="p-4 flex items-center justify-between cursor-pointer">
            <div>
              <div className="font-display font-medium text-sm text-ink">Compartilhar {titulo}</div>
              <div className="text-xs text-muted">{descricao}</div>
            </div>
            <input
              type="checkbox"
              checked={privacidadeSecoes[campo]}
              onChange={(e) => atualizarPrivacidade(campo, e.target.checked)}
              className="w-5 h-5 accent-amber rounded"
            />
          </label>
        ))}
      </div>

      <SectionLabel>Importar Dados (TV Time ZIP)</SectionLabel>
      <div className="mx-4 p-4 bg-surface rounded-2xl border border-white/5 space-y-4">
        <input
          type="file"
          accept=".zip"
          onChange={selecionarArquivo}
          className="block w-full text-xs text-muted file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-display file:bg-surface2 file:text-amber hover:file:bg-amber/20"
        />

        {zipFile && (
          <button
            onClick={importar}
            disabled={importando}
            className="w-full py-3 bg-amber text-bg font-display font-semibold rounded-xl text-sm transition-opacity disabled:opacity-50 mt-2"
          >
            {importando ? 'Importando...' : 'Iniciar Importação'}
          </button>
        )}

        {progresso && (
          <div className="space-y-2 bg-surface2 p-3 rounded-xl border border-amber/20">
            <div className="text-xs text-amber font-mono flex justify-between items-center">
              <span className="truncate pr-2">{progresso}</span>
              <span className="font-bold">{porcentagemProgresso}%</span>
            </div>
            <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-amber transition-all duration-300 ease-out shadow-[0_0_8px_#f3c255]"
                style={{ width: `${porcentagemProgresso}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <SectionLabel>Sessão e Conta</SectionLabel>
      <div className="mx-4 p-4 bg-surface rounded-2xl border border-white/5 space-y-4">
        <div>
          <button
            onClick={sairDaConta}
            className="w-full py-3 bg-surface2 hover:bg-white/10 text-ink border border-white/10 font-display font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
          >
            <span>Sair da Conta (Log out)</span>
          </button>
        </div>

        <hr className="border-white/5" />

        <div className="space-y-3 pt-1">
          <div className="text-xs text-muted">
            Para excluir permanentemente sua conta e todos os dados armazenados, digite <strong className="text-red-400">EXCLUIR</strong> abaixo:
          </div>
          <input
            type="text"
            value={confirmacaoExclusao}
            onChange={(e) => setConfirmacaoExclusao(e.target.value)}
            placeholder="Digite EXCLUIR"
            className="w-full bg-surface2 border border-white/10 rounded-xl p-2.5 text-xs text-ink placeholder:text-muted/50"
          />
          <button
            onClick={excluirConta}
            disabled={confirmacaoExclusao !== 'EXCLUIR'}
            className="w-full py-2.5 bg-red-500/10 text-red-400 border border-red-500/30 font-display font-semibold rounded-xl text-xs transition-colors hover:bg-red-500/20 disabled:opacity-30 disabled:hover:bg-red-500/10"
          >
            Excluir Conta Definitivamente
          </button>
        </div>
      </div>
    </div>
  )
}
