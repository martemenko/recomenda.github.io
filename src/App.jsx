import { lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import MobileShell from './components/MobileShell'
import BottomTabBar from './components/BottomTabBar'

const Login = lazy(() => import('./pages/Login'))
const ContaConfirmada = lazy(() => import('./pages/ContaConfirmada'))
const SeriesPage = lazy(() => import('./pages/SeriesPage'))
const FilmesPage = lazy(() => import('./pages/FilmesPage'))
const Explorar = lazy(() => import('./pages/Explorar'))
const Perfil = lazy(() => import('./pages/Perfil'))
const Configuracoes = lazy(() => import('./pages/Configuracoes'))
const TituloDetalhe = lazy(() => import('./pages/TituloDetalhe'))
const ListaDetalhe = lazy(() => import('./pages/ListaDetalhe'))
const EpisodioDetalhe = lazy(() => import('./pages/EpisodioDetalhe'))

function LoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted text-sm font-mono animate-pulse">
      Carregando...
    </div>
  )
}

function RotasPrivadas() {
  const { session } = useAuth()

  const confirmado = new URLSearchParams(window.location.search).get('confirmado') === '1'
  if (confirmado) {
    return (
      <MobileShell>
        <Suspense fallback={<LoadingFallback />}>
          <ContaConfirmada />
        </Suspense>
      </MobileShell>
    )
  }

  if (session === undefined) {
    return (
      <MobileShell>
        <LoadingFallback />
      </MobileShell>
    )
  }
  if (!session) {
    return (
      <MobileShell>
        <Suspense fallback={<LoadingFallback />}>
          <Login />
        </Suspense>
      </MobileShell>
    )
  }
  return (
    <MobileShell>
      <Suspense fallback={<LoadingFallback />}>
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
      </Suspense>
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
