import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase, callFunction } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'

export default function Configuracoes() {
  const { user, perfil, recarregarPerfil, sair } = useAuth()
  const navigate = useNavigate()
  
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState('')
  const [importLog, setImportLog] = useState('')
  const [porcentagemProgresso, setPorcentagemProgresso] = useState(0)
  const [importando, setImportando] = useState(false)
  const [csvRows, setCsvRows] = useState(null)
  const [csvHeaders, setCsvHeaders] = useState([])
  const [mapeamento, setMapeamento] = useState({})

  async function alternarPrivacidade() {
    await supabase.from('usuarios').update({ perfil_privado: !perfil.perfil_privado }).eq('id', user.id)
    recarregarPerfil()
  }

  async function exportarHistorico() {
    const { data: epsBrutos, error } = await supabase
      .from('watched_episode')
      .select('watched_at, episode(episode_name, season_number, episode_number, titulo_id)')
      .eq('user_id', user.id)
    if (error) console.error('Erro ao exportar histórico:', error)

    const idsExport = [...new Set((epsBrutos ?? []).map((e) => e.episode?.titulo_id).filter(Boolean))]
    const { data: titulosExport } = idsExport.length
      ? await supabase.from('titulo').select('id, nome').in('id', idsExport)
      : { data: [] }
    const mapaExport = new Map((titulosExport ?? []).map((t) => [t.id, t.nome]))

    const linhas = [['titulo', 'temporada', 'episodio', 'nome_episodio', 'assistido_em']]
    for (const e of epsBrutos ?? []) {
      linhas.push([mapaExport.get(e.episode.titulo_id), e.episode.season_number, e.episode.episode_number, e.episode.episode_name, e.watched_at])
    }
    const csv = linhas.map((l) => l.map((v) => `"${v ?? ''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'meu_historico.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

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
    const arquivo = e.target.files?.[0]
    if (!arquivo) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const linhas = parseCSV(ev.target.result)
      if (linhas.length < 2) {
        setImportLog('Arquivo CSV inválido ou vazio.')
        return
      }
      const headers = linhas[0]
      setCsvHeaders(headers)
      setCsvRows(linhas.slice(1))
      
      const guess = {}
      headers.forEach((h, i) => {
        const l = h.toLowerCase().trim()
        if (l.includes('titulo') || l.includes('título') || l.includes('title') || l.includes('name')) guess.titulo = i
        if (l.includes('temporada') || l.includes('season')) guess.temporada = i
        if (l.includes('episodio') || l.includes('episódio') || l.includes('episode')) guess.episodio = i
        if ((l.includes('watched') || l.includes('assistid') || l.includes('status')) && !l.includes('_at') && !l.includes('date')) guess.assistido = i
      })
      setMapeamento(guess)
    }
    reader.readAsText(arquivo)
  }

  async function importar() {
    if (mapeamento.titulo === undefined) return setImportLog('Selecione qual coluna é o título.')
    
    setImportando(true)
    setPorcentagemProgresso(0)
    
    const grupos = new Map()
    for (const linha of csvRows) {
      const titulo = linha[mapeamento.titulo]?.trim()
      if (!titulo) continue
      if (!grupos.has(titulo)) grupos.set(titulo, [])
      grupos.get(titulo).push(linha)
    }

    let importados = 0
    let processados = 0
    const totalGrupos = grupos.size
    const naoEncontrados = []
    const semEpisodioMarcado = []

    for (const [titulo, linhas] of grupos) {
      processados++
      const pct = Math.round((processados / totalGrupos) * 100)
      setPorcentagemProgresso(pct)
      setImportLog(`Processando ${processados}/${totalGrupos}: "${titulo}"...`)

      try {
        const { results } = await callFunction('buscar-titulo', { query: titulo })
        const melhor = results?.[0]
        if (!melhor) { naoEncontrados.push(titulo); continue }

        await callFunction('adicionar-titulo', { tmdb_id: melhor.tmdb_id, media_type: melhor.media_type })

        if (melhor.media_type === 'tv' && mapeamento.temporada !== undefined && mapeamento.episodio !== undefined) {
          const { data: episodios } = await supabase
            .from('episode')
            .select('id, season_number, episode_number')
            .eq('titulo_id', melhor.tmdb_id)

          let marcados = 0
          for (const linha of linhas) {
            const s = parseInt(linha[mapeamento.temporada], 10)
            const ep = parseInt(linha[mapeamento.episodio], 10)
            const match = episodios?.find((e) => e.season_number === s && e.episode_number === ep)
            if (!match) continue

            const valorAssistido = mapeamento.assistido !== undefined ? linha[mapeamento.assistido]?.trim().toLowerCase() : null
            const assistido = valorAssistido === null || ['true', '1', 'sim', 'yes', 'visto', 'assistido'].includes(valorAssistido)

            if (assistido) {
              const { error } = await supabase.from('watched_episode').upsert({ user_id: user.id, episode_id: match.id })
              if (!error) marcados++
            } else {
              await supabase.from('watched_episode').delete().eq('user_id', user.id).eq('episode_id', match.id)
            }
          }

          if (marcados === 0 && linhas.length > 0) {
            semEpisodioMarcado.push(titulo)
          }

          const { data: assistidosFinal } = await supabase
            .from('watched_episode')
            .select('episode_id')
            .eq('user_id', user.id)
            .in('episode_id', (episodios ?? []).map((e) => e.id))

          const total = episodios?.length ?? 0
          const totalAssistidos = assistidosFinal?.length ?? 0
          const status = totalAssistidos === 0 ? 'quero_ver' : totalAssistidos >= total ? 'visto' : 'vendo'
          await supabase.from('user_item').update({ status }).eq('user_id', user.id).eq('titulo_id', melhor.tmdb_id)
        } else {
          const valorAssistido = mapeamento.assistido !== undefined ? linhas[0][mapeamento.assistido]?.trim().toLowerCase() : null
          const status = valorAssistido === null || ['true', '1', 'sim', 'yes', 'visto'].includes(valorAssistido) ? 'visto' : 'quero_ver'
          await supabase.from('user_item').update({ status }).eq('user_id', user.id).eq('titulo_id', melhor.tmdb_id)
        }
        importados++
      } catch {
        naoEncontrados.push(titulo)
      }
    }

    setPorcentagemProgresso(100)
    setImportando(false)
    setImportLog(
      `Importação concluída: ${importados}/${grupos.size} títulos.` +
      (naoEncontrados.length ? ` Não encontrados: ${naoEncontrados.join(', ')}.` : '')
    )
  }

  async function sairDaConta() {
    try {
      await sair()
      navigate('/login')
    } catch (err) {
      console.error('Erro ao sair:', err)
    }
  }

  async function excluirConta() {
    try {
      await callFunction('excluir-conta', {})
      await sair()
      navigate('/login')
    } catch (err) {
      console.error('Erro ao excluir conta:', err)
    }
  }

  return (
    <>
      {/* Botão ArrowLeft recriado dentro do slot correspondente da TopBar */}
      <TopBar
        title="Configurações"
        leftSlot={
          <button 
            onClick={() => navigate(-1)} 
            className="p-1.5 -ml-1.5 rounded-xl text-muted hover:text-ink hover:bg-white/5 transition-colors"
            title="Voltar"
          >
            <ArrowLeft size={20} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto scroll-area pb-10">
        <SectionLabel>Privacidade</SectionLabel>
        <label className="flex items-center justify-between px-4 py-2 cursor-pointer">
          <span className="text-sm text-ink">Perfil privado</span>
          <input 
            type="checkbox" 
            checked={!!perfil?.perfil_privado} 
            onChange={alternarPrivacidade} 
            className="accent-amber w-5 h-5 rounded cursor-pointer" 
          />
        </label>

        <SectionLabel>Histórico</SectionLabel>
        <div className="px-4 flex flex-col gap-3">
          <button onClick={exportarHistorico} className="bg-surface border border-white/10 rounded-2xl py-3 text-sm text-ink hover:bg-white/5 transition-colors">
            Exportar histórico (.csv)
          </button>

          <input type="file" accept=".csv" onChange={selecionarArquivo} className="text-xs text-muted file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-surface2 file:text-amber file:text-xs" />

          {csvHeaders.length > 0 && (
            <div className="flex flex-col gap-2 bg-surface border border-white/10 rounded-2xl p-3.5">
              {['titulo', 'temporada', 'episodio', 'assistido'].map((campo) => (
                <div key={campo} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted uppercase font-mono">{campo}</span>
                  <select
                    value={mapeamento[campo] ?? ''}
                    onChange={(e) => setMapeamento({ ...mapeamento, [campo]: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className="bg-surface2 text-xs text-ink rounded-full px-3 py-1.5 border border-white/5"
                  >
                    <option value="">Ignorar</option>
                    {csvHeaders.map((h, i) => (
                      <option key={i} value={i}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
              <button 
                onClick={importar} 
                disabled={importando}
                className="bg-amber text-bg rounded-2xl py-2.5 text-sm font-display font-semibold mt-1 shadow-[0_0_14px_rgba(243,194,85,0.3)] disabled:opacity-50"
              >
                {importando ? 'Importando...' : 'Importar'}
              </button>
            </div>
          )}

          {importLog && (
            <div className="space-y-1.5 bg-surface2 p-3 rounded-xl border border-amber/20">
              <div className="text-xs text-amber font-mono flex justify-between items-center">
                <span className="truncate pr-2">{importLog}</span>
                {importando && <span className="font-bold">{porcentagemProgresso}%</span>}
              </div>
              {importando && (
                <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                  <div
                    className="h-full bg-amber transition-all duration-300 ease-out shadow-[0_0_8px_#f3c255]"
                    style={{ width: `${porcentagemProgresso}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <SectionLabel>Conta</SectionLabel>
        <div className="px-4 flex flex-col gap-3">
          <button 
            onClick={sairDaConta} 
            className="w-full py-3 bg-surface border border-white/10 text-ink font-display font-semibold rounded-2xl text-sm transition-colors hover:bg-white/5"
          >
            Sair da Conta (Log out)
          </button>

          <div className="border-t border-white/5 pt-2 flex flex-col gap-2">
            <p className="text-xs text-muted">
              Excluir sua conta apaga permanentemente seu login e todos os seus dados. Digite EXCLUIR pra confirmar.
            </p>
            <input
              value={confirmacaoExclusao}
              onChange={(e) => setConfirmacaoExclusao(e.target.value)}
              className="bg-surface border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-ink placeholder:text-muted/40"
              placeholder="EXCLUIR"
            />
            <button
              onClick={excluirConta}
              disabled={confirmacaoExclusao !== 'EXCLUIR'}
              className="bg-danger text-white rounded-2xl py-3 text-sm font-display font-semibold disabled:opacity-40 transition-opacity"
            >
              Excluir minha conta
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
