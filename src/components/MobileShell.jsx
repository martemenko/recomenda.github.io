export default function MobileShell({ children }) {
  return (
    <div className="min-h-screen bg-black flex justify-center">
      <div className="w-full max-w-[480px] min-h-screen bg-bg relative flex flex-col text-ink">
        {children}
      </div>
    </div>
  )
}
