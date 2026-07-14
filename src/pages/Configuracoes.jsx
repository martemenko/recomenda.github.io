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
  const [csvRows, setCsvRows] = useState(null)
  const [csvHeaders, setCsvHeaders] = useState([])
  const [mapeamento, setMapeamento] = useState({})

  async function alternarPrivacidade() {
    await supabase.from('usuarios').update({ perfil_privado: !perfil.perfil_privado }).eq('id', user.id)
    recarregarPerfil()
  }

  async function exportarHistorico() {
    const { data: eps } = await supabase
      .from('watched_episode')
      .select('watched_at, episode(episode_name, season_number, episode_number, titulo(nome))')
      .eq('user_id', user.id)

    const linhas = [['titulo', 'temporada', 'episodio', 'nome_episodio', 'assistido_em']]
    for (const e of eps ?? []) {
      linhas.push([e.episode.titulo.nome, e.episode.season_number, e.episode.episode_number, e.episode.episode_name, e.watched_at])
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
    const linhas = texto.split(/\r?\n/).filter(Boolean).map((l) => l.split(',').map((c) => c.replace(/^"|"$/g, '').trim()))
    return linhas
  }

  function selecionarArquivo(e) {
    const arquivo = e.target.files[0]
    if (!arquivo) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const linhas = parseCSV(ev.target.result)
      const headers = linhas[0]
      setCsvHeaders(headers)
      setCsvRows(linhas.slice(1))
      const guess = {}
      headers.forEach((h, i) => {
        const l = h.toLowerCase()
        if (l.includes('titulo') || l.includes('título') || l.includes('name')) guess.titulo = i
        if (l.includes('temporada') || l.includes('season')) guess.temporada = i
        if (l.includes('episodio') || l.includes('episódio') || l.includes('episode')) guess.episodio = i
      })
      setMapeamento(guess)
    }
    reader.readAsText(arquivo)
  }

  async function importar() {
    if (mapeamento.titulo === undefined) return setImportLog('Selecione qual coluna é o título.')
    const grupos = new Map()
    for (const linha of csvRows) {
      const titulo = linha[mapeamento.titulo]?.trim()
      if (!titulo) continue
      if (!grupos.has(titulo)) grupos.set(titulo, [])
      grupos.get(titulo).push(linha)
    }

    let importados = 0
    const naoEncontrados = []
    for (const [titulo, linhas] of grupos) {
      setImportLog(`Importando "${titulo}"…`)
      try {
        const { results } = await callFunction('buscar-titulo', { query: titulo })
        const melhor = results?.[0]
        if (!melhor) { naoEncontrados.push(titulo); continue }

        await callFunction('adicionar-titulo', { tmdb_id: melhor.tmdb_id, media_type: melhor.media_type, status: 'visto' })

        if (melhor.media_type === 'tv' && mapeamento.temporada !== undefined && mapeamento.episodio !== undefined) {
          const { data: episodios } = await supabase
            .from('episode')
            .select('id, season_number, episode_number')
            .eq('titulo_id', melhor.tmdb_id)

          for (const linha of linhas) {
            const s = parseInt(linha[mapeamento.temporada], 10)
            const ep = parseInt(linha[mapeamento.episodio], 10)
            const match = episodios?.find((e) => e.season_number === s && e.episode_number === ep)
            if (match) await supabase.from('watched_episode').upsert({ user_id: user.id, episode_id: match.id })
          }
        }
        importados++
      } catch {
        naoEncontrados.push(titulo)
      }
    }
    setImportLog(`Importação concluída: ${importados}/${grupos.size} títulos.${naoEncontrados.length ? ' Não encontrados: ' + naoEncontrados.join(', ') : ''}`)
  }

  async function excluirConta() {
    await callFunction('excluir-conta', {})
    await sair()
    navigate('/login')
  }

  return (
    <>
      <TopBar
        title="Configurações"
        rightSlot={
          <button onClick={() => navigate(-1)} className="text-muted">
            <ArrowLeft size={20} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto scroll-area">
        <SectionLabel>Privacidade</SectionLabel>
        <label className="flex items-center justify-between px-4 py-2">
          <span className="text-sm text-ink">Perfil privado</span>
          <input type="checkbox" checked={!!perfil?.perfil_privado} onChange={alternarPrivacidade} className="accent-amber w-5 h-5" />
        </label>

        <SectionLabel>Histórico</SectionLabel>
        <div className="px-4 flex flex-col gap-3">
          <button onClick={exportarHistorico} className="bg-surface border border-surface2 rounded py-2.5 text-sm text-ink">
            Exportar histórico (.csv)
          </button>

          <input type="file" accept=".csv" onChange={selecionarArquivo} className="text-xs text-muted" />

          {csvHeaders.length > 0 && (
            <div className="flex flex-col gap-2 bg-surface border border-surface2 rounded p-3">
              {['titulo', 'temporada', 'episodio'].map((campo) => (
                <div key={campo} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted uppercase font-mono">{campo}</span>
                  <select
                    value={mapeamento[campo] ?? ''}
                    onChange={(e) => setMapeamento({ ...mapeamento, [campo]: e.target.value === '' ? undefined : Number(e.target.value) })}
                    className="bg-surface2 text-xs text-ink rounded px-2 py-1"
                  >
                    <option value="">Ignorar</option>
                    {csvHeaders.map((h, i) => (
                      <option key={i} value={i}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
              <button onClick={importar} className="bg-amber text-black rounded py-2 text-sm font-display uppercase mt-1">
                Importar
              </button>
            </div>
          )}
          {importLog && <div className="text-xs text-muted font-mono">{importLog}</div>}
        </div>

        <SectionLabel>Conta</SectionLabel>
        <div className="px-4 pb-8 flex flex-col gap-2">
          <p className="text-xs text-muted">
            Excluir sua conta apaga permanentemente seu login e todos os seus dados. Digite EXCLUIR pra confirmar.
          </p>
          <input
            value={confirmacaoExclusao}
            onChange={(e) => setConfirmacaoExclusao(e.target.value)}
            className="bg-surface border border-surface2 rounded px-3 py-2 text-sm text-ink"
            placeholder="EXCLUIR"
          />
          <button
            onClick={excluirConta}
            disabled={confirmacaoExclusao !== 'EXCLUIR'}
            className="bg-danger text-black rounded py-2.5 text-sm font-display uppercase disabled:opacity-40"
          >
            Excluir minha conta
          </button>
        </div>
      </div>
    </>
  )
}
