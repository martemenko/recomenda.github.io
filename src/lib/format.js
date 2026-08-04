// Intercala duas listas já ordenadas por relevância dentro de cada fonte (posição
// 0 de A, posição 0 de B, posição 1 de A, ...), em vez de simplesmente concatenar.
// Usado pra misturar resultados de busca de fontes diferentes (TMDB + IGDB) sem
// deixar uma fonte sempre engolir o topo da lista, mesmo quando pouco relevante.
export function intercalar(listaA, listaB) {
  const resultado = []
  const tamanho = Math.max(listaA.length, listaB.length)
  for (let i = 0; i < tamanho; i++) {
    if (i < listaA.length) resultado.push(listaA[i])
    if (i < listaB.length) resultado.push(listaB[i])
  }
  return resultado
}

export function formatarDuracao(totalMinutos) {
  if (!totalMinutos || totalMinutos <= 0) return { partes: { anos: 0, meses: 0, dias: 0, horas: 0 }, texto: '0 horas' }

  let horasTotais = Math.floor(totalMinutos / 60)
  const HORAS_ANO = 24 * 365
  const HORAS_MES = 24 * 30
  const HORAS_DIA = 24

  const anos = Math.floor(horasTotais / HORAS_ANO); horasTotais %= HORAS_ANO
  const meses = Math.floor(horasTotais / HORAS_MES); horasTotais %= HORAS_MES
  const dias = Math.floor(horasTotais / HORAS_DIA); horasTotais %= HORAS_DIA
  const horas = horasTotais

  const partes = []
  if (anos) partes.push(`${anos} ano${anos > 1 ? 's' : ''}`)
  if (meses) partes.push(`${meses} ${meses > 1 ? 'meses' : 'mês'}`)
  if (dias) partes.push(`${dias} dia${dias > 1 ? 's' : ''}`)
  if (horas || partes.length === 0) partes.push(`${horas} hora${horas !== 1 ? 's' : ''}`)

  return { partes: { anos, meses, dias, horas }, texto: partes.join(', ') }
}
