export const POSTER_BASE = 'https://image.tmdb.org/t/p/w400'

// Imagens da TMDB vêm como path relativo (precisa prefixar POSTER_BASE); imagens
// da IGDB (jogos) já vêm como URL absoluta — usar direto.
export function resolverUrlImagem(imagem) {
  if (!imagem) return null
  return imagem.startsWith('http') ? imagem : `${POSTER_BASE}${imagem}`
}

// Capa de jogo (IGDB) fica pixelada no hero se usar o mesmo tamanho pequeno
// do grid (t_cover_big, ~264x374) — troca pela variante 2x só aqui, onde a
// imagem ocupa a largura inteira da tela.
export function resolverUrlImagemGrande(imagem) {
  const url = resolverUrlImagem(imagem)
  if (!url) return null
  return url.includes('images.igdb.com') ? url.replace('/t_cover_big/', '/t_cover_big_2x/') : url
}
