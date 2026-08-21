import { supabase } from './supabaseClient'
import { formatarDuracao } from './format'

// Mesmo padrão de paginação usado em Perfil.jsx (o PostgREST corta em ~1000 linhas por página).
async function buscarTodasLinhas(construirQuery, tamanhoPagina = 1000) {
  let todas = []
  let inicio = 0
  while (true) {
    const { data, error } = await construirQuery().range(inicio, inicio + tamanhoPagina - 1)
    if (error) {
      console.error('[buscarTodasLinhas] Erro ao carregar pagina:', error)
      break
    }
    todas = todas.concat(data ?? [])
    if (!data || data.length < tamanhoPagina) break
    inicio += tamanhoPagina
  }
  return todas
}

async function buscarEmLotesIn(construirQueryBase, coluna, ids, tamanhoLote = 200) {
  if (!ids || ids.length === 0) return []
  let resultados = []
  for (let i = 0; i < ids.length; i += tamanhoLote) {
    const lote = ids.slice(i, i + tamanhoLote)
    const res = await buscarTodasLinhas(() => construirQueryBase().in(coluna, lote))
    resultados = resultados.concat(res)
  }
  return resultados
}

// Versão isolada (sem as prateleiras de favoritos/listas) da lógica de estatísticas
// já usada em Perfil.jsx, parametrizada por userId para servir também o perfil público.
export async function buscarEstatisticasUsuario(userId) {
  const [epsComData, filmesVistosRaw] = await Promise.all([
    buscarTodasLinhas(() =>
      supabase.from('watched_episode').select('episode_id, episode(duration)').eq('user_id', userId)
    ),
    buscarTodasLinhas(() =>
      supabase.from('user_item').select('titulo_id').eq('user_id', userId).eq('status', 'visto')
    ),
  ])

  const idsVistos = filmesVistosRaw.map((i) => i.titulo_id)

  const [moviesDuracao, gamesVistos] = await Promise.all([
    buscarEmLotesIn(() => supabase.from('movies').select('titulo_id, duration'), 'titulo_id', idsVistos),
    buscarEmLotesIn(() => supabase.from('games').select('titulo_id'), 'titulo_id', idsVistos),
  ])

  const minutosTv = epsComData.reduce((soma, e) => soma + (e.episode?.duration ?? 0), 0)
  const minutosFilme = moviesDuracao.reduce((soma, f) => soma + (f.duration ?? 0), 0)

  return {
    tempoTv: formatarDuracao(minutosTv).texto,
    episodios: epsComData.length,
    tempoFilme: formatarDuracao(minutosFilme).texto,
    filmes: moviesDuracao.length,
    jogos: gamesVistos.length,
  }
}
