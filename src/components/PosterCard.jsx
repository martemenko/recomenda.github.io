const POSTER_BASE = 'https://image.tmdb.org/t/p/w300'

export default function PosterCard({ imagem, nome, badge, onClick }) {
  return (
    /* Adicionada a classe w-full no botão raiz */
    <button onClick={onClick} className="flex flex-col text-left w-full">
      {/* Adicionada a classe w-full no contêiner da imagem */}
      <div className="w-full aspect-[2/3] bg-surface2 rounded-2xl overflow-hidden relative shadow-[0_6px_18px_rgba(0,0,0,0.35)]">
        {imagem && <img src={`${POSTER_BASE}${imagem}`} alt={nome} className="w-full h-full object-cover" />}
        {badge && (
          <span className="absolute top-1.5 left-1.5 bg-bg/85 border border-amber/30 text-amber text-[9px] font-mono uppercase px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      {/* Adicionada a classe w-full para forçar o truncate a funcionar com base no limite do wrapper */}
      <div className="w-full text-[11.5px] text-ink mt-1.5 truncate">{nome}</div>
    </button>
  )
}
