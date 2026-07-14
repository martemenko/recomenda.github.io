const POSTER_BASE = 'https://image.tmdb.org/t/p/w200'

export default function EpisodioRow({ posterPath, tituloNome, temporada, episodio, episodioNome, marcado, onMarcar, onAbrirTitulo }) {
  return (
    <div className="flex items-stretch border-b border-surface2">
      <button onClick={onAbrirTitulo} className="w-20 flex-shrink-0 bg-surface2">
        {posterPath && (
          <img src={`${POSTER_BASE}${posterPath}`} alt={tituloNome} className="w-full h-full object-cover" />
        )}
      </button>
      <button onClick={onAbrirTitulo} className="flex-1 text-left px-3 py-2.5 min-w-0">
        <div className="text-[11px] font-mono text-amber uppercase truncate">{tituloNome}</div>
        <div className="font-display text-sm text-ink mt-0.5">
          T{String(temporada).padStart(2, '0')} | E{String(episodio).padStart(2, '0')}
        </div>
        <div className="text-xs text-muted truncate">{episodioNome}</div>
      </button>
      <button
        onClick={onMarcar}
        className={`w-14 flex-shrink-0 flex items-center justify-center ${marcado ? 'text-teal' : 'text-muted'}`}
        aria-label={marcado ? 'Marcado como assistido' : 'Marcar como assistido'}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
          {marcado && <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
      </button>
    </div>
  )
}
