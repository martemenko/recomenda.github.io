import { forwardRef } from 'react'
import { Star } from 'lucide-react'
import UserAvatar from './UserAvatar'
import { resolverUrlImagemGrande } from '../lib/image'

export const LARGURA_CARD = 1080
export const ALTURA_CARD = 1350

// Parede de tijolos roxa em CSS puro: 1ª camada faz as juntas horizontais
// (uma por fileira); 2ª e 3ª fazem as juntas verticais, cada uma com um
// ladrilho de 2 fileiras de altura e deslocada meio tijolo pra criar o
// padrão "amarração" (junta vertical alternando de lugar a cada fileira).
const FUNDO_TIJOLOS = {
  backgroundColor: '#4a1f6e',
  backgroundImage: [
    'linear-gradient(180deg, transparent calc(100% - 8px), #2a1044 calc(100% - 8px))',
    'linear-gradient(90deg, transparent calc(100% - 8px), #2a1044 calc(100% - 8px))',
    'linear-gradient(90deg, transparent calc(100% - 8px), #2a1044 calc(100% - 8px))',
  ].join(', '),
  backgroundSize: '240px 90px, 240px 180px, 240px 180px',
  backgroundPosition: '0 0, 0 0, 120px 90px',
}

// Template visual pro export de review em imagem (Fase 5). Layout com tamanho
// fixo em pixels (não usa classes do Tailwind) pra ficar determinístico
// independente do viewport — é capturado como PNG via html-to-image, não
// exibido em fluxo normal de página.
const ReviewShareCard = forwardRef(function ReviewShareCard(
  { titulo, username, fotoPerfil, nota, reviewTexto },
  ref
) {
  const posterUrl = resolverUrlImagemGrande(titulo?.imagem)

  return (
    <div
      ref={ref}
      style={{
        width: LARGURA_CARD,
        height: ALTURA_CARD,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 56,
        padding: 72,
        fontFamily: '"Fredoka", sans-serif',
        color: '#f5f0ff',
        boxSizing: 'border-box',
        ...FUNDO_TIJOLOS,
      }}
    >
      <div
        style={{
          width: 460,
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 40px 70px rgba(0,0,0,0.55)',
          border: '8px solid rgba(255,255,255,0.18)',
          alignSelf: 'center',
        }}
      >
        {posterUrl && (
          <img
            src={posterUrl}
            alt={titulo?.nome}
            style={{ width: '100%', display: 'block', aspectRatio: '2 / 3', objectFit: 'cover' }}
          />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <UserAvatar fotoPerfil={fotoPerfil} username={username} size={84} />
        <div>
          <div style={{ fontSize: 38, fontWeight: 600 }}>@{username}</div>
          <div style={{ fontSize: 30, color: '#c9b8e8' }}>{titulo?.nome}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <Star
            key={n}
            size={34}
            fill={n <= nota ? '#f3c255' : 'none'}
            color={n <= nota ? '#f3c255' : 'rgba(255,255,255,0.35)'}
          />
        ))}
      </div>

      {reviewTexto && (
        <p style={{ fontSize: 32, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{reviewTexto}</p>
      )}
    </div>
  )
})

export default ReviewShareCard
