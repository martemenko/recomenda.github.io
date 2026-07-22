import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
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

export default function Configuracoes() {
  const navigate = useNavigate()
  const [perfilPrivado, setPerfilPrivado] = useState(false)
  const [zipFile, setZipFile] = useState(null)
  const [importando, setImportando] = useState(false)
  const [progresso, setProgresso] = useState('')
  const [porcentagemProgresso, setPorcentagemProgresso] = useState(0)
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

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
      
      // Filtrar arquivos ignorando pastas do macOS ou arquivos de metadados
      const files = Object.keys(zip.files).filter(name => 
        !name.includes('__MACOSX') && 
        !name.split('/').pop().startsWith('._')
      )

      console.log('[Importador] Arquivos válidos encontrados no ZIP:', files)

      // 1. Procurar e processar o arquivo de séries para mapear nome da série por tvdb_id
      const seriesFileKey = files.find(name => 
        name.includes('tvtime-series-') && !name.includes('tvtime-series-episodes')
      )
      
      const seriesNamesMap = new Map()
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
                if (tvdbId && title) {
                  seriesNamesMap.set(String(tvdbId).trim(), String(title).trim())
                }
                
                // Se o JSON de séries já contiver o aninhamento de temporadas e episódios
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
            
            if (idIdx >= 0 && titleIdx >= 0) {
              for (let i = 1; i < seriesRows.length; i++) {
                const row = seriesRows[i]
                const tvdbIdVal = row[idIdx]?.replace(/^["']|["']$/g, '').trim()
                const titleVal = row[titleIdx]?.replace(/^["']|["']$/g, '').trim()
                if (tvdbIdVal && titleVal) {
                  seriesNamesMap.set(tvdbIdVal, titleVal)
                }
              }
            }
          }
        }
      }

      console.log(`[Importador] Mapeamento de nomes de séries carregado: ${seriesNamesMap.size} títulos.`)

      // 2. Procurar e processar o arquivo de episódios de séries
      const episodesFileKey = files.find(name => name.includes('tvtime-series-episodes'))

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
          const isWatchedIdx = headers.findIndex(h => h === 'is_watched' || h.includes('watched'))

          if (sIdIdx < 0 || seasonIdx < 0 || episodeIdx < 0) {
            throw new Error('As colunas obrigatórias do TV Time (series_tvdb_id, season, episode) não foram identificadas no CSV.')
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

      // 3. Procurar e processar o arquivo de filmes (tvtime-movies-)
      const moviesFileKey = files.find(name => name.includes('tvtime-movies-'))
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
                const title = m.title || m.name
                if (tvdbId) {
                  moviesList.push({
                    tvdbId: String(tvdbId).trim(),
                    nome: String(title || `Filme (ID: ${tvdbId})`).trim()
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
            const idIdx = headers.findIndex(h => h === 'tvdb_id' || h.includes('tvdb'))
            const titleIdx = headers.findIndex(h => h === 'title' || h === 'name' || h.includes('titulo') || h.includes('título'))
            const isWatchedIdx = headers.findIndex(h => h === 'is_watched' || h.includes('watched'))

            if (idIdx >= 0 && titleIdx >= 0) {
              for (let i = 1; i < movieRows.length; i++) {
                const row = movieRows[i]
                
                let isWatched = true
                if (isWatchedIdx >= 0) {
                  const val = String(row[isWatchedIdx] ?? '').toLowerCase().trim()
                  isWatched = val === 'true' || val === '1' || val === 'yes'
                }
                if (!isWatched) continue

                const tvdbIdVal = row[idIdx]?.replace(/^["']|["']$/g, '').trim()
                const titleVal = row[titleIdx]?.replace(/^["']|["']$/g, '').trim()
                if (tvdbIdVal) {
                  moviesList.push({
                    tvdbId: tvdbIdVal,
                    nome: titleVal || `Filme (ID: ${tvdbIdVal})`
                  })
                }
              }
            }
          }
        }
      }

      const totalSeries = seriesMap.size
      const totalFilmes = moviesList.length
      const totalGeral = totalSeries + totalFilmes

      if (totalGeral === 0) {
        throw new Error('Nenhum episódio ou filme marcado como assistido foi identificado nos arquivos do ZIP.')
      }

      let processados = 0

      // --- Loop 1: Processamento de Séries ---
      for (const [tvdbId, grupo] of seriesMap.entries()) {
        const { nomeSerie, episodios: listaEpisodios } = grupo
        processados++
        setPorcentagemProgresso(Math.round((processados / totalGeral) * 100))
        setProgresso(`Processando ${processados}/${totalGeral}: "${nomeSerie}" (Série)...`)

        console.log(`[Importador] Processando "${nomeSerie}" (TVDB: ${tvdbId}) com ${listaEpisodios.length} episódios.`);

        let tmdbIdNum = null

        // 1. Tenta buscar o ID de/para usando o endpoint correto 'tvdb-search'
        try {
          const { data: tvdbData, error: erroTvdb } = await supabase.functions.invoke('tvdb-search', {
            body: { tvdb_id: tvdbId },
          })

          if (erroTvdb) {
            console.error(`[Importador] Erro na função 'tvdb-search' para "${nomeSerie}" (TVDB: ${tvdbId}):`, erroTvdb)
          } else if (tvdbData?.resultado?.tmdb_id) {
            tmdbIdNum = Number(tvdbData.resultado.tmdb_id)
            console.log(`[Importador] ID TVDB ${tvdbId} resolvido com sucesso para TMDB: ${tmdbIdNum}`)
          }
        } catch (e) {
          console.error(`[Importador] Erro de rede/CORS na rota de ID para "${nomeSerie}":`, e)
        }

        // 2. Fallback por Nome se a função de de/para falhou (por CORS ou ID não mapeado)
        if (!tmdbIdNum && nomeSerie && !nomeSerie.startsWith('Série (ID:')) {
          try {
            console.log(`[Importador] Recuperação: Buscando por nome no TMDB para "${nomeSerie}"...`)
            const { data: buscaData, error: erroBusca } = await supabase.functions.invoke('buscar-titulo', {
              body: { query: nomeSerie },
            })

            if (erroBusca) {
              console.error(`[Importador] Erro ao buscar por nome "${nomeSerie}":`, erroBusca)
            } else {
              const melhor = buscaData?.results?.[0]
              if (melhor?.tmdb_id) {
                tmdbIdNum = Number(melhor.tmdb_id)
                console.log(`[Importador] Recuperado com sucesso via nome para "${nomeSerie}". TMDB ID: ${tmdbIdNum}`)
              } else {
                console.warn(`[Importador] Nenhum resultado no TMDB para a pesquisa por nome: "${nomeSerie}"`)
              }
            }
          } catch (e) {
            console.error(`[Importador] Exceção no fallback para "${nomeSerie}":`, e)
          }
        }

        if (!tmdbIdNum) {
          console.warn(`[Importador] TMDB ID não encontrado para a série "${nomeSerie}" (TVDB: ${tvdbId}). Pulando série.`)
          continue
        }

        console.log(`[Importador] Resolvido para TMDB ID: ${tmdbIdNum}. Chamando 'adicionar-titulo'...`);

        const { error: erroAdd } = await supabase.functions.invoke('adicionar-titulo', {
          body: { tmdb_id: tmdbIdNum, media_type: 'tv' },
        })
        if (erroAdd) { 
          console.error(`[Importador] Erro ao adicionar o título "${nomeSerie}" (TMDB: ${tmdbIdNum}):`, erroAdd)
          continue 
        }

        const { data: episodiosBanco, error: erroEps } = await supabase
          .from('episode')
          .select('id, season_number, episode_number')
          .eq('titulo_id', tmdbIdNum)

        if (erroEps) {
          console.error(`[Importador] Erro ao carregar episódios de "${nomeSerie}" do banco:`, erroEps)
        }

        if (!episodiosBanco || episodiosBanco.length === 0) {
          console.warn(`[Importador] Nenhum episódio da série "${nomeSerie}" foi retornado pelo banco após a ingestão.`)
          continue
        }

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

        console.log(`[Importador] "${nomeSerie}": Encontrados ${idsParaMarcar.length} de ${listaEpisodios.length} episódios correspondentes no banco.`);

        if (idsParaMarcar.length > 0) {
          const payload = idsParaMarcar.map((epId) => ({
            user_id: user.id,
            episode_id: epId,
          }))

          const { error: erroUpsertWatched } = await supabase
            .from('watched_episode')
            .upsert(payload, { onConflict: 'user_id,episode_id' })

          if (erroUpsertWatched) {
            console.error(`[Importador] Erro ao registrar episódios assistidos de "${nomeSerie}":`, erroUpsertWatched)
          }
        }

        const totalEpisodiosSerie = episodiosBanco.length
        
        const { count: assistidosCount, error: erroCount } = await supabase
          .from('watched_episode')
          .select('episode_id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .in('episode_id', episodiosBanco.map(e => e.id))

        if (erroCount) {
          console.error(`[Importador] Erro ao contar episódios vistos de "${nomeSerie}":`, erroCount)
        }

        if (assistidosCount && assistidosCount > 0) {
          const status = assistidosCount >= totalEpisodiosSerie ? 'visto' : 'vendo'
          
          const { error: erroUpsertUserItem } = await supabase.from('user_item').upsert({
            user_id: user.id,
            titulo_id: tmdbIdNum,
            status,
          }, { onConflict: 'user_id,titulo_id' })

          if (erroUpsertUserItem) {
            console.error(`[Importador] Erro ao atualizar status de "${nomeSerie}" em user_item:`, erroUpsertUserItem)
          }
        }
      }

      // --- Loop 2: Processamento de Filmes ---
      for (const movie of moviesList) {
        const { tvdbId, nome: nomeFilme } = movie
        processados++
        setPorcentagemProgresso(Math.round((processados / totalGeral) * 100))
        setProgresso(`Processando ${processados}/${totalGeral}: "${nomeFilme}" (Filme)...`)

        console.log(`[Importador] Processando filme "${nomeFilme}" (TVDB: ${tvdbId}).`);

        let tmdbIdNum = null

        // 1. Resolve o ID usando 'tvdb-search'
        try {
          const { data: tvdbData, error: erroTvdb } = await supabase.functions.invoke('tvdb-search', {
            body: { tvdb_id: tvdbId },
          })

          if (erroTvdb) {
            console.error(`[Importador] Erro na função 'tvdb-search' para o filme "${nomeFilme}" (TVDB: ${tvdbId}):`, erroTvdb)
          } else if (tvdbData?.resultado?.tmdb_id) {
            tmdbIdNum = Number(tvdbData.resultado.tmdb_id)
            console.log(`[Importador] Filme TVDB ID ${tvdbId} resolvido com sucesso para TMDB: ${tmdbIdNum}`)
          }
        } catch (e) {
          console.error(`[Importador] Erro de rede/CORS na rota de ID para o filme "${nomeFilme}":`, e)
        }

        // 2. Fallback de alta disponibilidade por nome para filme
        if (!tmdbIdNum && nomeFilme && !nomeFilme.startsWith('Filme (ID:')) {
          try {
            console.log(`[Importador] Recuperação: Buscando por nome no TMDB para o filme "${nomeFilme}"...`)
            const { data: buscaData, error: erroBusca } = await supabase.functions.invoke('buscar-titulo', {
              body: { query: nomeFilme },
            })

            if (erroBusca) {
              console.error(`[Importador] Erro ao buscar por nome "${nomeFilme}":`, erroBusca)
            } else {
              const melhor = buscaData?.results?.find(r => r.media_type === 'movie') || buscaData?.results?.[0]
              if (melhor?.tmdb_id) {
                tmdbIdNum = Number(melhor.tmdb_id)
                console.log(`[Importador] Recuperado com sucesso via nome para o filme "${nomeFilme}". TMDB ID: ${tmdbIdNum}`)
              } else {
                console.warn(`[Importador] Nenhum resultado no TMDB para a pesquisa de filme por nome: "${nomeFilme}"`)
              }
            }
          } catch (e) {
            console.error(`[Importador] Exceção no fallback de filme para "${nomeFilme}":`, e)
          }
        }

        if (!tmdbIdNum) {
          console.warn(`[Importador] TMDB ID não encontrado para o filme "${nomeFilme}" (TVDB: ${tvdbId}). Pulando filme.`)
          continue
        }

        console.log(`[Importador] Resolvido para TMDB ID: ${tmdbIdNum}. Chamando 'adicionar-titulo' para filme...`);

        const { error: erroAdd } = await supabase.functions.invoke('adicionar-titulo', {
          body: { tmdb_id: tmdbIdNum, media_type: 'movie' },
        })
        if (erroAdd) { 
          console.error(`[Importador] Erro ao adicionar o filme "${nomeFilme}" (TMDB: ${tmdbIdNum}):`, erroAdd)
          continue 
        }

        // Para filmes, atualiza diretamente como "visto" na tabela 'user_item'
        console.log(`[Importador] Atualizando status de visualização do filme "${nomeFilme}" para "visto"...`);
        const { error: erroUpsertUserItem } = await supabase.from('user_item').upsert({
          user_id: user.id,
          titulo_id: tmdbIdNum,
          status: 'visto',
        }, { onConflict: 'user_id,titulo_id' })

        if (erroUpsertUserItem) {
          console.error(`[Importador] Erro ao atualizar status de "${nomeFilme}" em user_item:`, erroUpsertUserItem)
        }
      }

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
          <div className="text-xs text-muted">Apenas você poderá ver seu histórico</div>
        </div>
        <input
          type="checkbox"
          checked={perfilPrivado}
          onChange={(e) => setPerfilPrivado(e.target.checked)}
          className="w-5 h-5 accent-amber rounded"
        />
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
