import Skeleton, { SkeletonLine, SkeletonCircle } from './Skeleton'

// Espelha o PosterCard: caixa aspect-[2/3] + uma linha de texto embaixo.
function SkeletonPoster({ className = '' }) {
  return (
    <div className={`flex flex-col w-full ${className}`}>
      <Skeleton className="w-full aspect-[2/3] rounded-2xl" />
      <SkeletonLine className="mt-1.5 w-3/4" />
    </div>
  )
}

// Grade 3 colunas usada em Explorar/FilmesPage/JogosPage enquanto a busca/lista carrega.
export function SkeletonPosterGrid({ count = 9 }) {
  return (
    <div className="grid grid-cols-3 gap-3 px-4 pb-6">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonPoster key={i} />
      ))}
    </div>
  )
}

// Prateleira horizontal (Top10, favoritos, etc.) enquanto carrega.
export function SkeletonShelf({ count = 6 }) {
  return (
    <div className="flex gap-3 px-4 pb-6 overflow-x-auto">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex-shrink-0 w-28">
          <SkeletonPoster />
        </div>
      ))}
    </div>
  )
}

// Linha de episódio (SeriesPage): thumbnail pequena + linhas de texto empilhadas + círculo à direita.
function SkeletonEpisodeRow() {
  return (
    <div className="bg-surface border border-white/5 rounded-2xl p-3 flex gap-3 items-center justify-between">
      <Skeleton className="w-14 aspect-[2/3] rounded-xl flex-shrink-0" />
      <div className="flex-1 flex flex-col justify-center min-w-0 gap-2">
        <SkeletonLine className="w-1/3" />
        <SkeletonLine className="w-2/3" />
        <SkeletonLine className="w-1/2" />
      </div>
      <SkeletonCircle className="w-10 h-10 flex-shrink-0" />
    </div>
  )
}

export function SkeletonEpisodeRows({ count = 4 }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonEpisodeRow key={i} />
      ))}
    </div>
  )
}

// Linha de item de lista (ListaDetalhe): thumbnail menor + uma única linha de texto.
function SkeletonListRow() {
  return (
    <div className="flex items-center gap-3 bg-surface border border-white/5 rounded-2xl p-2.5">
      <Skeleton className="w-11 aspect-[2/3] rounded-md flex-shrink-0" />
      <SkeletonLine className="flex-1" />
    </div>
  )
}

export function SkeletonListRows({ count = 5 }) {
  return (
    <div className="px-4 space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListRow key={i} />
      ))}
    </div>
  )
}

// Grade de estatísticas do Perfil: mesmas classes do StatCard, com duas linhas no lugar do valor/rótulo.
function SkeletonStatCard() {
  return (
    <div className="bg-surface border border-white/5 rounded-2xl px-3.5 py-3">
      <SkeletonLine className="w-12 h-4 mb-2" />
      <SkeletonLine className="w-20 h-2.5" />
    </div>
  )
}

export function SkeletonStatsGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 px-4 mb-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </div>
  )
}

// Cabeçalho do TituloDetalhe: poster cheio, título, meta, dois "pills" (ações) e parágrafo da sinopse.
export function SkeletonDetailHeader() {
  return (
    <div>
      <Skeleton className="w-full aspect-[2/3] rounded-none" />
      <div className="px-4 py-3">
        <SkeletonLine className="w-2/3 h-5 mb-3" />
        <SkeletonLine className="w-1/3 mb-4" />

        <div className="flex flex-col gap-2 mb-4">
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-3/4" />
        </div>

        <div className="flex items-center gap-2">
          <Skeleton className="flex-1 h-12 rounded-2xl" />
          <Skeleton className="w-12 h-12 rounded-2xl flex-shrink-0" />
        </div>
      </div>
    </div>
  )
}
