import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ThumbsUp, Laugh, Heart } from 'lucide-react'
import UserAvatar from './UserAvatar'
import ComentarioComposer from './ComentarioComposer'

const TIPOS_REACAO = [
  { tipo: 'curtir', Icon: ThumbsUp, label: 'Curtir', corAtiva: 'text-amber' },
  { tipo: 'rir', Icon: Laugh, label: 'Rir', corAtiva: 'text-teal', badgeAtivo: 'bg-teal' },
  { tipo: 'amei', Icon: Heart, label: 'Amei', corAtiva: 'text-heart' },
]

const DURACAO_PRESSIONAR_MS = 400

function formatarData(dataStr) {
  return new Date(dataStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// A carinha de rir tem olhos/boca desenhados na mesma cor do traço — preencher
// o ícone inteiro com currentColor esconde essas features dentro do preenchimento.
// Pra ela (e só pra ela, ThumbsUp/Heart ficam bem preenchidos normalmente), quando
// ativa desenha um selo com fundo roxo neon e a carinha em roxo escuro (cor do
// fundo da página) por cima, pra manter o traço do rosto visível.
function IconeReacao({ item, ativo, size }) {
  const { Icon, corAtiva, badgeAtivo } = item

  if (ativo && badgeAtivo) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-full ${badgeAtivo}`}
        style={{ width: size + 4, height: size + 4 }}
      >
        <Icon size={size} className="text-bg" strokeWidth={2.5} />
      </span>
    )
  }

  return <Icon size={size} className={ativo ? corAtiva : undefined} fill={ativo ? 'currentColor' : 'none'} />
}

// Botão único (estilo Facebook/LinkedIn): toque rápido alterna a reação atual
// (ou "curtir" se ainda não tinha nenhuma); pressionar e segurar abre um tray
// com os 3 tipos pra escolher — solta e toca no ícone desejado.
function BarraReacoes({ comentario, onReagir }) {
  const [trayAberto, setTrayAberto] = useState(false)
  const timerRef = useRef(null)
  const segurouRef = useRef(false)

  const minhaReacao = comentario.reacoes?.minhaReacao ?? null
  const totalReacoes = TIPOS_REACAO.reduce((soma, { tipo }) => soma + (comentario.reacoes?.[tipo] ?? 0), 0)
  const tipoAtual = TIPOS_REACAO.find((t) => t.tipo === minhaReacao)
  const itemPrincipal = tipoAtual ?? TIPOS_REACAO[0]

  function iniciarPressao() {
    segurouRef.current = false
    timerRef.current = setTimeout(() => {
      segurouRef.current = true
      setTrayAberto(true)
    }, DURACAO_PRESSIONAR_MS)
  }

  function cancelarPressao() {
    clearTimeout(timerRef.current)
  }

  function aoSoltar() {
    cancelarPressao()
    if (!segurouRef.current) {
      onReagir(comentario, minhaReacao ?? 'curtir')
    }
  }

  function escolher(tipo) {
    setTrayAberto(false)
    onReagir(comentario, tipo)
  }

  return (
    <div className="relative inline-block mt-1.5">
      <button
        onPointerDown={iniciarPressao}
        onPointerUp={aoSoltar}
        onPointerLeave={cancelarPressao}
        onContextMenu={(e) => e.preventDefault()}
        style={{ touchAction: 'manipulation' }}
        className={`flex items-center gap-1.5 text-xs font-display font-medium transition-colors select-none ${
          tipoAtual ? tipoAtual.corAtiva : 'text-muted hover:text-ink'
        }`}
      >
        <IconeReacao item={itemPrincipal} ativo={!!minhaReacao} size={14} />
        <span>{tipoAtual?.label ?? 'Curtir'}</span>
        {totalReacoes > 0 && <span className="text-muted">· {totalReacoes}</span>}
      </button>

      {trayAberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTrayAberto(false)} />
          <div className="absolute bottom-full left-0 mb-1.5 flex items-center gap-1 bg-surface border border-white/10 rounded-full px-2 py-1.5 shadow-lg z-50">
            {TIPOS_REACAO.map((item) => (
              <button
                key={item.tipo}
                onClick={() => escolher(item.tipo)}
                aria-label={item.label}
                className={`p-1.5 rounded-full hover:bg-white/10 hover:scale-110 transition-transform ${
                  minhaReacao === item.tipo ? item.corAtiva : 'text-ink'
                }`}
              >
                <IconeReacao item={item} ativo={minhaReacao === item.tipo} size={18} />
              </button>
            ))}
          </div>
        </>
      )}
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
        {comentario.texto && (
          <p className="text-sm text-ink/90 mt-0.5 whitespace-pre-wrap break-words">{comentario.texto}</p>
        )}
        {(comentario.imagem_url || comentario.gif_url) && (
          <img
            src={comentario.imagem_url || comentario.gif_url}
            alt=""
            loading="lazy"
            className="mt-1.5 max-w-[200px] max-h-[200px] rounded-xl border border-white/10 object-cover"
          />
        )}
        <BarraReacoes comentario={comentario} onReagir={onReagir} />
      </div>
    </div>
  )
}

export default function ComentarioThread({ thread, onResponder, onReagir }) {
  const navigate = useNavigate()
  const [respondendo, setRespondendo] = useState(false)

  async function enviarResposta(payload) {
    const ok = await onResponder(payload, thread.raiz.id)
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
