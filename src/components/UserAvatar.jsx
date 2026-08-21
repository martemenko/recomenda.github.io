export default function UserAvatar({ fotoPerfil, username, size = 40 }) {
  return (
    <div
      className="rounded-full bg-surface2 overflow-hidden flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {fotoPerfil ? (
        <img
          src={fotoPerfil}
          alt={username ? `Foto de ${username}` : 'Foto de perfil'}
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          className="font-display font-semibold text-muted"
          style={{ fontSize: size * 0.4 }}
        >
          {username?.[0]?.toUpperCase() ?? '?'}
        </span>
      )}
    </div>
  )
}
