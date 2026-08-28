import { supabase } from './supabaseClient'
import { formatarDuracao } from './format'

// Parametrizada por userId para servir tanto o próprio perfil quanto o perfil
// público de terceiros. Delega o agregado pra função `estatisticas_publicas`
// (SECURITY DEFINER) no banco: ela é quem decide se o chamador pode ver essas
// estatísticas (dono, ou privado_estatisticas=false no alvo) — ver migração
// 20260828010000_onboarding_e_privacidade.sql. Devolve null quando o alvo
// escondeu a seção (nenhuma linha retornada pela função).
export async function buscarEstatisticasUsuario(userId) {
  const { data, error } = await supabase.rpc('estatisticas_publicas', { alvo_id: userId }).maybeSingle()

  if (error) {
    console.error('[buscarEstatisticasUsuario] Erro ao buscar estatísticas:', error)
    return null
  }
  if (!data) return null

  return {
    tempoTv: formatarDuracao(data.minutos_tv ?? 0).texto,
    episodios: data.episodios ?? 0,
    tempoFilme: formatarDuracao(data.minutos_filme ?? 0).texto,
    filmes: data.filmes ?? 0,
    jogos: data.jogos ?? 0,
  }
}
