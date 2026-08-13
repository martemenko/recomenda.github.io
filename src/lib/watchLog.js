import { supabase } from './supabaseClient'

// Grava uma linha em watch_log por episódio marcado (ou uma linha para o título, no
// caso de filme/jogo) — histórico aditivo, nunca apagado ao desmarcar. Usado tanto na
// primeira marcação quanto em "marcar como reassistido".
export async function registrarAssistido({ userId, episodeIds, tituloId }) {
  if (!userId) return
  const linhas = episodeIds?.length
    ? episodeIds.map((episode_id) => ({ user_id: userId, episode_id }))
    : tituloId
    ? [{ user_id: userId, titulo_id: tituloId }]
    : []

  if (!linhas.length) return

  const { error } = await supabase.from('watch_log').insert(linhas)
  if (error) console.error('Erro ao registrar histórico de assistido:', error)
}

// Retorna um Map<episode_id, quantidade> com quantas vezes cada episódio da lista foi
// assistido pelo usuário (para exibir "Assistido · Nx" quando > 1).
export async function contarAssistidosPorEpisodio(userId, episodeIds) {
  const mapa = new Map()
  if (!userId || !episodeIds?.length) return mapa

  const { data, error } = await supabase
    .from('watch_log')
    .select('episode_id')
    .eq('user_id', userId)
    .in('episode_id', episodeIds)

  if (error) {
    console.error('Erro ao contar histórico de episódios assistidos:', error)
    return mapa
  }

  for (const row of data ?? []) {
    mapa.set(row.episode_id, (mapa.get(row.episode_id) ?? 0) + 1)
  }
  return mapa
}

// Quantas vezes o usuário marcou este título (filme/jogo) como assistido/jogado.
export async function contarAssistidosPorTitulo(userId, tituloId) {
  if (!userId || !tituloId) return 0

  const { count, error } = await supabase
    .from('watch_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('titulo_id', tituloId)

  if (error) {
    console.error('Erro ao contar histórico do título:', error)
    return 0
  }
  return count ?? 0
}
