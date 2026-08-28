import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, UserCog, UploadCloud } from 'lucide-react'
import TopBar from '../components/TopBar'
import SectionLabel from '../components/SectionLabel'

const ITENS_HUB = [
  {
    path: '/configuracoes/conta',
    titulo: 'Conta',
    descricao: 'Privacidade, dados pessoais e exclusão de conta',
    Icone: UserCog,
  },
  {
    path: '/configuracoes/importar',
    titulo: 'Importar Dados',
    descricao: 'Trazer seu histórico do TV Time (.zip)',
    Icone: UploadCloud,
  },
]

// Configurações agora é só um hub -- cada seção pesada (privacidade/dados
// pessoais/exclusão de conta, importação de dados) mora na própria página
// (ContaConfiguracoes.jsx, ImportarDados.jsx) em vez de tudo empilhado aqui.
export default function Configuracoes() {
  const navigate = useNavigate()

  return (
    <div className="flex-1 pb-10">
      <TopBar
        title="Configurações"
        rightSlot={
          <button onClick={() => navigate('/perfil')} className="text-muted">
            <ArrowLeft size={20} />
          </button>
        }
      />
      <SectionLabel>Geral</SectionLabel>
      <div className="mx-4 bg-surface rounded-2xl border border-white/5 divide-y divide-white/5">
        {ITENS_HUB.map(({ path, titulo, descricao, Icone }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="w-full p-4 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-colors"
          >
            <Icone size={20} className="text-teal flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-display font-medium text-sm text-ink">{titulo}</div>
              <div className="text-xs text-muted">{descricao}</div>
            </div>
            <ChevronRight size={18} className="text-muted flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
