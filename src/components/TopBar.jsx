export default function TopBar({ title, rightSlot }) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-surface2">
      <h1 className="font-display uppercase tracking-wide text-amber text-lg">{title}</h1>
      {rightSlot}
    </header>
  )
}
