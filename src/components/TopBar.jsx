export default function TopBar({ title, rightSlot }) {
  return (
    <header className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5 bg-gradient-to-b from-amber/[0.08] to-transparent">
      <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Recomenda" className="w-8 h-8 drop-shadow-[0_0_6px_rgba(243,194,85,0.55)]" />
      <h1 className="font-display font-semibold text-lg text-ink">{title}</h1>
      <div className="flex-1" />
      {rightSlot}
    </header>
  )
}
