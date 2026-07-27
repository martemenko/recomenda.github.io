import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical, Plus } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { formatarDuracao } from '../lib/format'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'
import PosterCard from '../components/PosterCard'

// O Supabase/PostgREST tem um limite padrão de "max rows" por requisição
// (normalmente 1000), que corta a resposta mesmo se você pedir um .range()
// maior. Pra buscar tudo de verdade, pagina em lotes e concatena até a
// página voltar vazia ou menor que o tamanho pedido.
async function buscarTodasLinhas(construirQuery, tamanhoPagina = 1000) {
  let todas = []
  let inicio = 0
  while (true) {
    const { data, error } = await construirQuery().range(inicio, inicio + tamanhoPagina - 1)
    if (error) throw error
    todas = todas.concat(data ?? [])
    if (!data || data.length < tamanhoPagina) break
    inicio += tamanhoPagina
  }
  return todas
}

const POSTER_BASE_THUMB = 'https://image.tmdb.org/t/p/w200'

function urlPoster(caminho) {
  if (!caminho) return null
  return caminho.startsWith('http') ? caminho : `${POSTER_BASE_THUMB}${caminho}`
}

export default function Perfil() {
  const { user, perfil } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [listas, setListas] = useState([])
  const [historico, setHistorico] = useState([])
  const [criandoLista, setCriandoLista] = useState(false)

  useEffect(() => {
    if (user) carregar()
  }, [user])

  async function carregar() {
    // Tempo vendo TV + episódios assistidos
    // Paginado pra não cair no limite padrão de max-rows do Supabase - essa é
    // uma soma de todo o histórico, não dá pra escopar por título como nas
    // outras telas.
    let eps = []
    try {
      eps = await buscarTodasLinhas(() =>
        supabase.from('watched_episode').select('episode(duration)').eq('user_id', user.id)
      )
    } catch (erroEps) {
      console.error('Erro ao buscar watched_episode:', erroEps)
    }
    const minutosTv = eps.reduce((soma, e) => soma + (e.episode?.duration ?? 0), 0)

    // Filmes assistidos + tempo vendo filme
    // user_item não tem FK direta pra "movies" - mesma correção das outras páginas
    let itensVistos = []
    try {
      itensVistos = await buscarTodasLinhas(() =>
        supabase.from('user_item').select('titulo_id').eq('user_id', user.id).eq('status', 'visto')
      )
    } catch (erroItensVistos) {
      console.error('Erro ao buscar user_item (visto):', erroItensVistos)
    }

    const idsVistos = itensVistos.map((i) => i.titulo_id)
    let filmes = []
    try {
      filmes = idsVistos.length
        ? await buscarTodasLinhas(() =>
            supabase.from('movies').select('titulo_id, duration').in('titulo_id', idsVistos)
          )
        : []
    } catch (erroFilmes) {
      console.error('Erro ao buscar movies:', erroFilmes)
    }

    const minutosFilme = filmes.reduce((soma, f) => soma + (f.duration ?? 0), 0)

    setStats({
      tempoTv: formatarDuracao(minutosTv).texto,
      episodios: eps.length,
      tempoFilme: formatarDuracao(minutosFilme).texto,
      filmes: filmes.length,
    })

    // Tenta buscar com created_at pra ordenar os itens por data de adição.
    // Se a coluna não existir em lista_item, a query toda falha (Postgrest
    // rejeita, não ignora o campo) - nesse caso refaz sem created_at pra lista
    // não desaparecer por causa disso.
    let listasData = null
    let temCreatedAt = true
    const { data: dataComData, error: erroComData } = await supabase
      .from('lista')
      .select('id, nome, lista_item(titulo_id, created_at, titulo(nome, imagem))')
      .eq('user_id', user.id)

    if (erroComData) {
      console.warn('[Perfil] Não foi possível ordenar itens de lista por data de adição (lista_item pode não ter coluna created_at). Buscando sem ordenação.', erroComData)
      temCreatedAt = false
      const { data: dataSemData, error: erroSemData } = await supabase
        .from('lista')
        .select('id, nome, lista_item(titulo_id, titulo(nome, imagem))')
        .eq('user_id', user.id)
      if (erroSemData) console.error('Erro ao buscar listas:', erroSemData)
      listasData = dataSemData
    } else {
      listasData = dataComData
    }

    // Ordena os itens de cada lista por data de adição (mais recentes primeiro)
    // pra usar nos cartazes de preview - o total exibido continua sendo a
    // contagem de todos os itens, só o preview é limitado.
    const listasOrdenadas = (listasData ?? []).map((l) => ({
      ...l,
      lista_item: temCreatedAt
        ? [...l.lista_item].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        : l.lista_item,
    }))
    setListas(listasOrdenadas)

    // Histórico recente - busca um lote maior de episódios (não só 12) porque
    // várias linhas podem ser do mesmo título; dedupe por titulo_id mantendo
    // a ocorrência mais recente de cada um, até ter 12 títulos únicos.
    const { data: histBruto, error: erroHist } = await supabase
      .from('watched_episode')
      .select('episode(titulo_id)')
      .eq('user_id', user.id)
      .order('watched_at', { ascending: false })
      .limit(300)
    if (erroHist) console.error('Erro ao buscar histórico:', erroHist)

    const idsHistOrdem = []
    const idsHistVistos = new Set()
    for (const h of histBruto ?? []) {
      const tid = h.episode?.titulo_id
      if (!tid || idsHistVistos.has(tid)) continue
      idsHistVistos.add(tid)
      idsHistOrdem.push(tid)
      if (idsHistOrdem.length >= 12) break
    }

    const { data: titulosHist } = idsHistOrdem.length
      ? await supabase.from('titulo').select('id, nome, imagem').in('id', idsHistOrdem)
      : { data: [] }
    const mapaTitulos = new Map((titulosHist ?? []).map((t) => [t.id, t]))
    setHistorico(idsHistOrdem.map((id) => mapaTitulos.get(id)).filter(Boolean))
  }

  async function criarLista() {
    const nome = window.prompt('Nome da nova lista:')
    if (!nome || !nome.trim()) return
    setCriandoLista(true)
    try {
      const { data: novaLista, error } = await supabase
        .from('lista')
        .insert({ user_id: user.id, nome: nome.trim() })
        .select('id, nome')
        .single()
      if (error) {
        alert(`Erro ao criar lista: ${error.message}`)
        return
      }
      setListas((prev) => [...prev, { ...novaLista, lista_item: [] }])
    } finally {
      setCriandoLista(false)
    }
  }

  return (
    <>
      <TopBar
        title="Perfil"
        rightSlot={
          <button onClick={() => navigate('/configuracoes')} className="text-muted">
            <MoreVertical size={20} />
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto scroll-area">
        <div className="px-4 py-3 text-sm text-muted font-mono">{perfil?.username}</div>

        <SectionLabel>Estatísticas</SectionLabel>
        {stats && (
          <div className="grid grid-cols-2 gap-3 px-4">
            <StatCard label="Tempo vendo TV" valor={stats.tempoTv} />
            <StatCard label="Episódios assistidos" valor={stats.episodios} />
            <StatCard label="Tempo vendo filmes" valor={stats.tempoFilme} />
            <StatCard label="Filmes assistidos" valor={stats.filmes} />
          </div>
        )}

        <div className="flex items-center justify-between pr-4">
          <SectionLabel>Minhas listas</SectionLabel>
          <button
            onClick={criarLista}
            disabled={criandoLista}
            className="flex items-center gap-1 text-xs text-amber font-display font-medium disabled:opacity-50"
          >
            <Plus size={14} /> Nova lista
          </button>
        </div>
        {listas.length === 0 && <div className="px-4 pb-2 text-muted text-sm font-mono">Nenhuma lista criada ainda.</div>}
        <div className="px-4 pb-2 space-y-4">
          {listas.map((l) => (
            <button
              key={l.id}
              onClick={() => navigate(`/lista/${l.id}`)}
              className="w-full text-left block"
            >
              <div className="text-sm text-ink font-display font-medium truncate mb-1.5">{l.nome}</div>
              <div className="flex gap-1">
                {l.lista_item.slice(0, 5).map((item) => (
                  <div
                    key={item.titulo_id}
                    className="w-10 aspect-[2/3] rounded-sm bg-surface2 flex-shrink-0 bg-cover bg-center"
                    style={item.titulo?.imagem ? { backgroundImage: `url(${urlPoster(item.titulo.imagem)})` } : undefined}
                  />
                ))}
                {l.lista_item.length === 0 && (
                  <div className="w-10 aspect-[2/3] rounded-sm bg-surface2 flex-shrink-0" />
                )}
              </div>
            </button>
          ))}
        </div>

        <SectionLabel>Histórico recente</SectionLabel>
        <div className="grid grid-cols-3 gap-3 px-4 pb-8">
          {historico.map((titulo) => (
            <PosterCard
              key={titulo.id}
              imagem={titulo.imagem}
              nome={titulo.nome}
              onClick={() => navigate(`/titulo/${titulo.id}`)}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function StatCard({ label, valor }) {
  return (
    <div className="bg-surface border border-white/5 rounded-2xl px-3.5 py-3 relative overflow-hidden">
      <div className="font-mono text-lg text-teal">{valor}</div>
      <div className="text-[10px] text-muted uppercase">{label}</div>
    </div>
  )
}
