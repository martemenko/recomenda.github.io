export default function MobileShell({ children }) {
  return (
    <div className="h-screen bg-black flex justify-center overflow-hidden">
      <div className="w-full max-w-[480px] h-screen bg-bg relative flex flex-col text-ink overflow-hidden">
        {children}
      </div>
    </div>
  )
}
