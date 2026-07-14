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
    <nav className="sticky bottom-0 left-0 right-0 bg-surface border-t border-surface2 flex">
      {abas.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-mono ${
              isActive ? 'text-amber' : 'text-muted'
            }`
          }
        >
          <Icon size={20} strokeWidth={2} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
