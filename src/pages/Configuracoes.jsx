import { useState } from 'react'
import { supabase, callFunction } from '../lib/supabaseClient'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'

export default function Configuracoes() {
  const [perfilPrivado, setPerfilPrivado] = useState(false)
  const [csvFile, setCsvFile] = useState(null)
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvLinhas, setCsvLinhas] = useState([])
  const [mapeamento, setMapeamento] = useState({ titulo: '', temporada: '', episodio: '', assistido: '' })
  const [importando, setImportando] = useState(false)
  const [progresso, setProgresso] = useState('')
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
          resultado.push(campoAtual.trim().replace(/^"|"$/g, ''))
          campoAtual = ''
        } else {
          campoAtual += char
        }
      }
      resultado.push(campoAtual.trim().replace(/^"|"$/g, ''))
      return resultado
    })
  }

  function selecionarArquivo(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFile(file)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const texto = evt.target?.result ?? ''
      const matriz = parseCSV(texto)
      if (matriz.length < 2) {
        setStatusMsg('Arquivo CSV inválido ou vazio.')
        return
      }
      const headers = matriz[0]
      const linhas = matriz.slice(1)
      setCsvHeaders(headers)
      setCsvLinhas(linhas)

      // Auto-detecção inteligente de colunas (compatível com TV Time, Trakt, IMDB, etc)
      const guess = { titulo: -1, temporada: -1, episodio: -1, assistido: -1 }
      headers.forEach((h, i) => {
        const l = h.toLowerCase().trim()
        if (l === 'title' || l === 'name' || l.includes('titulo') || l.includes('título') || l.includes('series')) guess.titulo = i
        if (l === 'season' || l.includes('temporada')) guess.temporada = i
        if (l === 'episode' || l.includes('episodio') || l.includes('episódio')) guess.episodio = i
        if (l === 'is_watched' || l === 'watched' || l.includes('assistid') || l.includes('status')) guess.assistido = i
      })

      setMapeamento({
        titulo: guess.titulo >= 0 ? String(guess.titulo) : '',
        temporada: guess.temporada >= 0 ? String(guess.temporada) : '',
        episodio: guess.episodio >= 0 ? String(guess.episodio) : '',
        assistido: guess.assistido >= 0 ? String(guess.assistido) : '',
      })
    }
    reader.readAsText(file)
  }

  async function importar() {
    if (!mapeamento.titulo || !mapeamento.temporada || !mapeamento.episodio) {
      alert('Selecione ao menos os campos de Título, Temporada e Episódio.')
      return
    }

    setImportando(true)
    setProgresso('Iniciando importação...')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não autenticado.')

      const idxTitulo = parseInt(mapeamento.titulo, 10)
      const idxTemp = parseInt(mapeamento.temporada, 10)
      const idxEp = parseInt(mapeamento.episodio, 10)
      const idxAssistido = mapeamento.assistido !== '' ? parseInt(mapeamento.assistido, 10) : -1

      // 1. Agrupar episódios por série para otimizar chamadas e evitar inconsistências
      const seriesMap = new Map()

      for (const linha of csvLinhas) {
        const nomeSerie = linha[idxTitulo]
        const temporadaNum = parseInt(linha[idxTemp], 10)
        const episodioNum = parseInt(linha[idxEp], 10)

        if (!nomeSerie || isNaN(temporadaNum) || isNaN(episodioNum)) continue

        let assistido = true
        if (idxAssistido >= 0) {
          const val = String(linha[idxAssistido] ?? '').toLowerCase().trim()
          assistido = val === 'true' || val === '1' || val === 'yes' || val === 'visto' || val === 'assistido'
        }

        if (!seriesMap.has(nomeSerie)) {
          seriesMap.set(nomeSerie, [])
        }
        seriesMap.get(nomeSerie).push({ temporada: temporadaNum, episodio: episodioNum, assistido })
      }

      let processados = 0
      const totalSeries = seriesMap.size

      // 2. Processar série por série
      for (const [nomeSerie, listaEpisodios] of seriesMap.entries()) {
        processados++
        setProgresso(`Processando ${processados}/${totalSeries}: "${nomeSerie}"...`)

        // Buscar título no TMDB via Edge Function
        const { data: buscaData } = await supabase.functions.invoke('buscar-titulo', {
          body: { query: nomeSerie },
        })

        const melhor = buscaData?.resultados?.[0] || buscaData?.[0]
        if (!melhor || !melhor.tmdb_id) continue

        const tmdbIdNum = Number(melhor.tmdb_id)

        // Assegurar que a série e seus episódios existam na base local
        await supabase.functions.invoke('adicionar-titulo', {
          body: { tmdb_id: tmdbIdNum, tipo: melhor.tipo || 'tv' },
        })

        // Buscar os episódios cadastrados no banco local (garantindo tipo Number)
        const { data: episodiosBanco } = await supabase
          .from('episode')
          .select('id, season_number, episode_number')
          .eq('titulo_id', tmdbIdNum)

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

        // Registrar episódios assistidos em lote
        if (idsParaMarcar.length > 0) {
          const payload = idsParaMarcar.map((epId) => ({
            user_id: user.id,
            episode_id: epId,
          }))

          await supabase.from('watched_episode').upsert(payload, { onConflict: 'user_id,episode_id' })
        }

        // Atualizar status no user_item sem corromper para 'quero_ver' se nada foi associado
        const totalEpisodiosSerie = episodiosBanco.length
        
        // Buscar total real de episódios assistidos desta série pelo usuário no banco
        const { count: assistidosCount } = await supabase
          .from('watched_episode')
          .select('episode_id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .in('episode_id', episodiosBanco.map(e => e.id))

        if (assistidosCount > 0) {
          const status = assistidosCount >= totalEpisodiosSerie ? 'visto' : 'vendo'
          await supabase.from('user_item').upsert({
            user_id: user.id,
            titulo_id: tmdbIdNum,
            status,
          }, { onConflict: 'user_id,titulo_id' })
        }
      }

      setProgresso('Importação concluída com sucesso!')
      setTimeout(() => setProgresso(''), 4000)
    } catch (err) {
      console.error(err)
      setProgresso(`Erro na importação: ${err.message}`)
    } finally {
      setImportando(false)
    }
  }

  return (
    <div className="flex-1 pb-10">
      <TopBar title="Configurações" />

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

      <SectionLabel>Importar Dados (CSV)</SectionLabel>
      <div className="mx-4 p-4 bg-surface rounded-2xl border border-white/5 space-y-4">
        <input
          type="file"
          accept=".csv"
          onChange={selecionarArquivo}
          className="block w-full text-xs text-muted file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-display file:bg-surface2 file:text-amber hover:file:bg-amber/20"
        />

        {csvHeaders.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="text-xs font-display font-semibold text-amber">Mapeamento de Colunas</div>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-muted block mb-1">Título</label>
                <select
                  value={mapeamento.titulo}
                  onChange={(e) => setMapeamento({ ...mapeamento, titulo: e.target.value })}
                  className="w-full bg-surface2 border border-white/10 rounded-xl p-2 text-ink"
                >
                  <option value="">Selecione...</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-muted block mb-1">Temporada</label>
                <select
                  value={mapeamento.temporada}
                  onChange={(e) => setMapeamento({ ...mapeamento, temporada: e.target.value })}
                  className="w-full bg-surface2 border border-white/10 rounded-xl p-2 text-ink"
                >
                  <option value="">Selecione...</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-muted block mb-1">Episódio</label>
                <select
                  value={mapeamento.episodio}
                  onChange={(e) => setMapeamento({ ...mapeamento, episodio: e.target.value })}
                  className="w-full bg-surface2 border border-white/10 rounded-xl p-2 text-ink"
                >
                  <option value="">Selecione...</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-muted block mb-1">Status/Assistido (Op)</label>
                <select
                  value={mapeamento.assistido}
                  onChange={(e) => setMapeamento({ ...mapeamento, assistido: e.target.value })}
                  className="w-full bg-surface2 border border-white/10 rounded-xl p-2 text-ink"
                >
                  <option value="">Todos Assistidos</option>
                  {csvHeaders.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={importar}
              disabled={importando}
              className="w-full py-3 bg-amber text-bg font-display font-semibold rounded-xl text-sm transition-opacity disabled:opacity-50 mt-2"
            >
              {importando ? 'Importando...' : 'Iniciar Importação'}
            </button>
          </div>
        )}

        {progresso && (
          <div className="text-xs text-amber font-mono bg-surface2 p-2.5 rounded-xl border border-amber/20">
            {progresso}
          </div>
        )}
      </div>
    </div>
  )
}
