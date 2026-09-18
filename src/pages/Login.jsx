import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/auth'
import { avaliarForcaSenha } from '../lib/senhaForca'
import CaptchaWidget from '../components/CaptchaWidget'

const DURACAO_BLOQUEIO_INICIAL_MS = 60000 // 60s
const DURACAO_BLOQUEIO_MAX_MS = 300000 // 300s (5min)
const LIMITE_TENTATIVAS = 5
const COOLDOWN_REENVIO_MS = 30000 // 30s

// Cor da barra de força de senha por pontuação (0-4), usando os tokens já
// existentes em tailwind.config.js.
function corForcaSenha(pontuacao) {
  if (pontuacao >= 4) return 'bg-teal'
  if (pontuacao >= 2) return 'bg-amber'
  return 'bg-danger'
}

export default function Login() {
  const { entrarModoDemonstracao } = useAuth()
  const [modo, setModo] = useState('login') // 'login' | 'cadastro' | 'otp-solicitar' | 'otp-verificar'
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [cadastroFeito, setCadastroFeito] = useState(false)

  const [captchaToken, setCaptchaToken] = useState('')
  const captchaRef = useRef(null)

  // Bloqueio de tentativas de login por e-mail. É só um freio de UX --
  // reseta ao recarregar a página e não é uma barreira de segurança real.
  // A barreira de fato é o rate limit por IP do próprio Supabase
  // (auth.rate_limit em supabase/config.toml) somado ao CAPTCHA abaixo.
  const [tentativas, setTentativas] = useState({})
  const [reenviarBloqueadoAte, setReenviarBloqueadoAte] = useState(0)
  const [agora, setAgora] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const bloqueadoAte = tentativas[email]?.bloqueadoAte ?? 0
  const bloqueado = bloqueadoAte > agora
  const segundosBloqueio = bloqueado ? Math.ceil((bloqueadoAte - agora) / 1000) : 0

  const reenvioBloqueado = reenviarBloqueadoAte > agora
  const segundosReenvio = reenvioBloqueado ? Math.ceil((reenviarBloqueadoAte - agora) / 1000) : 0

  const forcaSenha = modo === 'cadastro' ? avaliarForcaSenha(senha) : null

  function registrarFalhaLogin(emailTentado) {
    setTentativas((prev) => {
      const atual = prev[emailTentado] ?? { count: 0, bloqueadoAte: 0, duracaoMs: DURACAO_BLOQUEIO_INICIAL_MS }
      const count = atual.count + 1
      if (count < LIMITE_TENTATIVAS) {
        return { ...prev, [emailTentado]: { ...atual, count } }
      }
      // Dobra a duração a cada novo bloqueio consecutivo (60s -> 120s -> 240s -> 300s no teto)
      const duracaoMs = Math.min(atual.duracaoMs * (atual.bloqueadoAte ? 2 : 1), DURACAO_BLOQUEIO_MAX_MS)
      return { ...prev, [emailTentado]: { count: 0, bloqueadoAte: Date.now() + duracaoMs, duracaoMs } }
    })
  }

  function resetarTentativas(emailOk) {
    setTentativas((prev) => {
      if (!(emailOk in prev)) return prev
      const { [emailOk]: _omitido, ...resto } = prev
      return resto
    })
  }

  function resetarCaptcha() {
    setCaptchaToken('')
    captchaRef.current?.reset()
  }

  function mudarModo(novoModo) {
    setModo(novoModo)
    setErro('')
    resetarCaptcha()
  }

  async function enviar(e) {
    e.preventDefault()
    setErro('')

    if (modo === 'cadastro') {
      if (senha !== confirmarSenha) {
        setErro('As senhas não são iguais.')
        return
      }
      if (!avaliarForcaSenha(senha).valido) {
        setErro('A senha precisa ter pelo menos 10 caracteres, com letra maiúscula, minúscula e número.')
        return
      }
    }

    if (modo === 'login' && bloqueado) {
      setErro(`Muitas tentativas. Tente novamente em ${segundosBloqueio}s.`)
      return
    }

    setCarregando(true)
    try {
      if (modo === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password: senha,
          options: { captchaToken },
        })
        if (error) {
          registrarFalhaLogin(email)
          throw error
        }
        resetarTentativas(email)
      } else {
        const redirectTo = `${window.location.origin}${window.location.pathname}?confirmado=1`
        const { error } = await supabase.auth.signUp({
          email,
          password: senha,
          options: { emailRedirectTo: redirectTo, captchaToken },
        })
        if (error) throw error
        setCadastroFeito(true)
      }
    } catch (err) {
      setErro(err.message)
    } finally {
      setCarregando(false)
      resetarCaptcha()
    }
  }

  async function solicitarOtp(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false, // sem isso, qualquer e-mail digitado criaria conta nova, pulando cadastro/senha
          captchaToken,
        },
      })
      if (error) throw error
      setModo('otp-verificar')
      setReenviarBloqueadoAte(Date.now() + COOLDOWN_REENVIO_MS)
    } catch (err) {
      setErro(err.message)
    } finally {
      setCarregando(false)
      resetarCaptcha()
    }
  }

  async function verificarOtp(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: codigo, type: 'email' })
      if (error) throw error
      // A partir daqui não precisa fazer mais nada: onAuthStateChange em
      // lib/auth.jsx pega a sessão nova automaticamente e App.jsx troca de
      // tela assim que `session` deixa de ser null.
    } catch (err) {
      setErro(err.message)
    } finally {
      setCarregando(false)
    }
  }

  async function reenviarCodigo() {
    if (reenvioBloqueado) return
    setErro('')
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      })
      if (error) throw error
      setReenviarBloqueadoAte(Date.now() + COOLDOWN_REENVIO_MS)
    } catch (err) {
      setErro(err.message)
    }
  }

  if (cadastroFeito) {
    return (
      <div className="flex-1 flex flex-col justify-center px-6 text-center">
        <h1 className="font-display font-semibold text-amber text-xl mb-2">Quase lá!</h1>
        <p className="text-sm text-ink leading-relaxed mb-1">
          Mandamos um e-mail de confirmação pra <strong>{email}</strong>.
        </p>
        <p className="text-xs text-muted">Clica no link recebido pra ativar sua conta.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-6">
      <h1 className="font-display font-semibold text-amber text-2xl text-center mb-1">
        ★ Recomenda Cine
      </h1>
      <p className="text-muted text-sm text-center mb-8">seu catálogo pessoal de séries e filmes</p>

      {(modo === 'login' || modo === 'cadastro') && (
        <form onSubmit={enviar} className="flex flex-col gap-3">
          <label className="sr-only" htmlFor="login-email">E-mail</label>
          <input
            id="login-email"
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
          />
          <label className="sr-only" htmlFor="login-senha">Senha</label>
          <input
            id="login-senha"
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            minLength={10}
            className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
          />
          {modo === 'cadastro' && (
            <>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${
                      i < forcaSenha.pontuacao ? corForcaSenha(forcaSenha.pontuacao) : 'bg-white/10'
                    }`}
                  />
                ))}
              </div>
              <ul className="text-[11px] text-muted font-mono grid grid-cols-2 gap-1">
                <li className={forcaSenha.criterios.tamanho ? 'text-teal' : ''}>10+ caracteres</li>
                <li className={forcaSenha.criterios.maiuscula ? 'text-teal' : ''}>1 letra maiúscula</li>
                <li className={forcaSenha.criterios.minuscula ? 'text-teal' : ''}>1 letra minúscula</li>
                <li className={forcaSenha.criterios.numero ? 'text-teal' : ''}>1 número</li>
              </ul>
              <label className="sr-only" htmlFor="login-confirmar-senha">Confirmar senha</label>
              <input
                id="login-confirmar-senha"
                type="password"
                placeholder="Confirmar senha"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                required
                minLength={10}
                className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
              />
            </>
          )}

          <CaptchaWidget ref={captchaRef} onVerify={setCaptchaToken} />

          {modo === 'login' && bloqueado && (
            <div className="text-danger text-xs font-mono">Tente novamente em {segundosBloqueio}s.</div>
          )}
          {erro && <div className="text-danger text-xs font-mono">{erro}</div>}
          <button
            type="submit"
            disabled={carregando || (modo === 'login' && bloqueado)}
            className="bg-amber text-bg font-display font-semibold text-sm rounded-2xl py-3 mt-2 shadow-[0_0_18px_rgba(243,194,85,0.35)] disabled:opacity-60"
          >
            {carregando ? 'Aguarde…' : modo === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      )}

      {modo === 'otp-solicitar' && (
        <form onSubmit={solicitarOtp} className="flex flex-col gap-3">
          <p className="text-muted text-xs text-center -mt-2 mb-1">
            Manda um código de 6 dígitos pro seu e-mail, sem precisar de senha.
          </p>
          <label className="sr-only" htmlFor="otp-email">E-mail</label>
          <input
            id="otp-email"
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted"
          />

          <CaptchaWidget ref={captchaRef} onVerify={setCaptchaToken} />

          {erro && <div className="text-danger text-xs font-mono">{erro}</div>}
          <button
            type="submit"
            disabled={carregando}
            className="bg-amber text-bg font-display font-semibold text-sm rounded-2xl py-3 mt-2 shadow-[0_0_18px_rgba(243,194,85,0.35)] disabled:opacity-60"
          >
            {carregando ? 'Aguarde…' : 'Enviar código'}
          </button>
        </form>
      )}

      {modo === 'otp-verificar' && (
        <form onSubmit={verificarOtp} className="flex flex-col gap-3">
          <p className="text-muted text-xs text-center -mt-2 mb-1">
            Digite o código de 6 dígitos que mandamos pra <strong>{email}</strong>.
          </p>
          <label className="sr-only" htmlFor="otp-codigo">Código de verificação</label>
          <input
            id="otp-codigo"
            type="text"
            inputMode="numeric"
            placeholder="000000"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            maxLength={6}
            className="bg-surface border border-white/10 rounded-2xl px-4 py-3 text-sm text-ink placeholder:text-muted text-center tracking-[0.3em] font-mono"
          />
          {erro && <div className="text-danger text-xs font-mono">{erro}</div>}
          <button
            type="submit"
            disabled={carregando || codigo.length !== 6}
            className="bg-amber text-bg font-display font-semibold text-sm rounded-2xl py-3 mt-2 shadow-[0_0_18px_rgba(243,194,85,0.35)] disabled:opacity-60"
          >
            {carregando ? 'Aguarde…' : 'Confirmar código'}
          </button>
          <button
            type="button"
            onClick={reenviarCodigo}
            disabled={reenvioBloqueado}
            className="text-muted text-xs font-mono text-center mt-1 disabled:opacity-50"
          >
            {reenvioBloqueado ? `Reenviar código (${segundosReenvio}s)` : 'Reenviar código'}
          </button>
        </form>
      )}

      {(modo === 'login' || modo === 'cadastro') && (
        <>
          <button
            onClick={() => mudarModo(modo === 'login' ? 'cadastro' : 'login')}
            className="text-muted text-xs font-mono text-center mt-5"
          >
            {modo === 'login' ? 'Não tem conta? Criar uma nova' : 'Já tem conta? Entrar'}
          </button>
          <button
            onClick={() => mudarModo('otp-solicitar')}
            className="text-muted text-xs font-mono text-center mt-2"
          >
            Entrar com código por e-mail
          </button>
        </>
      )}

      {(modo === 'otp-solicitar' || modo === 'otp-verificar') && (
        <button
          onClick={() => mudarModo('login')}
          className="text-muted text-xs font-mono text-center mt-5"
        >
          Voltar pro login com senha
        </button>
      )}

      <div className="mt-8 pt-6 border-t border-white/10 text-center">
        <button
          onClick={entrarModoDemonstracao}
          className="w-full bg-surface2 hover:bg-white/10 text-ink border border-white/10 font-display font-medium text-xs rounded-2xl py-3 transition-colors"
        >
          Entrar sem conta (Modo de Demonstração)
        </button>
      </div>
    </div>
  )
}
