import { supabase } from './supabaseClient'

// Uma consulta só (título OU episódio) + os autores buscados em lote em "usuarios_publico"
// (mesmo padrão de duas etapas da Fase 2 — "usuarios" só permite ler o próprio dono via RLS,
// e "usuarios_publico" é uma view, então não dá pra usar o embed automático do PostgREST).
// Agrupamento em { raiz, respostas[] } acontece no client pra evitar uma query por thread.
export async function buscarComentarios({ tituloId, episodeId }) {
  const query = supabase.from('comentario').select('*').order('created_at', { ascending: true })
  const { data: linhas, error } = tituloId != null
    ? await query.eq('titulo_id', tituloId)
    : await query.eq('episode_id', episodeId)

  if (error) {
    console.error('Erro ao buscar comentários:', error)
    return []
  }
  if (!linhas || linhas.length === 0) return []

  const idsAutores = [...new Set(linhas.map((c) => c.user_id))]
  const { data: autores, error: autoresErro } = await supabase
    .from('usuarios_publico')
    .select('id, username, foto_perfil')
    .in('id', idsAutores)

  if (autoresErro) console.error('Erro ao buscar autores dos comentários:', autoresErro)

  const mapaAutores = new Map((autores ?? []).map((a) => [a.id, a]))
  const comAutor = linhas.map((c) => ({ ...c, autor: mapaAutores.get(c.user_id) ?? null }))

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

export async function postarComentario({ userId, texto, tituloId, episodeId, threadId = null }) {
  const { data, error } = await supabase
    .from('comentario')
    .insert({
      user_id: userId,
      texto,
      thread_id: threadId,
      titulo_id: tituloId ?? null,
      episode_id: episodeId ?? null,
    })
    .select('*')
    .single()

  return { data, error }
}
