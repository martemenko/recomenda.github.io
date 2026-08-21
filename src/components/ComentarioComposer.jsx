import { useState } from 'react'

export default function ComentarioComposer({ onEnviar, placeholder = 'Escreva um comentário...', autoFocus = false }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar() {
    const valor = texto.trim()
    if (!valor || enviando) return
    setEnviando(true)
    const ok = await onEnviar(valor)
    setEnviando(false)
    if (ok) setTexto('')
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={placeholder}
        rows={2}
        autoFocus={autoFocus}
        className="w-full bg-surface2/40 border border-white/10 rounded-xl p-2.5 text-sm text-ink placeholder:text-muted/60 resize-none focus:outline-none focus:border-amber/40"
      />
      <button
        onClick={enviar}
        disabled={enviando || !texto.trim()}
        className="self-end px-3 py-1.5 bg-amber text-bg rounded-xl text-xs font-display font-semibold disabled:opacity-50"
      >
        {enviando ? 'Enviando…' : 'Comentar'}
      </button>
    </div>
  )
}
