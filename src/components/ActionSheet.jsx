const TONE_CLASSES = {
  default: 'bg-surface2 text-ink hover:bg-white/5',
  primary: 'bg-teal/15 text-teal hover:bg-teal/25',
  danger: 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
}

// Bottom-sheet genérico: overlay + lista de opções + "Cancelar". Extraído do menu
// "Gerenciar série" que já existia só dentro de TituloDetalhe.jsx.
export default function ActionSheet({ open, title, options, onClose }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-white/10 rounded-t-2xl p-4 w-full max-w-[480px]"
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div className="text-xs text-muted font-mono uppercase mb-3 px-1">{title}</div>}
        <div className="flex flex-col gap-2">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={opt.onClick}
              className={`flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-display font-medium transition-colors ${
                TONE_CLASSES[opt.tone ?? 'default']
              }`}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full mt-2 py-2.5 text-sm text-muted font-display font-medium"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
