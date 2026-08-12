// Gera um Blob (PNG para foto redonda com transparência, JPEG para retangular) 
// a partir de uma imagem (objectURL) e da área de recorte em pixels.
export function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

/**
 * Recorta a imagem recebida do react-easy-crop.
 * @param {string} imagemSrc - URL temporária da imagem (objectURL)
 * @param {object} areaRecortePixels - Coordenadas e dimensões em pixels (x, y, width, height)
 * @param {boolean} isRound - Define se o corte deve ser circular (avatar) ou retangular (capa)
 * @param {number} larguraSaida - Largura final desejada para o arquivo processado
 * @returns {Promise<{blob: Blob, mimeType: string, extension: string}>}
 */
export async function getCroppedImg(imagemSrc, areaRecortePixels, isRound = false, larguraSaida = 800) {
  const imagem = await carregarImagem(imagemSrc)

  const escala = larguraSaida / areaRecortePixels.width
  const alturaSaida = Math.round(areaRecortePixels.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = larguraSaida
  canvas.height = isRound ? larguraSaida : alturaSaida

  const ctx = canvas.getContext('2d')

  if (isRound) {
    // Aplica a máscara circular no canvas antes de desenhar
    ctx.save()
    ctx.beginPath()
    ctx.arc(larguraSaida / 2, larguraSaida / 2, larguraSaida / 2, 0, Math.PI * 2, true)
    ctx.closePath()
    ctx.clip()

    ctx.drawImage(
      imagem,
      areaRecortePixels.x,
      areaRecortePixels.y,
      areaRecortePixels.width,
      areaRecortePixels.height,
      0,
      0,
      larguraSaida,
      larguraSaida
    )
    ctx.restore()
  } else {
    // Desenho retangular padrão para capa
    ctx.drawImage(
      imagem,
      areaRecortePixels.x,
      areaRecortePixels.y,
      areaRecortePixels.width,
      areaRecortePixels.height,
      0,
      0,
      larguraSaida,
      alturaSaida
    )
  }

  // PNG para redonda (suporta transparência fora do círculo), JPEG para retangular
  const mimeType = isRound ? 'image/png' : 'image/jpeg'
  const extension = isRound ? 'png' : 'jpg'

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, mimeType, extension }) : reject(new Error('Falha ao gerar a imagem recortada.'))),
      mimeType,
      0.9
    )
  })
}
