export default function Skeleton({ className = '' }) {
  return <div className={`bg-surface2 animate-pulse rounded-xl ${className}`} aria-hidden="true" />
}

export function SkeletonLine({ className = '' }) {
  return <Skeleton className={`h-3 rounded-full ${className}`} />
}

export function SkeletonCircle({ className = '' }) {
  return <Skeleton className={`rounded-full ${className}`} />
}
