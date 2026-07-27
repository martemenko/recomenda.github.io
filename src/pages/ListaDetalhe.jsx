import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Search, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import TopBar from '../components/TopBar'

const POSTER_BASE_THUMB = 'https://image.tmdb.org/t/p/w200'

function urlPoster(caminho) {
  if (!caminho) return null
  return caminho.startsWith('http') ? caminho : `${POSTER_BASE_THUMB}${caminho}`
}

export default function ListaDetalhe() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [lista, setLista] = useState(null)
  const [itens, setItens] = useState([])
  const [carregando, setCarregando] = useState(true)

  const [buscaAberta, setBuscaAberta] = useState(false)
  const [termoBusca, setTermoBusca] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [adicionandoId, setAdicionandoId] = useState(null)
  const [removendoId, setRemovendoId] = useState(null)

  useEffect(() => {
    if (user && id) carregar()
  }, [user, id])

  async function carregar() {
    setCarregando(true)
    try {
      const { data: listaData, error: erroLista } = await supabase
        .from('lista')
        .select('id, nome, user_id')
        .eq('id', id)
        .single()

      if (erroLista || !listaData || listaData.user_id !== user.id) {
        setLista(null)
        setItens([])
        return
      }
      setLista(listaData)

      await carregarItens()
    } finally {
      setCarregando(false)
    }
  }

  async function carregarItens() {
    // lista_item usa "added_at" (confirmado no schema), não "created_at".
    const { data, error } = await supabase
      .from('lista_item')
      .select('titulo_id, added_at, titulo(id, nome, imagem)')
      .eq('lista_id', id)
    if (error) {
      console.error('[ListaDetalhe] Erro ao buscar itens:', error)
      setItens([])
      return
    }

    const ordenado = [...(data ?? [])].sort(
      (a, b) => new Date(b.added_at) - new Date(a.added_at)
    )
    setItens(ordenado)
  }

  async function buscarTitulos(e) {
    e.preventDefault()
    if (!termoBusca.trim()) return
    setBuscando(true)
    try {
      const { data, error } = await supabase.functions.invoke('buscar-titulo', {
        body: { query: termoBusca.trim() },
      })
      if (error) {
        console.error('[ListaDetalhe] Erro ao buscar título:', error)
        setResultados([])
        return
      }
      setResultados(data?.results ?? [])
    } finally {
      setBuscando(false)
    }
  }

  async function adicionarTitulo(resultado) {
    const tmdbId = resultado.tmdb_id ?? resultado.id
    if (!tmdbId) return
    setAdicionandoId(tmdbId)
    try {
      // Garante que o título existe no catálogo antes de referenciá-lo em lista_item
      const { data: tituloExistente } = await supabase
        .from('titulo')
        .select('id, nome, imagem')
        .eq('id', tmdbId)
        .maybeSingle()

      let tituloFinal = tituloExistente
      if (!tituloExistente) {
        const { error: erroAdd } = await supabase.functions.invoke('adicionar-titulo', {
          body: { tmdb_id: tmdbId, media_type: resultado.media_type || 'tv' },
        })
        if (erroAdd) {
          alert(`Erro ao adicionar título: ${erroAdd.message}`)
          return
        }
        const { data: tituloRecemCriado } = await supabase
          .from('titulo')
          .select('id, nome, imagem')
          .eq('id', tmdbId)
          .maybeSingle()
        tituloFinal = tituloRecemCriado
      }

      const { data: itemExistente } = await supabase
        .from('lista_item')
        .select('titulo_id')
        .eq('lista_id', id)
        .eq('titulo_id', tmdbId)
        .maybeSingle()

      if (!itemExistente) {
        const { error: erroInsert } = await supabase
          .from('lista_item')
          .insert({ lista_id: id, titulo_id: tmdbId })
        if (erroInsert) {
          alert(`Erro ao adicionar à lista: ${erroInsert.message}`)
          return
        }
        setItens((prev) => [
          { titulo_id: tmdbId, added_at: new Date().toISOString(), titulo: tituloFinal },
          ...prev,
        ])
      }

      setBuscaAberta(false)
      setTermoBusca('')
      setResultados([])
    } finally {
      setAdicionandoId(null)
    }
  }

  async function removerTitulo(tituloId) {
    setRemovendoId(tituloId)
    try {
      const { error } = await supabase
        .from('lista_item')
        .delete()
        .eq('lista_id', id)
        .eq('titulo_id', tituloId)
      if (error) {
        alert(`Erro ao remover título: ${error.message}`)
        return
      }
      setItens((prev) => prev.filter((i) => i.titulo_id !== tituloId))
    } finally {
      setRemovendoId(null)
    }
  }

  async function excluirLista() {
    const confirmar = window.confirm(`Excluir a lista "${lista.nome}"? Essa ação não pode ser desfeita.`)
    if (!confirmar) return
    try {
      const { error: erroItens } = await supabase.from('lista_item').delete().eq('lista_id', id)
      if (erroItens) {
        alert(`Erro ao excluir itens da lista: ${erroItens.message}`)
        return
      }
      const { error: erroLista } = await supabase.from('lista').delete().eq('id', id)
      if (erroLista) {
        alert(`Erro ao excluir lista: ${erroLista.message}`)
        return
      }
      navigate('/perfil')
    } catch (e) {
      alert(`Erro ao excluir lista: ${e.message}`)
    }
  }

  if (carregando) {
    return (
      <div className="flex-1">
        <TopBar
          title="Lista"
          rightSlot={
            <button onClick={() => navigate('/perfil')} className="text-muted">
              <ArrowLeft size={20} />
            </button>
          }
        />
        <div className="px-4 py-6 text-sm text-muted font-mono">Carregando...</div>
      </div>
    )
  }

  if (!lista) {
    return (
      <div className="flex-1">
        <TopBar
          title="Lista"
          rightSlot={
            <button onClick={() => navigate('/perfil')} className="text-muted">
              <ArrowLeft size={20} />
            </button>
          }
        />
        <div className="px-4 py-6 text-sm text-muted font-mono">
          Lista não encontrada, ou você não tem acesso a ela.
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 pb-10">
      <TopBar
        title={lista.nome}
        rightSlot={
          <button onClick={() => navigate('/perfil')} className="text-muted">
            <ArrowLeft size={20} />
          </button>
        }
      />

      <div className="px-4 py-3 flex gap-2">
        <button
          onClick={() => setBuscaAberta((v) => !v)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-surface2 hover:bg-white/10 text-amber border border-amber/20 font-display font-semibold rounded-xl text-sm transition-colors"
        >
          <Search size={16} /> Adicionar título
        </button>
        <button
          onClick={excluirLista}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-display font-semibold rounded-xl text-sm transition-colors"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="px-4">
        {buscaAberta && (
          <div className="mt-3 bg-surface border border-white/5 rounded-2xl p-3 space-y-3">
            <form onSubmit={buscarTitulos} className="flex gap-2">
              <input
                type="text"
                value={termoBusca}
                onChange={(e) => setTermoBusca(e.target.value)}
                placeholder="Nome do filme ou série"
                autoFocus
                className="flex-1 bg-surface2 border border-white/10 rounded-xl p-2.5 text-xs text-ink placeholder:text-muted/50"
              />
              <button
                type="submit"
                disabled={buscando}
                className="px-4 bg-amber text-bg font-display font-semibold rounded-xl text-xs disabled:opacity-50"
              >
                {buscando ? '...' : 'Buscar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBuscaAberta(false)
                  setResultados([])
                  setTermoBusca('')
                }}
                className="text-muted px-1"
              >
                <X size={18} />
              </button>
            </form>

            {resultados.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto scroll-area">
                {resultados.map((r) => {
                  const rid = r.tmdb_id ?? r.id
                  return (
                    <button
                      key={rid}
                      onClick={() => adicionarTitulo(r)}
                      disabled={adicionandoId === rid}
                      className="w-full flex items-center gap-3 text-left disabled:opacity-50"
                    >
                      <div
                        className="w-9 aspect-[2/3] rounded-md bg-surface2 flex-shrink-0 bg-cover bg-center"
                        style={
                          r.imagem || r.poster
                            ? { backgroundImage: `url(${urlPoster(r.imagem || r.poster)})` }
                            : undefined
                        }
                      />
                      <div className="text-xs text-ink font-display font-medium truncate flex-1">
                        {r.nome || r.title}
                      </div>
                      <div className="text-[10px] text-amber font-mono">
                        {adicionandoId === rid ? 'adicionando...' : 'adicionar'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-4 space-y-2">
        {itens.length === 0 && (
          <div className="text-muted text-sm font-mono py-4">Essa lista ainda não tem títulos.</div>
        )}
        {itens.map((item) => (
          <div
            key={item.titulo_id}
            className="flex items-center gap-3 bg-surface border border-white/5 rounded-2xl p-2.5"
          >
            <div
              onClick={() => navigate(`/titulo/${item.titulo_id}`)}
              className="w-11 aspect-[2/3] rounded-md bg-surface2 flex-shrink-0 bg-cover bg-center cursor-pointer"
              style={item.titulo?.imagem ? { backgroundImage: `url(${urlPoster(item.titulo.imagem)})` } : undefined}
            />
            <div
              onClick={() => navigate(`/titulo/${item.titulo_id}`)}
              className="flex-1 text-sm text-ink font-display font-medium truncate cursor-pointer"
            >
              {item.titulo?.nome}
            </div>
            <button
              onClick={() => removerTitulo(item.titulo_id)}
              disabled={removendoId === item.titulo_id}
              className="p-2 text-red-400 disabled:opacity-30"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
