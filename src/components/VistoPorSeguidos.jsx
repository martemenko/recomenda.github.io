import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import UserAvatar from './UserAvatar'
import SectionLabel from './SectionLabel'

// "Quem mais viu isso" -- só considera quem o usuário logado segue, lendo
// user_item_publico/watched_episode_publico (views que já respeitam a
// privacidade de histórico de cada um -- só aparece aqui quem realmente
// permitiu compartilhar o próprio histórico, ver migração
// 20260828030000_privacidade_por_excecao.sql) em vez das tabelas base.
export default function VistoPorSeguidos({ tituloId, episodeId, tipo = 'assistiu' }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [pessoas, setPessoas] = useState([])
  const [listaAberta, setListaAberta] = useState(false)

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

  function irParaPerfil(id) {
    setListaAberta(false)
    navigate(`/usuario/${id}`)
  }

  if (!user || pessoas.length === 0) return null

  const verboSingular = tipo === 'jogou' ? 'jogou' : 'assistiu'
  const verboPlural = tipo === 'jogou' ? 'jogaram' : 'assistiram'
  const tituloSecao = tipo === 'jogou' ? 'Quem mais jogou isso' : 'Quem mais viu isso'
  const restante = pessoas.length - 2

  return (
    <div className="mt-4">
      <SectionLabel className="!px-0 !pt-0 !pb-1">{tituloSecao}</SectionLabel>

      <div className="flex items-center gap-2.5">
        <div className="flex -space-x-2 flex-shrink-0">
          {pessoas.slice(0, 5).map((p) => (
            <button
              key={p.id}
              onClick={() => irParaPerfil(p.id)}
              className="rounded-full border-2 border-bg overflow-hidden"
            >
              <UserAvatar fotoPerfil={p.foto_perfil} username={p.username} size={24} />
            </button>
          ))}
        </div>

        <span className="text-xs text-muted truncate">
          {pessoas.length === 1 && <>@{pessoas[0].username} {verboSingular} isso</>}
          {pessoas.length === 2 && (
            <>
              @{pessoas[0].username} e @{pessoas[1].username} {verboPlural} isso
            </>
          )}
          {pessoas.length > 2 && (
            <>
              @{pessoas[0].username}, @{pessoas[1].username} e{' '}
              <button onClick={() => setListaAberta(true)} className="text-ink font-medium underline underline-offset-2">
                mais {restante}
              </button>{' '}
              {verboPlural} isso
            </>
          )}
        </span>
      </div>

      {listaAberta && (
        <div className="fixed inset-0 bg-bg z-50 flex flex-col max-w-[480px] mx-auto w-full left-0 right-0">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 flex-shrink-0">
            <button onClick={() => setListaAberta(false)} className="text-muted">
              <ArrowLeft size={20} />
            </button>
            <div className="text-base text-ink font-display font-semibold">{tituloSecao}</div>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area px-4 py-2">
            {pessoas.map((p) => (
              <button
                key={p.id}
                onClick={() => irParaPerfil(p.id)}
                className="w-full flex items-center gap-3 py-2.5 border-b border-white/5 text-left"
              >
                <UserAvatar fotoPerfil={p.foto_perfil} username={p.username} size={40} />
                <span className="text-sm text-ink font-display font-medium">@{p.username}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
