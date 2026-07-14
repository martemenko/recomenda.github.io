import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import MobileShell from './components/MobileShell'
import BottomTabBar from './components/BottomTabBar'
import Login from './pages/Login'
import SeriesPage from './pages/SeriesPage'
import FilmesPage from './pages/FilmesPage'
import Explorar from './pages/Explorar'
import Perfil from './pages/Perfil'
import Configuracoes from './pages/Configuracoes'
import TituloDetalhe from './pages/TituloDetalhe'

function RotasPrivadas() {
  const { session } = useAuth()

  if (session === undefined) {
    return (
      <MobileShell>
        <div className="flex-1 flex items-center justify-center text-muted text-sm font-mono">Carregando…</div>
      </MobileShell>
    )
  }

  if (!session) {
    return (
      <MobileShell>
        <Login />
      </MobileShell>
    )
  }

  return (
    <MobileShell>
      <Routes>
        <Route path="/series" element={<SeriesPage />} />
        <Route path="/filmes" element={<FilmesPage />} />
        <Route path="/explorar" element={<Explorar />} />
        <Route path="/perfil" element={<Perfil />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="/titulo/:id" element={<TituloDetalhe />} />
        <Route path="*" element={<Navigate to="/series" replace />} />
      </Routes>
      <RodapeCondicional />
    </MobileShell>
  )
}

// A barra inferior não aparece em telas de detalhe/configurações, só nas 4 abas principais
function RodapeCondicional() {
  const { pathname } = useLocation()
  const abasPrincipais = ['/series', '/filmes', '/explorar', '/perfil']
  if (!abasPrincipais.some((a) => pathname.startsWith(a))) return null
  return <BottomTabBar />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RotasPrivadas />
      </AuthProvider>
    </BrowserRouter>
  )
}
