import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { formatarDuracao } from '../lib/format'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'
import PosterCard from '../components/PosterCard'

export default function Perfil() {
  const { user, perfil } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [listas, setListas] = useState([])
  const [historico, setHistorico] = useState([])

  useEffect(() => {
    if (user) carregar()
  }, [user])

  async function carregar() {
    // Tempo vendo TV + episódios assistidos
    const { data: eps, error: erroEps } = await supabase
      .from('watched_episode')
      .select('episode(duration)')
      .eq('user_id', user.id)
    if (erroEps) console.error('Erro ao buscar watched_episode:', erroEps)
    const minutosTv = (eps ?? []).reduce((soma, e) => soma + (e.episode?.duration ?? 0), 0)

    // Filmes assistidos + tempo vendo filme
    // user_item não tem FK direta pra "movies" - mesma correção das outras páginas
    const { data: itensVistos, error: erroItensVistos } = await supabase
      .from('user_item')
      .select('titulo_id')
      .eq('user_id', user.id)
      .eq('status', 'visto')
    if (erroItensVistos) console.error('Erro ao buscar user_item (visto):', erroItensVistos)

    const idsVistos = (itensVistos ?? []).map((i) => i.titulo_id)
    const { data: filmes, error: erroFilmes } = await supabase
      .from('movies')
      .select('titulo_id, duration')
      .in('titulo_id', idsVistos.length ? idsVistos : [0])
    if (erroFilmes) console.error('Erro ao buscar movies:', erroFilmes)

    const minutosFilme = (filmes ?? []).reduce((soma, f) => soma + (f.duration ?? 0), 0)

    setStats({
      tempoTv: formatarDuracao(minutosTv).texto,
      episodios: (eps ?? []).length,
      tempoFilme: formatarDuracao(minutosFilme).texto,
      filmes: (filmes ?? []).length,
    })

    const { data: listasData } = await supabase
      .from('lista')
      .select('id, nome, lista_item(titulo_id, titulo(imagem))')
      .eq('user_id', user.id)
    setListas(listasData ?? [])

    const { data: hist, error: erroHist } = await supabase
      .from('watched_episode')
      .select('episode(titulo(id, nome, imagem))')
      .eq('user_id', user.id)
      .order('watched_at', { ascending: false })
      .limit(12)
    if (erroHist) console.error('Erro ao buscar histórico:', erroHist)
    setHistorico(hist ?? [])
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

        <SectionLabel>Minhas listas</SectionLabel>
        {listas.length === 0 && <div className="px-4 pb-2 text-muted text-sm font-mono">Nenhuma lista criada ainda.</div>}
        <div className="flex gap-3 px-4 pb-2 overflow-x-auto scroll-area">
          {listas.map((l) => (
            <div key={l.id} className="flex-shrink-0 w-32">
              <div className="text-xs text-ink font-display font-medium truncate mb-1">{l.nome}</div>
              <div className="text-[10px] text-muted font-mono">{l.lista_item.length} títulos</div>
            </div>
          ))}
        </div>

        <SectionLabel>Histórico recente</SectionLabel>
        <div className="grid grid-cols-3 gap-3 px-4 pb-8">
          {historico.map((h, i) => (
            <PosterCard
              key={i}
              imagem={h.episode.titulo.imagem}
              nome={h.episode.titulo.nome}
              onClick={() => navigate(`/titulo/${h.episode.titulo.id}`)}
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
