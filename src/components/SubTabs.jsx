export default function SubTabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 px-3 pt-1" role="tablist">
      {tabs.map((tab) => {
        const isActive = active === tab.value
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`flex-1 py-2.5 text-center font-display font-medium text-[13px] rounded-full transition-colors ${
              isActive ? 'text-bg bg-amber shadow-[0_0_14px_rgba(243,194,85,0.35)]' : 'text-muted'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
