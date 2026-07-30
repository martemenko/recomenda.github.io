import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import MobileShell from './components/MobileShell'
import BottomTabBar from './components/BottomTabBar'
import Login from './pages/Login'
import ContaConfirmada from './pages/ContaConfirmada'
import SeriesPage from './pages/SeriesPage'
import FilmesPage from './pages/FilmesPage'
import Explorar from './pages/Explorar'
import Perfil from './pages/Perfil'
import Configuracoes from './pages/Configuracoes'
import TituloDetalhe from './pages/TituloDetalhe'
import ListaDetalhe from './pages/ListaDetalhe'
import EpisodioDetalhe from './pages/EpisodioDetalhe'

function RotasPrivadas() {
  const { session } = useAuth()

  const confirmado = new URLSearchParams(window.location.search).get('confirmado') === '1'
  if (confirmado) {
    return (
      <MobileShell>
        <ContaConfirmada />
      </MobileShell>
    )
  }

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
        <Route path="/episodio/:id" element={<EpisodioDetalhe />} />
        <Route path="/lista/:id" element={<ListaDetalhe />} />
        <Route path="*" element={<Navigate to="/series" replace />} />
      </Routes>
      <RodapeCondicional />
    </MobileShell>
  )
}
// A barra inferior é mantida visível em todas as telas para facilitar navegação direta entre as abas principais
function RodapeCondicional() {
  return <BottomTabBar />
}
export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <RotasPrivadas />
      </AuthProvider>
    </HashRouter>
  )
}
