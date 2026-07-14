const POSTER_BASE = 'https://image.tmdb.org/t/p/w300'

export default function PosterCard({ imagem, nome, badge, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col text-left">
      <div className="aspect-[2/3] bg-surface2 rounded overflow-hidden relative">
        {imagem && <img src={`${POSTER_BASE}${imagem}`} alt={nome} className="w-full h-full object-cover" />}
        {badge && (
          <span className="absolute top-1.5 left-1.5 bg-bg/85 text-amber text-[9px] font-mono uppercase px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </div>
      <div className="text-xs text-ink mt-1.5 truncate">{nome}</div>
    </button>
  )
}
