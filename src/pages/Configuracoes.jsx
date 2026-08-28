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

      <SectionLabel>Sobre</SectionLabel>
      <div className="mx-4 p-4 bg-surface rounded-2xl border border-white/5 space-y-3">
        {/* TODO: trocar por <img src={logoTmdb} .../> assim que tivermos o
            logo oficial da TMDB (baixado do site deles, ver conversa sobre
            atribuição) -- o texto abaixo já cumpre a exigência do disclaimer,
            mas o logo também é obrigatório nos termos de uso da API. */}
        <p className="text-[11px] text-muted leading-relaxed">
          This app uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise
          approved by TMDB.
        </p>
        {/* TODO: trocar por <img src={logoIgdb} .../> com o logo oficial (ver
            press kit em igdb.com/press) assim que tivermos o arquivo -- a
            exigência de atribuição da IGDB pede logo + este texto. Confirmar
            a wording exata (e o que muda com um acordo comercial assinado)
            direto no press kit deles antes de publicar, já que não consegui
            abrir aquela página aqui pra conferir a citação literal. */}
        <p className="text-[11px] text-muted leading-relaxed">
          Game data provided by IGDB.com.
        </p>
      </div>
    </div>
  )
}
