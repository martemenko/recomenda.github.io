import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'

export default function Configuracoes() {
  const navigate = useNavigate()
  const [perfilPrivado, setPerfilPrivado] = useState(false)
  const [csvFile, setCsvFile] = useState(null)
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvLinhas, setCsvLinhas] = useState([])
  const [mapeamento, setMapeamento] = useState({ idSerie: '', temporada: '', episodio: '', assistido: '' })
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

      // Auto-detecção inteligente de colunas
      const guess = { idSerie: -1, temporada: -1, episodio: -1, assistido: -1 }
      headers.forEach((h, i) => {
        const l = h.toLowerCase().trim()
        if (l.includes('id') || l.includes('tvdb') || l.includes('tmdb') || l.includes('series_id')) guess.idSerie = i
        if (l === 'season' || l.includes('temporada')) guess.temporada = i
        if (l === 'episode' || l.includes('episodio') || l.includes('episódio')) guess.episodio = i
        if (l === 'is_watched' || l === 'watched' || l.includes('assistid') || l.includes('status')) guess.assistido = i
      })
      
      setMapeamento({
        idSerie: guess.idSerie >= 0 ? String(guess.idSerie) : '',
        temporada: guess.temporada >= 0 ? String(guess.temporada) : '',
        episodio: guess.episodio >= 0 ? String(guess.episodio) : '',
        assistido: guess.assistido >= 0 ? String(guess.assistido) : '',
      })
    }
    reader.readAsText(file)
  }

  async function importar() {
    if (!mapeamento.idSerie || !mapeamento.temporada || !mapeamento.episodio) {
      alert('Selecione ao menos os campos de ID da Série, Temporada e Episódio.')
      return
    }

    setImportando(true)
    setProgresso('Iniciando importação...')
    setPorcentagemProgresso(0)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não autenticado.')

      const idxTitulo = parseInt(mapeamento.titulo, 10)
      const idxTemp = parseInt(mapeamento.temporada, 10)
      const idxEp = parseInt(mapeamento.episodio, 10)
      const idxAssistido = mapeamento.assistido !== '' ? parseInt(mapeamento.assistido, 10) : -1

      const seriesMap = new Map()

      for (const linha of csvLinhas) {
        const valorIdentificador = linha[idxTitulo]?.trim()
        const temporadaNum = parseInt(linha[idxTemp], 10)
        const episodioNum = parseInt(linha[idxEp], 10)

        if (!valorIdentificador || isNaN(temporadaNum) || isNaN(episodioNum)) continue

        let assistido = true
        if (idxAssistido >= 0) {
          const val = String(linha[idxAssistido] ?? '').toLowerCase().trim()
          assistido = val === 'true' || val === '1' || val === 'yes' || val === 'visto' || val === 'assistido'
        }

        if (!seriesMap.has(valorIdentificador)) {
          seriesMap.set(valorIdentificador, [])
        }
        seriesMap.get(valorIdentificador).push({ temporada: temporadaNum, episodio: episodioNum, assistido })
      }

      let processados = 0
      const totalSeries = seriesMap.size

      for (const [identificador, listaEpisodios] of seriesMap.entries()) {
        processados++
        const pct = Math.round((processados / totalSeries) * 100)
        setPorcentagemProgresso(pct)
        setProgresso(`Processando ${processados}/${totalSeries}: "${identificador}"...`)

        let tmdbIdFinal = null
        let mediaTypeFinal = 'tv'

        const eNumero = !isNaN(Number(identificador))

        // Se não for um valor numérico (ID), pula direto já que não usaremos busca por nome
        if (!eNumero) continue

        const numId = Number(identificador)

        // -------------------------------------------------------------
        // PASSO 1: Tenta validar/usar como TMDB ID direto
        // -------------------------------------------------------------
        const { data: idData } = await supabase.functions.invoke('buscar-titulo', {
          body: { tmdb_id: numId },
        })

        if (idData?.tmdb_id || idData?.id) {
          tmdbIdFinal = numId
        }

        // -------------------------------------------------------------
        // PASSO 2: Se falhou no TMDB, tenta resolver como TVDB ID (/find)
        // -------------------------------------------------------------
        if (!tmdbIdFinal) {
          const { data: findData } = await supabase.functions.invoke('buscar-por-tvdb', {
            body: { tvdb_id: identificador },
          })

          const resultadoFind = findData?.tv_results?.[0] || findData?.movie_results?.[0]
          if (resultadoFind?.id) {
            tmdbIdFinal = Number(resultadoFind.id)
            mediaTypeFinal = findData?.tv_results?.length ? 'tv' : 'movie'
          }
        }

        // Se não encontrou por nenhum dos dois IDs, ignora
        if (!tmdbIdFinal) continue

        // 1. Adiciona/Garante o título no banco local
        const { data: tituloInserido, error: erroAdd } = await supabase.functions.invoke('adicionar-titulo', {
          body: { tmdb_id: tmdbIdFinal, media_type: mediaTypeFinal },
        })
        if (erroAdd) { console.error(`Erro ao adicionar "${identificador}":`, erroAdd); continue }

        // 2. Resgata a chave primária local (ID interno da tabela 'titulo')
        let tituloIdInterno = tituloInserido?.id
        if (!tituloIdInterno) {
          const { data: tBanco } = await supabase
            .from('titulo')
            .select('id')
            .eq('tmdb_id', tmdbIdFinal)
            .single()
          tituloIdInterno = tBanco?.id
        }

        if (!tituloIdInterno) continue

        // 3. Busca os episódios no banco local usando o ID INTERNO (FK)
        const { data: episodiosBanco } = await supabase
          .from('episode')
          .select('id, season_number, episode_number')
          .eq('titulo_id', tituloIdInterno)

        if (!episodiosBanco || episodiosBanco.length === 0) continue

        // 4. Mapeia os episódios a marcar
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
          const payload = idsParaMarcar.map((epId) => ({
            user_id: user.id,
            episode_id: epId,
          }))

          await supabase.from('watched_episode').upsert(payload, { onConflict: 'user_id,episode_id' })
        }

        // 5. Atualiza o status em user_item com a FK interna
        const totalEpisodiosSerie = episodiosBanco.length
        
        const { count: assistidosCount } = await supabase
          .from('watched_episode')
          .select('episode_id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .in('episode_id', episodiosBanco.map(e => e.id))

        if (assistidosCount > 0) {
          const status = assistidosCount >= totalEpisodiosSerie ? 'visto' : 'vendo'
          await supabase.from('user_item').upsert({
            user_id: user.id,
            titulo_id: tituloIdInterno,
            status,
          }, { onConflict: 'user_id,titulo_id' })
        }
      }

      setPorcentagemProgresso(100)
      setProgresso('Importação concluída com sucesso!')
      setTimeout(() => {
        setProgresso('')
        setPorcentagemProgresso(0)
      }, 5000)
    } catch (err) {
      console.error(err)
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
      {/* TopBar não tem prop "onBack" - o botão de voltar precisa ir pelo rightSlot */}
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
        {/* Botão de Sair da Conta */}
        <div>
          <button
            onClick={sairDaConta}
            className="w-full py-3 bg-surface2 hover:bg-white/10 text-ink border border-white/10 font-display font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
          >
            <span>Sair da Conta (Log out)</span>
          </button>
        </div>

        <hr className="border-white/5" />

        {/* Exclusão Definitiva */}
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
