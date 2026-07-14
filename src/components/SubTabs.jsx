export default function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="flex border-b border-surface2">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`flex-1 py-3 text-center font-display uppercase tracking-wide text-sm border-b-2 ${
            active === tab.value ? 'text-ink border-amber' : 'text-muted border-transparent'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
