const POSTER_BASE = 'https://image.tmdb.org/t/p/w200'

export default function EpisodioRow({ posterPath, tituloNome, temporada, episodio, episodioNome, marcado, onMarcar, onAbrirTitulo, saindo }) {
  return (
    <div
      className={`flex items-center gap-3 mx-4 mb-2.5 p-2.5 bg-surface rounded-2xl border border-white/5 transition-all duration-300 ease-out ${
        saindo ? 'opacity-0 scale-95 -translate-y-1' : 'opacity-100 scale-100 translate-y-0'
      }`}
    >
      <button onClick={onAbrirTitulo} className="w-14 h-14 flex-shrink-0 bg-surface2 rounded-xl overflow-hidden">
        {posterPath && (
          <img src={`${POSTER_BASE}${posterPath}`} alt={tituloNome} className="w-full h-full object-cover" />
        )}
      </button>
      <button onClick={onAbrirTitulo} className="flex-1 text-left min-w-0">
        <div className="text-[10.5px] font-display font-semibold text-amber uppercase truncate tracking-wide">{tituloNome}</div>
        <div className="font-display font-medium text-sm text-ink mt-0.5">
          T{String(temporada).padStart(2, '0')} · E{String(episodio).padStart(2, '0')}
        </div>
        <div className="text-xs text-muted truncate">{episodioNome}</div>
      </button>
      <button
        onClick={onMarcar}
        className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center border transition-colors ${
          marcado
            ? 'bg-teal border-teal text-bg shadow-[0_0_12px_rgba(221,13,244,0.5)]'
            : 'border-white/15 text-muted'
        }`}
        aria-label={marcado ? 'Marcado como assistido' : 'Marcar como assistido'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity={marcado ? 1 : 0.3} />
        </svg>
      </button>
    </div>
  )
}
