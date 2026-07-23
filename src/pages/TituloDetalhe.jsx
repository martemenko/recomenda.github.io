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
  const [confirmacao, setConfirmacao] = useState(null)

  useEffect(() => {
    carregar()
  }, [id])

  async function carregar() {
    const idioma = idiomaAtual(perfil)

    // Conteúdo (já no idioma certo, com fallback pro inglês, via cache-on-first-use)
    const traduzido = await callFunction('get-translate-title', { titulo_id: Number(id), idioma }).catch(() => null)

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
        const { data: watched } = await supabase
          .from('watched_episode')
          .select('episode_id')
          .eq('user_id', user.id)
          .in('episode_id', (eps ?? []).map((e) => e.id))
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

  // Episódios anteriores (temporada/episódio menor) ainda não assistidos - usado
  // pra saber se vale perguntar "marcar os anteriores também?"
  function episodiosAntesDe(alvo) {
    return episodios.filter(
      (e) =>
        !assistidos.has(e.id) &&
        (e.season_number < alvo.season_number ||
          (e.season_number === alvo.season_number && e.episode_number < alvo.episode_number)),
    )
  }

  // Grava (ou desfaz) a marcação de um lote de episódios de uma vez e recalcula o status
  async function aplicarMarcacao(episodeIds, desmarcar) {
    setConfirmacao(null)
    const { error } = desmarcar
      ? await supabase.from('watched_episode').delete().eq('user_id', user.id).in('episode_id', episodeIds)
      : await supabase.from('watched_episode').upsert(episodeIds.map((eid) => ({ user_id: user.id, episode_id: eid })))
    if (error) console.error('Erro ao marcar episódios:', error)

    const { data: assistidosAgora, error: erroAssistidos } = await supabase
      .from('watched_episode')
      .select('episode_id')
      .eq('user_id', user.id)
      .in('episode_id', episodios.map((e) => e.id))
    if (erroAssistidos) console.error('Erro ao recontar assistidos:', erroAssistidos)

    const totalAssistidos = assistidosAgora?.length ?? 0
    const novoStatus = totalAssistidos === 0 ? 'quero_ver' : totalAssistidos >= episodios.length ? 'visto' : 'vendo'

    const { error: erroStatus } = await supabase.from('user_item').upsert({
      user_id: user.id,
      titulo_id: Number(id),
      status: novoStatus,
      favorito: userItem?.favorito ?? false,
    })
    if (erroStatus) console.error('Erro ao atualizar status do user_item:', erroStatus)

    carregar()
  }

  async function marcarEpisodio(episodeObj, marcado) {
    if (marcado) {
      // Desmarcar é direto, sem perguntar nada
      await aplicarMarcacao([episodeObj.id], true)
      return
    }
    const anteriores = episodiosAntesDe(episodeObj)
    if (anteriores.length > 0) {
      setConfirmacao({
        mensagem: `Você ainda não marcou ${anteriores.length} episódio${anteriores.length > 1 ? 's' : ''} anterior${anteriores.length > 1 ? 'es' : ''}. Quer marcar ${anteriores.length > 1 ? 'eles' : 'ele'} também como assistido${anteriores.length > 1 ? 's' : ''}?`,
        aoConfirmar: () => aplicarMarcacao([...anteriores.map((e) => e.id), episodeObj.id], false),
        aoRecusar: () => aplicarMarcacao([episodeObj.id], false),
      })
    } else {
      await aplicarMarcacao([episodeObj.id], false)
    }
  }

  async function marcarTemporada(seasonNumber, todasAssistidas) {
    const epsDaTemporada = episodios.filter((e) => e.season_number === seasonNumber)
    if (todasAssistidas) {
      await aplicarMarcacao(epsDaTemporada.map((e) => e.id), true)
      return
    }
    const faltantes = epsDaTemporada.filter((e) => !assistidos.has(e.id))
    const temporadasAnteriores = episodios.filter((e) => e.season_number < seasonNumber && !assistidos.has(e.id))

    if (temporadasAnteriores.length > 0) {
      setConfirmacao({
        mensagem: `Tem temporada${temporadasAnteriores.length > 1 ? 's' : ''} anterior${temporadasAnteriores.length > 1 ? 'es' : ''} com episódio não assistido. Quer marcar ${temporadasAnteriores.length > 1 ? 'elas' : 'ela'} também como vista${temporadasAnteriores.length > 1 ? 's' : ''}?`,
        aoConfirmar: () => aplicarMarcacao([...temporadasAnteriores.map((e) => e.id), ...faltantes.map((e) => e.id)], false),
        aoRecusar: () => aplicarMarcacao(faltantes.map((e) => e.id), false),
      })
    } else {
      await aplicarMarcacao(faltantes.map((e) => e.id), false)
    }
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
        <h1 className="font-display font-semibold text-xl text-ink">{titulo.nome}</h1>
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
            <button onClick={() => adicionar()} className="flex-1 bg-amber text-bg rounded-2xl py-3 font-display font-semibold text-sm shadow-[0_0_18px_rgba(243,194,85,0.35)]">
              + Adicionar à lista
            </button>
          ) : (
            <div className="flex-1 bg-surface border border-white/10 rounded-2xl py-3 text-center text-sm text-ink font-display font-medium">
              {{ quero_ver: 'Quero ver', vendo: 'Vendo agora', visto: 'Já vi' }[userItem.status]}
            </div>
          )}

          {mediaType === 'movie' && (
            <button
              onClick={marcarFilmeVisto}
              aria-label="Marcar como visto"
              className={`flex-shrink-0 w-12 h-12 rounded-2xl border flex items-center justify-center ${
                userItem?.status === 'visto' ? 'bg-teal border-teal text-bg shadow-[0_0_14px_rgba(221,13,244,0.45)]' : 'border-white/15 text-muted'
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
            {temporadas.map((t) => {
              const epsDaTemporada = episodios.filter((e) => e.season_number === t)
              const assistidosCount = epsDaTemporada.filter((e) => assistidos.has(e.id)).length
              const todasAssistidas = assistidosCount === epsDaTemporada.length
              return (
                <div key={t} className="border border-white/10 rounded-2xl overflow-hidden">
                  <div className="flex items-center">
                    <button
                      onClick={() => setTemporadaAberta(temporadaAberta === t ? null : t)}
                      className="flex-1 flex justify-between px-3 py-2 text-sm text-ink font-mono"
                    >
                      Temporada {t}
                      <span className="text-muted">{assistidosCount}/{epsDaTemporada.length}</span>
                    </button>
                    <button
                      onClick={() => marcarTemporada(t, todasAssistidas)}
                      aria-label="Marcar temporada como vista"
                      className={`w-8 h-8 mr-2 flex-shrink-0 rounded-full flex items-center justify-center border ${
                        todasAssistidas ? 'bg-teal border-teal text-bg shadow-[0_0_10px_rgba(221,13,244,0.45)]' : 'border-white/15 text-muted'
                      }`}
                    >
                      <Check size={14} />
                    </button>
                  </div>
                  {temporadaAberta === t && (
                    <div className="flex flex-col">
                      {epsDaTemporada.map((e) => {
                        const marcado = assistidos.has(e.id)
                        return (
                          <button
                            key={e.id}
                            onClick={() => marcarEpisodio(e, marcado)}
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
              )
            })}
          </div>
        </>
      )}

      {confirmacao && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-6">
          <div className="bg-surface border border-white/10 rounded-2xl p-5 max-w-[340px] w-full">
            <p className="text-sm text-ink mb-4 leading-relaxed">{confirmacao.mensagem}</p>
            <div className="flex gap-3">
              <button
                onClick={confirmacao.aoRecusar}
                className="flex-1 border border-white/15 rounded-xl py-2.5 text-sm text-muted font-display font-medium"
              >
                Não
              </button>
              <button
                onClick={confirmacao.aoConfirmar}
                className="flex-1 bg-amber text-bg rounded-xl py-2.5 text-sm font-display font-semibold shadow-[0_0_14px_rgba(243,194,85,0.35)]"
              >
                Sim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
