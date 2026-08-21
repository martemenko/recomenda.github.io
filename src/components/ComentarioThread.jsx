import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ThumbsUp, Laugh, Heart } from 'lucide-react'
import UserAvatar from './UserAvatar'
import ComentarioComposer from './ComentarioComposer'

const TIPOS_REACAO = [
  { tipo: 'curtir', Icon: ThumbsUp },
  { tipo: 'rir', Icon: Laugh },
  { tipo: 'amei', Icon: Heart },
]

function formatarData(dataStr) {
  return new Date(dataStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function BarraReacoes({ comentario, onReagir }) {
  return (
    <div className="flex items-center gap-3 mt-1.5">
      {TIPOS_REACAO.map(({ tipo, Icon }) => {
        const contagem = comentario.reacoes?.[tipo] ?? 0
        const ativa = comentario.reacoes?.minhaReacao === tipo
        return (
          <button
            key={tipo}
            onClick={() => onReagir(comentario, tipo)}
            className={`flex items-center gap-1 text-xs font-display font-medium transition-colors ${
              ativa ? 'text-amber' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon size={14} fill={ativa ? 'currentColor' : 'none'} />
            {contagem > 0 && <span>{contagem}</span>}
          </button>
        )
      })}
    </div>
  )
}

function LinhaComentario({ comentario, navigate, onReagir, indentado }) {
  return (
    <div className={`flex gap-2.5 ${indentado ? 'pl-8' : ''}`}>
      <button onClick={() => navigate(`/usuario/${comentario.user_id}`)} className="flex-shrink-0">
        <UserAvatar fotoPerfil={comentario.autor?.foto_perfil} username={comentario.autor?.username} size={32} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => navigate(`/usuario/${comentario.user_id}`)}
            className="text-xs font-display font-semibold text-ink hover:underline"
          >
            @{comentario.autor?.username ?? '...'}
          </button>
          <span className="text-[10px] text-muted">{formatarData(comentario.created_at)}</span>
        </div>
        <p className="text-sm text-ink/90 mt-0.5 whitespace-pre-wrap break-words">{comentario.texto}</p>
        <BarraReacoes comentario={comentario} onReagir={onReagir} />
      </div>
    </div>
  )
}

export default function ComentarioThread({ thread, onResponder, onReagir }) {
  const navigate = useNavigate()
  const [respondendo, setRespondendo] = useState(false)

  async function enviarResposta(texto) {
    const ok = await onResponder(texto, thread.raiz.id)
    if (ok) setRespondendo(false)
    return ok
  }

  return (
    <div className="py-3 border-b border-white/5">
      <LinhaComentario comentario={thread.raiz} navigate={navigate} onReagir={onReagir} />

      <div className="pl-8 mt-1">
        <button
          onClick={() => setRespondendo((v) => !v)}
          className="text-[11px] font-display font-medium text-muted hover:text-ink"
        >
          Responder
        </button>
      </div>

      {thread.respostas.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          {thread.respostas.map((r) => (
            <LinhaComentario key={r.id} comentario={r} navigate={navigate} onReagir={onReagir} indentado />
          ))}
        </div>
      )}

      {respondendo && (
        <div className="pl-8 mt-2.5">
          <ComentarioComposer onEnviar={enviarResposta} placeholder="Escreva uma resposta..." autoFocus />
        </div>
      )}
    </div>
  )
}
