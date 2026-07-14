import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Heart, ChevronLeft, Star, Check } from 'lucide-react'
import { supabase, callFunction, idiomaAtual } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import SectionLabel from '../components/SectionLabel'

const POSTER_BASE = 'https://image.tmdb.org/t/p/w400'

export default function TituloDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, perfil } = useAuth()

  const [titulo, setTitulo] = useState(null)
  const [mediaType, setMediaType] = useState(null)
  const [elenco, setElenco] = useState([])
  const [userItem, setUserItem] = useState(null)
  const [minhaNota, setMinhaNota] = useState(0)
  const [episodios, setEpisodios] = useState([])
  const [assistidos, setAssistidos] = useState(new Set())
  const [temporadaAberta, setTemporadaAberta] = useState(null)

  useEffect(() => {
    carregar()
  }, [id])

  async function carregar() {
    const idioma = idiomaAtual(perfil)

    // Conteúdo (já no idioma certo, com fallback pro inglês, via cache-on-first-use)
    const traduzido = await callFunction('obter-titulo-traduzido', { titulo_id: Number(id), idioma }).catch(() => null)

    const { data: base } = await supabase
      .from('titulo')
      .select('nome, sinopse, imagem, genero, media_rating, total_avaliacoes')
      .eq('id', id)
      .single()
    setTitulo({ ...base, ...(traduzido ?? {}) })

    const { data: serieRow } = await supabase.from('series').select('titulo_id').eq('titulo_id', id).maybeSingle()
    const tipo = serieRow ? 'tv' : 'movie'
    setMediaType(tipo)

    if (tipo === 'tv') {
      const { data: cast } = await supabase.from('elenco_serie').select('personagem, ator(name, image)').eq('titulo_id', id)
      setElenco(cast ?? [])

      const { data: eps } = await supabase
        .from('episode')
        .select('id, season_number, episode_number, episode_name')
        .eq('titulo_id', id)
        .order('season_number', { ascending: true })
        .order('episode_number', { ascending: true })
      setEpisodios(eps ?? [])

      if (user) {
        const { data: watched } = await supabase.from('watched_episode').select('episode_id').eq('user_id', user.id)
        setAssistidos(new Set((watched ?? []).map((w) => w.episode_id)))
      }
    } else {
      const { data: cast } = await supabase.from('elenco_movie').select('personagem, ator(name, image)').eq('titulo_id', id)
      setElenco(cast ?? [])
    }

    if (user) {
      const { data: item } = await supabase
        .from('user_item')
        .select('status, favorito')
        .eq('user_id', user.id)
        .eq('titulo_id', id)
        .maybeSingle()
      setUserItem(item)

      const { data: rating } = await supabase
        .from('user_rating')
        .select('rating_score')
        .eq('user_id', user.id)
        .eq('titulo_id', id)
        .maybeSingle()
      setMinhaNota(rating?.rating_score ?? 0)
    }
  }

  async function adicionar(status = 'quero_ver') {
    await callFunction('adicionar-titulo', { tmdb_id: Number(id), media_type: mediaType, status })
    carregar()
  }

  async function favoritar() {
    await callFunction('favoritar', { titulo_id: Number(id), favorito: !userItem?.favorito })
    carregar()
  }

  async function avaliar(nota) {
    setMinhaNota(nota)
    await callFunction('avaliar', { titulo_id: Number(id), rating_score: nota })
    carregar()
  }

  async function marcarEpisodio(episodeId, marcado) {
    if (marcado) await supabase.from('watched_episode').delete().eq('user_id', user.id).eq('episode_id', episodeId)
    else await supabase.from('watched_episode').upsert({ user_id: user.id, episode_id: episodeId })

    // Recalcula quantos episódios estão marcados agora e deriva o status automaticamente:
    // nenhum assistido -> quero_ver | alguns -> vendo | todos -> visto
    const { data: assistidosAgora } = await supabase
      .from('watched_episode')
      .select('episode_id')
      .eq('user_id', user.id)
      .in('episode_id', episodios.map((e) => e.id))

    const totalAssistidos = assistidosAgora?.length ?? 0
    const novoStatus = totalAssistidos === 0 ? 'quero_ver' : totalAssistidos >= episodios.length ? 'visto' : 'vendo'

    await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status: novoStatus,
      favorito: userItem?.favorito ?? false,
    })

    carregar()
  }

  async function marcarFilmeVisto() {
    const novoStatus = userItem?.status === 'visto' ? 'quero_ver' : 'visto'
    await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status: novoStatus,
      favorito: userItem?.favorito ?? false,
    })
    carregar()
  }

  if (!titulo) return <div className="p-4 text-muted text-sm font-mono">Carregando…</div>

  const temporadas = [...new Set(episodios.map((e) => e.season_number))]

  return (
    <div className="flex-1 overflow-y-auto scroll-area">
      <div className="relative">
        {titulo.imagem && <img src={`${POSTER_BASE}${titulo.imagem}`} alt={titulo.nome} className="w-full aspect-[2/3] object-cover" />}
        <button onClick={() => navigate(-1)} className="absolute top-3 left-3 bg-bg/70 rounded-full p-2 text-ink">
          <ChevronLeft size={18} />
        </button>
        <button onClick={favoritar} className="absolute top-3 right-3 bg-bg/70 rounded-full p-2">
          <Heart size={18} fill={userItem?.favorito ? '#ff4b5c' : 'none'} className={userItem?.favorito ? 'text-heart' : 'text-ink'} />
        </button>
      </div>

      <div className="px-4 py-3">
        <h1 className="font-display uppercase text-xl text-ink">{titulo.nome}</h1>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted font-mono">
          <span>{titulo.genero}</span>
          {titulo.media_rating && (
            <span className="flex items-center gap-1 text-teal">
              <Star size={12} fill="currentColor" /> {titulo.media_rating} ({titulo.total_avaliacoes})
            </span>
          )}
        </div>
        <p className="text-sm text-ink mt-3 leading-relaxed">{titulo.sinopse}</p>

        <div className="flex items-center gap-2 mt-4">
          {!userItem ? (
            <button onClick={() => adicionar()} className="flex-1 bg-amber text-black rounded py-2.5 font-display uppercase text-sm">
              + Adicionar à lista
            </button>
          ) : (
            <div className="flex-1 bg-surface border border-surface2 rounded py-2.5 text-center text-sm text-ink font-mono uppercase">
              {{ quero_ver: 'Quero ver', vendo: 'Vendo agora', visto: 'Já vi' }[userItem.status]}
            </div>
          )}

          {mediaType === 'movie' && (
            <button
              onClick={marcarFilmeVisto}
              aria-label="Marcar como visto"
              className={`flex-shrink-0 w-11 h-11 rounded-full border flex items-center justify-center ${
                userItem?.status === 'visto' ? 'bg-teal border-teal text-black' : 'border-muted text-muted'
              }`}
            >
              <Check size={20} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 justify-center mt-4">
          {[1,2,3,4,5,6,7,8,9,10].map((n) => (
            <button key={n} onClick={() => avaliar(n)}>
              <Star size={16} fill={n <= minhaNota ? '#f3c255' : 'none'} className={n <= minhaNota ? 'text-amber' : 'text-muted'} />
            </button>
          ))}
        </div>
      </div>

      <SectionLabel>Elenco</SectionLabel>
      <div className="flex gap-3 px-4 pb-4 overflow-x-auto scroll-area">
        {elenco.map((c, i) => (
          <div key={i} className="flex-shrink-0 w-16 text-center">
            <div className="w-16 h-16 rounded-full bg-surface2 overflow-hidden">
              {c.ator?.image && <img src={`https://image.tmdb.org/t/p/w200${c.ator.image}`} className="w-full h-full object-cover" />}
            </div>
            <div className="text-[10px] text-ink mt-1 truncate">{c.ator?.name}</div>
            <div className="text-[9px] text-muted truncate">{c.personagem}</div>
          </div>
        ))}
      </div>

      {mediaType === 'tv' && (
        <>
          <SectionLabel>Episódios</SectionLabel>
          <div className="px-4 pb-8 flex flex-col gap-2">
            {temporadas.map((t) => (
              <div key={t} className="border border-surface2 rounded">
                <button
                  onClick={() => setTemporadaAberta(temporadaAberta === t ? null : t)}
                  className="w-full flex justify-between px-3 py-2 text-sm text-ink font-mono"
                >
                  Temporada {t}
                  <span className="text-muted">
                    {episodios.filter((e) => e.season_number === t && assistidos.has(e.id)).length}/
                    {episodios.filter((e) => e.season_number === t).length}
                  </span>
                </button>
                {temporadaAberta === t && (
                  <div className="flex flex-col">
                    {episodios.filter((e) => e.season_number === t).map((e) => {
                      const marcado = assistidos.has(e.id)
                      return (
                        <button
                          key={e.id}
                          onClick={() => marcarEpisodio(e.id, marcado)}
                          className="flex items-center justify-between px-3 py-2 text-xs border-t border-surface2"
                        >
                          <span className={marcado ? 'text-muted' : 'text-ink'}>
                            E{String(e.episode_number).padStart(2, '0')} · {e.episode_name}
                          </span>
                          <span className={marcado ? 'text-teal' : 'text-muted'}>{marcado ? '✓' : '○'}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
