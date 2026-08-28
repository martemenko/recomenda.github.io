import { supabase } from './supabaseClient'

// Uma consulta só (título OU episódio) + os autores buscados em lote em "usuarios_publico"
// (mesmo padrão de duas etapas da Fase 2 — "usuarios" só permite ler o próprio dono via RLS,
// e "usuarios_publico" é uma view, então não dá pra usar o embed automático do PostgREST).
// Agrupamento em { raiz, respostas[] } acontece no client pra evitar uma query por thread.
export const REACAO_VAZIA = { curtir: 0, rir: 0, amei: 0, minhaReacao: null }

export async function buscarComentarios({ tituloId, episodeId, currentUserId }) {
  const query = supabase.from('comentario').select('*').order('created_at', { ascending: true })
  const { data: linhas, error } = tituloId != null
    ? await query.eq('titulo_id', tituloId)
    : await query.eq('episode_id', episodeId)

  if (error) {
    console.error('Erro ao buscar comentários:', error)
    return []
  }
  if (!linhas || linhas.length === 0) return []

  const idsComentarios = linhas.map((c) => c.id)
  const idsAutores = [...new Set(linhas.map((c) => c.user_id))]
  const [{ data: autores, error: autoresErro }, { data: reacoesRaw, error: reacoesErro }] = await Promise.all([
    supabase.from('usuarios_publico').select('id, username, foto_perfil').in('id', idsAutores),
    supabase.from('comentario_reacao').select('comentario_id, user_id, tipo').in('comentario_id', idsComentarios),
  ])

  if (autoresErro) console.error('Erro ao buscar autores dos comentários:', autoresErro)
  if (reacoesErro) console.error('Erro ao buscar reações dos comentários:', reacoesErro)

  const mapaAutores = new Map((autores ?? []).map((a) => [a.id, a]))

  const reacoesPorComentario = new Map()
  for (const r of reacoesRaw ?? []) {
    const atual = reacoesPorComentario.get(r.comentario_id) ?? { ...REACAO_VAZIA }
    atual[r.tipo] = (atual[r.tipo] ?? 0) + 1
    if (currentUserId && r.user_id === currentUserId) atual.minhaReacao = r.tipo
    reacoesPorComentario.set(r.comentario_id, atual)
  }

  const comAutor = linhas.map((c) => ({
    ...c,
    autor: mapaAutores.get(c.user_id) ?? null,
    reacoes: reacoesPorComentario.get(c.id) ?? { ...REACAO_VAZIA },
  }))

  const respostasPorThread = new Map()
  for (const c of comAutor) {
    if (!c.thread_id) continue
    const lista = respostasPorThread.get(c.thread_id) ?? []
    lista.push(c)
    respostasPorThread.set(c.thread_id, lista)
  }

  return comAutor
    .filter((c) => !c.thread_id)
    .map((raiz) => ({ raiz, respostas: respostasPorThread.get(raiz.id) ?? [] }))
}

// Recalcula localmente as contagens de reação de UM comentário após tocar num
// tipo (upsert se for reação nova/diferente, remove se tocar de novo na mesma).
export function aplicarReacaoOtimista(comentario, tipoClicado) {
  const reacoes = comentario.reacoes ?? { ...REACAO_VAZIA }
  const reacaoAnterior = reacoes.minhaReacao
  const novaReacao = reacaoAnterior === tipoClicado ? null : tipoClicado

  const contagens = { ...reacoes }
  if (reacaoAnterior) contagens[reacaoAnterior] = Math.max(0, (contagens[reacaoAnterior] ?? 0) - 1)
  if (novaReacao) contagens[novaReacao] = (contagens[novaReacao] ?? 0) + 1

  return { ...comentario, reacoes: { ...contagens, minhaReacao: novaReacao } }
}

// Acha o comentário (raiz ou resposta) pelo id em todas as threads e aplica a
// transformação — evita duplicar a busca em cada handler de reação/edição.
export function atualizarComentarioNasThreads(threads, comentarioId, transformar) {
  return threads.map((t) => {
    if (t.raiz.id === comentarioId) return { ...t, raiz: transformar(t.raiz) }
    const idx = t.respostas.findIndex((r) => r.id === comentarioId)
    if (idx === -1) return t
    const novasRespostas = [...t.respostas]
    novasRespostas[idx] = transformar(novasRespostas[idx])
    return { ...t, respostas: novasRespostas }
  })
}

export async function alternarReacao({ comentarioId, userId, tipo, reacaoAtual }) {
  if (reacaoAtual === tipo) {
    const { error } = await supabase
      .from('comentario_reacao')
      .delete()
      .eq('comentario_id', comentarioId)
      .eq('user_id', userId)
    return { error }
  }

  const { error } = await supabase
    .from('comentario_reacao')
    .upsert({ comentario_id: comentarioId, user_id: userId, tipo })
  return { error }
}

export async function buscarContagemComentarios({ tituloId, episodeId }) {
  const query = supabase.from('comentario').select('id', { count: 'exact', head: true })
  const { count, error } = tituloId != null
    ? await query.eq('titulo_id', tituloId)
    : await query.eq('episode_id', episodeId)

  if (error) {
    console.error('Erro ao contar comentários:', error)
    return 0
  }
  return count ?? 0
}

export async function postarComentario({
  userId,
  texto,
  tituloId,
  episodeId,
  threadId = null,
  imagemUrl = null,
  gifUrl = null,
}) {
  const { data, error } = await supabase
    .from('comentario')
    .insert({
      user_id: userId,
      texto: texto?.trim() || null,
      thread_id: threadId,
      titulo_id: tituloId ?? null,
      episode_id: episodeId ?? null,
      imagem_url: imagemUrl,
      gif_url: gifUrl,
    })
    .select('*')
    .single()

  return { data, error }
}
