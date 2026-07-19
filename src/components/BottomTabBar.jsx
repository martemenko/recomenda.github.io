import { NavLink } from 'react-router-dom'
import { Tv, Film, Search, User } from 'lucide-react'

const abas = [
  { to: '/series', label: 'Séries', icon: Tv },
  { to: '/filmes', label: 'Filmes', icon: Film },
  { to: '/explorar', label: 'Explorar', icon: Search },
  { to: '/perfil', label: 'Perfil', icon: User },
]

export default function BottomTabBar() {
  return (
    <nav className="sticky bottom-0 left-0 right-0 bg-bg/95 backdrop-blur border-t border-white/5 flex px-2 pb-2 pt-1.5">
      {abas.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-1 py-2 rounded-2xl text-[11px] font-display font-medium ${
              isActive ? 'text-amber' : 'text-muted'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                size={20}
                strokeWidth={2.2}
                className={isActive ? 'drop-shadow-[0_0_6px_rgba(243,194,85,0.6)]' : ''}
              />
              {label}
              <span
                className={`w-1 h-1 rounded-full transition-opacity ${
                  isActive ? 'bg-amber opacity-100 shadow-[0_0_6px_#f3c255]' : 'opacity-0'
                }`}
              />
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
