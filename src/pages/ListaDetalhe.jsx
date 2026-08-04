import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Search, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { intercalar } from '../lib/format'
import { useAuth } from '../lib/auth'
import TopBar from '../components/TopBar'

const POSTER_BASE_THUMB = 'https://image.tmdb.org/t/p/w200'

function urlPoster(caminho) {
  if (!caminho) return null
  return caminho.startsWith('http') ? caminho : `${POSTER_BASE_THUMB}${caminho}`
}

// Id do resultado de busca, seja ele de qual fonte for (usado como chave/estado de loading)
function ridDeResultado(r) {
  return r.tmdb_id ?? r.igdb_id ?? r.id
}

function badgeDeResultado(mediaType) {
  if (mediaType === 'tv') return 'Série'
  if (mediaType === 'movie') return 'Filme'
  return 'Jogo'
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
      // Paralelo e independente: se uma fonte falhar, a outra continua funcionando.
      const [tituloRes, jogoRes] = await Promise.all([
        supabase.functions.invoke('buscar-titulo', { body: { query: termoBusca.trim() } }),
        supabase.functions.invoke('buscar-jogo', { body: { query: termoBusca.trim() } }),
      ])
      if (tituloRes.error) console.error('[ListaDetalhe] Erro ao buscar título:', tituloRes.error)
      if (jogoRes.error) console.error('[ListaDetalhe] Erro ao buscar jogo:', jogoRes.error)
      setResultados(intercalar(tituloRes.data?.results ?? [], jogoRes.data?.results ?? []))
    } finally {
      setBuscando(false)
    }
  }

  async function adicionarTitulo(resultado) {
    const externalId = ridDeResultado(resultado)
    const fonte = resultado.fonte ?? 'tmdb'
    if (!externalId) return
    setAdicionandoId(externalId)
    try {
      // Resolve o titulo_id real via (fonte, external_id) — a PK de `titulo` é sintética
      // (gerada pela sequence), não é mais seguro assumir que bate com o id externo.
      const { data: tituloExistente } = await supabase
        .from('titulo')
        .select('id, nome, imagem')
        .eq('fonte', fonte)
        .eq('external_id', externalId)
        .maybeSingle()

      let tituloFinal = tituloExistente

      if (!tituloExistente) {
        const nomeFuncao = fonte === 'igdb' ? 'adicionar-jogo' : 'adicionar-titulo'
        const corpo =
          fonte === 'igdb'
            ? { igdb_id: externalId, status: 'none' }
            : { tmdb_id: externalId, media_type: resultado.media_type || 'tv', status: 'none' }

        const { data: respAdd, error: erroAdd } = await supabase.functions.invoke(nomeFuncao, { body: corpo })
        if (erroAdd || !respAdd?.titulo_id) {
          alert(`Erro ao adicionar título: ${erroAdd?.message || 'resposta inválida do servidor'}`)
          return
        }

        const { data: tituloRecemCriado } = await supabase
          .from('titulo')
          .select('id, nome, imagem')
          .eq('id', respAdd.titulo_id)
          .maybeSingle()
        tituloFinal = tituloRecemCriado
      }

      if (!tituloFinal) return
      const tituloIdReal = tituloFinal.id

      const { data: itemExistente } = await supabase
        .from('lista_item')
        .select('titulo_id')
        .eq('lista_id', id)
        .eq('titulo_id', tituloIdReal)
        .maybeSingle()

      if (!itemExistente) {
        const { error: erroInsert } = await supabase
          .from('lista_item')
          .insert({ lista_id: id, titulo_id: tituloIdReal })
        if (erroInsert) {
          alert(`Erro ao adicionar à lista: ${erroInsert.message}`)
          return
        }
        setItens((prev) => [
          { titulo_id: tituloIdReal, added_at: new Date().toISOString(), titulo: tituloFinal },
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
                placeholder="Nome do filme, série ou jogo"
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
                  const rid = ridDeResultado(r)
                  return (
                    <button
                      key={`${r.media_type}-${rid}`}
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
                      <div className="text-[9px] text-muted font-mono uppercase">
                        {badgeDeResultado(r.media_type)}
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
