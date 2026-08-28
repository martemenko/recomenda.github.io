const IDADE_MINIMA = 13
const IDADE_MAXIMA = 120

// Validação compartilhada entre Onboarding.jsx e ContaConfiguracoes.jsx --
// mesmas regras que antes existiam pra idade (13-120), só que calculadas a
// partir da data de nascimento em vez de um número digitado direto.
export function validarDataNascimento(dataStr) {
  if (!dataStr) return { valido: false }
  const data = new Date(`${dataStr}T00:00:00`)
  if (Number.isNaN(data.getTime())) return { valido: false }

  const hoje = new Date()
  if (data > hoje) return { valido: false }

  let idade = hoje.getFullYear() - data.getFullYear()
  const aindaNaoFezAniversarioEsteAno =
    hoje.getMonth() < data.getMonth() ||
    (hoje.getMonth() === data.getMonth() && hoje.getDate() < data.getDate())
  if (aindaNaoFezAniversarioEsteAno) idade -= 1

  if (idade < IDADE_MINIMA || idade > IDADE_MAXIMA) return { valido: false }
  return { valido: true, idade }
}
