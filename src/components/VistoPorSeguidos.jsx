import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import UserAvatar from './UserAvatar'

// "Fulano e mais 2 assistiram/jogaram isso" -- só considera quem o usuário
// logado segue, lendo user_item_publico/watched_episode_publico (views que
// já respeitam a privacidade de histórico de cada um, ver migração
// 20260828030000_privacidade_por_excecao.sql) em vez das tabelas base.
export default function VistoPorSeguidos({ tituloId, episodeId, tipo = 'assistiu' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [pessoas, setPessoas] = useState([])

  useEffect(() => {
    if (!user) {
      setPessoas([])
      return
    }
    carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tituloId, episodeId])

  async function carregar() {
    const { data: seguindo } = await supabase.from('seguidor').select('seguido_id').eq('seguidor_id', user.id)
    const ids = (seguindo ?? []).map((s) => s.seguido_id)
    if (ids.length === 0) {
      setPessoas([])
      return
    }

    const { data: vistos } =
      tituloId != null
        ? await supabase
            .from('user_item_publico')
            .select('user_id')
            .eq('titulo_id', tituloId)
            .eq('status', 'visto')
            .in('user_id', ids)
        : await supabase.from('watched_episode_publico').select('user_id').eq('episode_id', episodeId).in('user_id', ids)

    const vistoIds = [...new Set((vistos ?? []).map((v) => v.user_id))]
    if (vistoIds.length === 0) {
      setPessoas([])
      return
    }

    const { data: perfis } = await supabase.from('usuarios_publico').select('id, username, foto_perfil').in('id', vistoIds)
    setPessoas(perfis ?? [])
  }

  if (!user || pessoas.length === 0) return null

  const nomes = pessoas.map((p) => `@${p.username}`)
  const verboSingular = tipo === 'jogou' ? 'jogou' : 'assistiu'
  const verboPlural = tipo === 'jogou' ? 'jogaram' : 'assistiram'

  let texto
  if (nomes.length === 1) {
    texto = `${nomes[0]} ${verboSingular} isso`
  } else if (nomes.length === 2) {
    texto = `${nomes[0]} e ${nomes[1]} ${verboPlural} isso`
  } else {
    texto = `${nomes[0]}, ${nomes[1]} e mais ${nomes.length - 2} ${verboPlural} isso`
  }

  return (
    <div className="mt-3 flex items-center gap-2.5">
      <div className="flex -space-x-2 flex-shrink-0">
        {pessoas.slice(0, 5).map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/usuario/${p.id}`)}
            className="rounded-full border-2 border-bg overflow-hidden"
          >
            <UserAvatar fotoPerfil={p.foto_perfil} username={p.username} size={24} />
          </button>
        ))}
      </div>
      <span className="text-xs text-muted truncate">{texto}</span>
    </div>
  )
}
