export default function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 px-3 pt-1">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`flex-1 py-2.5 text-center font-display font-medium text-[13px] rounded-full transition-colors ${
            active === tab.value ? 'text-bg bg-amber shadow-[0_0_14px_rgba(243,194,85,0.35)]' : 'text-muted'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
