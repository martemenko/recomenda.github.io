export default function SectionLabel({ children, className = '' }) {
  return (
    <div className={`px-4 pt-3 pb-1 text-[12px] font-display font-semibold uppercase tracking-wide text-amber ${className}`}>
      {children}
    </div>
  )
}
