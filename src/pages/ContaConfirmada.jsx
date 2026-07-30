import { useNavigate } from 'react-router-dom'

export default function ContaConfirmada() {
  const navigate = useNavigate()

  function irParaLogin() {
    // limpa o "?confirmado=1" da URL antes de seguir, pra não ficar preso nessa tela
    window.history.replaceState({}, '', window.location.pathname)
    navigate('/login')
  }

  return (
    <div className="flex-1 flex flex-col justify-center items-center px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-amber/15 border border-amber/40 flex items-center justify-center mb-5">
        <span className="text-3xl">✓</span>
      </div>
      <h1 className="font-display font-semibold text-amber text-xl mb-2">Conta confirmada!</h1>
      <p className="text-sm text-ink leading-relaxed mb-6 max-w-[280px]">
        Sua conta no Recomenda Cine já está ativa. Pode entrar normalmente.
      </p>
      <button
        onClick={irParaLogin}
        className="bg-amber text-bg font-display font-semibold text-sm rounded-2xl px-8 py-3 shadow-[0_0_18px_rgba(243,194,85,0.35)]"
      >
        Ir para o login
      </button>
    </div>
  )
}
