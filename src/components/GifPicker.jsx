import { useEffect, useRef, useState } from 'react'
import { X, Search } from 'lucide-react'
import { callFunction } from '../lib/supabaseClient'

const DEBOUNCE_MS = 400

// Modal de busca de GIF (proxy pro GIPHY via edge function buscar-gif --
// a chave da API nunca chega no client, ver esse arquivo). Abre já
// mostrando os GIFs em alta; escolher um chama onEscolher(url) e fecha.
export default function GifPicker({ onEscolher, onFechar }) {
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState([])
  const [carregando, setCarregando] = useState(true)
  const debounceRef = useRef(null)

  useEffect(() => {
    buscar(query)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function aoDigitar(valor) {
    setQuery(valor)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => buscar(valor), DEBOUNCE_MS)
  }

  async function buscar(termo) {
    setCarregando(true)
    const { results } = await callFunction('buscar-gif', { query: termo })
    setResultados(results ?? [])
    setCarregando(false)
  }

  return (
    <div className="fixed inset-0 bg-bg/95 backdrop-blur-sm z-[60] flex flex-col max-w-[480px] mx-auto w-full left-0 right-0">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
        <div className="flex-1 flex items-center gap-2 bg-surface2 border border-white/10 rounded-xl px-3 py-2">
          <Search size={16} className="text-muted flex-shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => aoDigitar(e.target.value)}
            placeholder="Buscar GIF..."
            className="flex-1 min-w-0 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
          />
        </div>
        <button onClick={onFechar} className="text-muted flex-shrink-0">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-area p-3">
        {carregando ? (
          <div className="text-muted text-sm font-mono text-center py-8">Carregando…</div>
        ) : resultados.length === 0 ? (
          <div className="text-muted text-sm font-mono text-center py-8">Nenhum GIF encontrado.</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {resultados.map((g) => (
              <button
                key={g.id}
                onClick={() => onEscolher(g.url)}
                className="rounded-xl overflow-hidden bg-surface2 border border-white/5 hover:border-amber/40 transition-colors"
              >
                <img src={g.preview_url} alt="" loading="lazy" className="w-full h-auto block" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
