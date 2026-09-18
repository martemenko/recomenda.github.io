import { useEffect, useRef } from 'react'

// Hook de acessibilidade reutilizável para modais/bottom-sheets do padrão
// "fixed inset-0" (ActionSheet, GifPicker, modais de imagem etc.): fecha com
// Escape (mesmo handler do clique fora), prende o foco dentro do painel
// (Tab/Shift+Tab ciclando entre o primeiro e o último botão focável), foca o
// primeiro botão focável ao abrir, e devolve o foco pro elemento que estava
// focado antes de abrir quando fecha/desmonta.
//
// Uso: const containerRef = useRef(null); useDialogA11y({ open, onClose, containerRef })
// e coloque containerRef no elemento do painel (não no overlay de fundo).
export default function useDialogA11y({ open, onClose, containerRef }) {
  const elementoAnteriorRef = useRef(null)
  // Guarda a versão mais recente de onClose num ref (em vez de listar como
  // dependência do efeito) -- assim um onClose inline (recriado a cada render
  // do componente pai, ex.: `onClose={() => setX(null)}`) não faz o efeito
  // reabrir e roubar o foco de volta pro primeiro botão a cada render
  // enquanto o diálogo já está aberto.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return

    elementoAnteriorRef.current = document.activeElement

    function focaveis() {
      if (!containerRef?.current) return []
      return Array.from(containerRef.current.querySelectorAll('button'))
    }

    const primeiro = focaveis()[0]
    primeiro?.focus()

    function aoTeclar(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current?.()
        return
      }

      if (e.key === 'Tab') {
        const itens = focaveis()
        if (itens.length === 0) return
        const primeiroItem = itens[0]
        const ultimoItem = itens[itens.length - 1]

        if (e.shiftKey && document.activeElement === primeiroItem) {
          e.preventDefault()
          ultimoItem.focus()
        } else if (!e.shiftKey && document.activeElement === ultimoItem) {
          e.preventDefault()
          primeiroItem.focus()
        }
      }
    }

    document.addEventListener('keydown', aoTeclar)

    return () => {
      document.removeEventListener('keydown', aoTeclar)
      elementoAnteriorRef.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, containerRef])
}
