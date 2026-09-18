import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

// Carrega o script do Turnstile uma única vez (reaproveita se outra instância
// do widget já pediu isso antes), no mesmo estilo de carregarJSZip em
// ImportarDados.jsx.
function carregarTurnstileScript() {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile)
      return
    }
    const existente = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)
    if (existente) {
      existente.addEventListener('load', () => resolve(window.turnstile))
      existente.addEventListener('error', () => reject(new Error('Erro ao carregar o Turnstile.')))
      return
    }
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => reject(new Error('Erro ao carregar o Turnstile.'))
    document.head.appendChild(script)
  })
}

// Wrapper do Cloudflare Turnstile (CAPTCHA exigido no login/cadastro/OTP --
// ver [auth.captcha] em supabase/config.toml). Renderiza o widget e expõe o
// token via onVerify(token). Um token do Turnstile só vale uma tentativa: o
// componente pai deve chamar reset() (via ref) depois de cada envio, com
// sucesso ou erro, senão a próxima chamada ao Supabase falha.
const CaptchaWidget = forwardRef(function CaptchaWidget({ onVerify, onExpire }, ref) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let montado = true

    carregarTurnstileScript()
      .then((turnstile) => {
        if (!montado || !containerRef.current || widgetIdRef.current !== null) return
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onVerify?.(token),
          'expired-callback': () => {
            onVerify?.('')
            onExpire?.()
          },
          'error-callback': () => setErro('Não foi possível validar o CAPTCHA.'),
        })
      })
      .catch((err) => setErro(err.message))

    return () => {
      montado = false
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
      }
    },
  }))

  if (!SITE_KEY) return null

  return (
    <div>
      <div ref={containerRef} />
      {erro && <div className="text-danger text-xs font-mono mt-1">{erro}</div>}
    </div>
  )
})

export default CaptchaWidget
