import { forwardRef } from 'react'
import { Star } from 'lucide-react'
import UserAvatar from './UserAvatar'
import { resolverUrlImagemGrande } from '../lib/image'
import logoRecomendaCine from '../assets/share/logo-recomenda-cine.png'
import pipocaAsset from '../assets/share/pipoca.png'
import oculosAsset from '../assets/share/oculos.png'

export const LARGURA_CARD = 1080
export const ALTURA_CARD = 1350

const CORES = {
  navyDeep: '#0a0e21',
  brickJoint: '#050712',
  neonPink: '#ff2ec4',
  neonPurple: '#8b3dff',
  neonGold: '#ffd76a',
  inkWarm: '#f5f0ff',
  mutedLavender: '#a89fc9',
}

// Parede de tijolos azul-marinho em CSS puro (1ª camada = juntas horizontais,
// 2ª/3ª = juntas verticais em "amarração", mesma técnica da versão roxa
// anterior) + um glow roxo radial por trás do logo/pôster, aprovados no
// mockup de referência antes de portar aqui.
const FUNDO_TIJOLOS = {
  backgroundColor: CORES.navyDeep,
  backgroundImage: [
    `linear-gradient(180deg, transparent calc(100% - 7px), ${CORES.brickJoint} calc(100% - 7px))`,
    `linear-gradient(90deg, transparent calc(100% - 7px), ${CORES.brickJoint} calc(100% - 7px))`,
    `linear-gradient(90deg, transparent calc(100% - 7px), ${CORES.brickJoint} calc(100% - 7px))`,
    'radial-gradient(ellipse 900px 700px at 50% 30%, rgba(139, 61, 255, 0.16), transparent 70%)',
  ].join(', '),
  backgroundSize: '216px 84px, 216px 168px, 216px 168px, 100% 100%',
  backgroundPosition: '0 0, 0 0, 108px 84px, 0 0',
}

// Template visual pro export de review em imagem. Layout com tamanho fixo em
// pixels (não usa classes do Tailwind) pra ficar determinístico independente
// do viewport — é capturado como PNG via html-to-image, não exibido em fluxo
// normal de página. Estilo neon/cinema aprovado num mockup separado antes de
// portar pra cá (ver conversa da feature) -- logo e ícones de pipoca/óculos
// são os assets reais da pasta LOGO, não desenhos aproximados.
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
        alignItems: 'center',
        padding: '46px 70px 52px',
        fontFamily: '"Fredoka", sans-serif',
        color: CORES.inkWarm,
        boxSizing: 'border-box',
        overflow: 'hidden',
        ...FUNDO_TIJOLOS,
      }}
    >
      <img
        src={logoRecomendaCine}
        alt="Recomenda Cine"
        style={{ width: 330, height: 'auto', filter: 'drop-shadow(0 6px 22px rgba(0,0,0,0.45))', flexShrink: 0 }}
      />

      <div
        style={{
          position: 'relative',
          marginTop: 18,
          padding: 12,
          borderRadius: 22,
          background: `linear-gradient(145deg, ${CORES.neonPink}, ${CORES.neonPurple})`,
          boxShadow: `0 0 16px 2px rgba(255, 46, 196, 0.65), 0 0 38px 8px rgba(139, 61, 255, 0.45), 0 24px 48px rgba(0, 0, 0, 0.55)`,
        }}
      >
        <div
          style={{
            width: 340,
            aspectRatio: '2 / 3',
            borderRadius: 15,
            overflow: 'hidden',
            background: '#10143a',
          }}
        >
          {posterUrl && (
            <img
              src={posterUrl}
              alt={titulo?.nome}
              style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
            />
          )}
        </div>
        <img
          src={oculosAsset}
          alt=""
          style={{
            position: 'absolute',
            left: -22,
            bottom: 26,
            width: 96,
            transform: 'rotate(-6deg)',
            filter: 'drop-shadow(0 4px 14px rgba(0,0,0,0.5))',
          }}
        />
        <img
          src={pipocaAsset}
          alt=""
          style={{
            position: 'absolute',
            right: -26,
            bottom: -18,
            width: 74,
            transform: 'rotate(8deg)',
            filter: 'drop-shadow(0 4px 14px rgba(0,0,0,0.5))',
          }}
        />
      </div>

      <div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 18 }}>
        <UserAvatar fotoPerfil={fotoPerfil} username={username} size={60} />
        <div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>@{username}</div>
          <div style={{ fontSize: 21, color: CORES.mutedLavender, marginTop: 2 }}>{titulo?.nome}</div>
        </div>
      </div>

      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            fontSize: 25,
            fontWeight: 700,
            color: '#1a1440',
            background: CORES.neonGold,
            padding: '6px 16px',
            borderRadius: 999,
            boxShadow: '0 0 16px rgba(255, 215, 106, 0.6)',
          }}
        >
          {nota}/10
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <Star
              key={n}
              size={20}
              fill={n <= nota ? CORES.neonGold : 'none'}
              color={n <= nota ? CORES.neonGold : 'rgba(255,255,255,0.35)'}
            />
          ))}
        </div>
      </div>

      {reviewTexto && (
        <p style={{ marginTop: 26, maxWidth: 860, textAlign: 'center', fontSize: 27, lineHeight: 1.5, margin: '26px 0 0', whiteSpace: 'pre-wrap' }}>
          <span style={{ color: CORES.neonPink, fontSize: 31 }}>&ldquo;</span>
          {reviewTexto}
          <span style={{ color: CORES.neonPink, fontSize: 31 }}>&rdquo;</span>
        </p>
      )}
    </div>
  )
})

export default ReviewShareCard
