// Gera um Blob JPEG recortado a partir de uma imagem (objectURL) e da área de
// recorte em pixels retornada pelo onCropComplete do react-easy-crop.
export function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export async function getCroppedImg(imagemSrc, areaRecortePixels, larguraSaida = 800) {
  const imagem = await carregarImagem(imagemSrc)

  const escala = larguraSaida / areaRecortePixels.width
  const canvas = document.createElement('canvas')
  canvas.width = larguraSaida
  canvas.height = Math.round(areaRecortePixels.height * escala)

  const ctx = canvas.getContext('2d')
  ctx.drawImage(
    imagem,
    areaRecortePixels.x,
    areaRecortePixels.y,
    areaRecortePixels.width,
    areaRecortePixels.height,
    0,
    0,
    canvas.width,
    canvas.height
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem recortada.'))),
      'image/jpeg',
      0.9
    )
  })
}
