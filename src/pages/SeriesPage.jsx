import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import TopBar from '../components/TopBar'
import SubTabs from '../components/SubTabs'
import SectionLabel from '../components/SectionLabel'
import EpisodioRow from '../components/EpisodioRow'

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000

export default function SeriesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [aba, setAba] = useState('lista')
  const [carregando, setCarregando] = useState(true)

  const [assistirASeguir, setAssistirASeguir] = useState([])
  const [semAssistirHaTempo, setSemAssistirHaTempo] = useState([])
  const [historico, setHistorico] = useState([])
  const [emBreve, setEmBreve] = useState([])

  useEffect(() => {
    if (user) carregar()
  }, [user])

  async function carregar() {
    setCarregando(true)

    // Séries que o usuário está vendo ou já viu (série!inner filtra só tv, não filme)
    const { data: itens } = await supabase
      .from('user_item')
      .select('titulo_id, status, added_at, titulo(nome, imagem), series!inner(temporadas)')
      .eq('user_id', user.id)
      .in('status', ['vendo', 'visto'])

    const tituloIds = (itens ?? []).map((i) => i.titulo_id)
    if (tituloIds.length === 0) {
      setAssistirASeguir([]); setSemAssistirHaTempo([]); setEmBreve([])
      await carregarHistorico()
      setCarregando(false)
      return
    }

    const { data: episodios } = await supabase
      .from('episode')
      .select('id, titulo_id, season_number, episode_number, episode_name, launch_date')
      .in('titulo_id', tituloIds)
      .order('season_number', { ascending: true })
      .order('episode_number', { ascending: true })

    const { data: assistidos } = await supabase
      .from('watched_episode')
      .select('episode_id, watched_at')
      .eq('user_id', user.id)

    const watchedMap = new Map((assistidos ?? []).map((a) => [a.episode_id, a.watched_at]))
    const hoje = new Date()

    const seguir = []
    const semTempo = []

    for (const item of itens.filter((i) => i.status === 'vendo')) {
      const eps = (episodios ?? []).filter((e) => e.titulo_id === item.titulo_id)
      const proximo = eps.find((e) => !watchedMap.has(e.id) && (!e.launch_date || new Date(e.launch_date) <= hoje))
      if (!proximo) continue

      const datasAssistidas = eps.map((e) => watchedMap.get(e.id)).filter(Boolean).map((d) => new Date(d))
      const ultimaAtividade = datasAssistidas.length
        ? new Date(Math.max(...datasAssistidas))
        : new Date(item.added_at)

      const linha = {
        tituloId: item.titulo_id,
        tituloNome: item.titulo.nome,
        imagem: item.titulo.imagem,
        temporada: proximo.season_number,
        episodio: proximo.episode_number,
        episodioNome: proximo.episode_name,
        episodeId: proximo.id,
      }

      if (hoje - ultimaAtividade > TRINTA_DIAS_MS) semTempo.push(linha)
      else seguir.push(linha)
    }

    // Em breve: episódios futuros das séries que o usuário assiste ou já assistiu
    const { data: futuros } = await supabase
      .from('episode')
      .select('id, titulo_id, season_number, episode_number, episode_name, launch_date, titulo(nome, imagem)')
      .in('titulo_id', tituloIds)
      .gt('launch_date', hoje.toISOString().slice(0, 10))
      .order('launch_date', { ascending: true })

    setAssistirASeguir(seguir)
    setSemAssistirHaTempo(semTempo)
    setEmBreve(futuros ?? [])
    await carregarHistorico()
    setCarregando(false)
  }

  async function carregarHistorico() {
    const { data } = await supabase
      .from('watched_episode')
      .select('watched_at, episode(id, season_number, episode_number, episode_name, titulo_id, titulo(nome, imagem))')
      .eq('user_id', user.id)
      .order('watched_at', { ascending: false })
      .limit(30)
    setHistorico(data ?? [])
  }

  async function marcarAssistido(episodeId, jaMarcado) {
    if (jaMarcado) {
      await supabase.from('watched_episode').delete().eq('user_id', user.id).eq('episode_id', episodeId)
    } else {
      await supabase.from('watched_episode').upsert({ user_id: user.id, episode_id: episodeId })
    }
    carregar()
  }

  return (
    <>
      <TopBar title="Séries" />
      <SubTabs
        tabs={[{ value: 'lista', label: 'Minha Lista' }, { value: 'em_breve', label: 'Em breve' }]}
        active={aba}
        onChange={setAba}
      />

      <div className="flex-1 overflow-y-auto scroll-area">
        {carregando && <div className="p-4 text-muted text-sm font-mono">Carregando…</div>}

        {!carregando && aba === 'lista' && (
          <>
            <SectionLabel>Assistir a seguir</SectionLabel>
            {assistirASeguir.length === 0 && <EmptyRow texto="Nenhum episódio novo por aqui." />}
            {assistirASeguir.map((l) => (
              <EpisodioRow
                key={l.episodeId}
                posterPath={l.imagem}
                tituloNome={l.tituloNome}
                temporada={l.temporada}
                episodio={l.episodio}
                episodioNome={l.episodioNome}
                marcado={false}
                onMarcar={() => marcarAssistido(l.episodeId, false)}
                onAbrirTitulo={() => navigate(`/titulo/${l.tituloId}`)}
              />
            ))}

            {semAssistirHaTempo.length > 0 && (
              <>
                <SectionLabel>Sem assistir há algum tempo</SectionLabel>
                {semAssistirHaTempo.map((l) => (
                  <EpisodioRow
                    key={l.episodeId}
                    posterPath={l.imagem}
                    tituloNome={l.tituloNome}
                    temporada={l.temporada}
                    episodio={l.episodio}
                    episodioNome={l.episodioNome}
                    marcado={false}
                    onMarcar={() => marcarAssistido(l.episodeId, false)}
                    onAbrirTitulo={() => navigate(`/titulo/${l.tituloId}`)}
                  />
                ))}
              </>
            )}

            {/* Só aparece rolando a tela pra baixo, por estar mais abaixo na página */}
            <SectionLabel>Histórico assistido</SectionLabel>
            {historico.length === 0 && <EmptyRow texto="Nada assistido ainda." />}
            {historico.map((h, i) => (
              <EpisodioRow
                key={`${h.episode.id}-${i}`}
                posterPath={h.episode.titulo.imagem}
                tituloNome={h.episode.titulo.nome}
                temporada={h.episode.season_number}
                episodio={h.episode.episode_number}
                episodioNome={h.episode.episode_name}
                marcado={true}
                onMarcar={() => marcarAssistido(h.episode.id, true)}
                onAbrirTitulo={() => navigate(`/titulo/${h.episode.titulo_id}`)}
              />
            ))}
          </>
        )}

        {!carregando && aba === 'em_breve' && (
          <>
            <SectionLabel>Próximos lançamentos</SectionLabel>
            {emBreve.length === 0 && <EmptyRow texto="Nada anunciado ainda pras suas séries." />}
            {emBreve.map((e) => (
              <EpisodioRow
                key={e.id}
                posterPath={e.titulo.imagem}
                tituloNome={e.titulo.nome}
                temporada={e.season_number}
                episodio={e.episode_number}
                episodioNome={`${e.episode_name} · ${new Date(e.launch_date).toLocaleDateString()}`}
                marcado={false}
                onMarcar={() => {}}
                onAbrirTitulo={() => navigate(`/titulo/${e.titulo_id}`)}
              />
            ))}
          </>
        )}
      </div>
    </>
  )
}

function EmptyRow({ texto }) {
  return <div className="px-4 py-6 text-muted text-sm font-mono text-center">{texto}</div>
}
