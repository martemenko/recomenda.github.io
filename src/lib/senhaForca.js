// Avaliação simples de força de senha, sem dependência externa (sem zxcvbn).
// Espelha as regras configuradas em supabase/config.toml
// (minimum_password_length = 10, password_requirements = "lower_upper_letters_digits").
export function avaliarForcaSenha(senha) {
  const criterios = {
    tamanho: senha.length >= 10,
    minuscula: /[a-z]/.test(senha),
    maiuscula: /[A-Z]/.test(senha),
    numero: /[0-9]/.test(senha),
  }

  const pontuacao = Object.values(criterios).filter(Boolean).length
  const valido = pontuacao === 4

  return { criterios, pontuacao, valido }
}
