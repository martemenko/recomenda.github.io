import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { callFunction } from '../lib/supabaseClient'

// Ponte entre um resultado de busca (identificado só pelo id externo da fonte,
// ex: tmdb_id) e a página real de detalhe (/titulo/:id, onde :id é o titulo_id
// interno). Desde que titulo.id passou a ser sintético (gerado pela sequence,
// não mais igual ao tmdb_id), não é mais seguro navegar direto pro id externo
// assumindo que ele vai bater com o titulo_id — então resolvemos/criamos o
// registro aqui primeiro e só então redirecionamos para o id real.
export default function TituloResolver() {
  const { externalId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [erro, setErro] = useState(false)

  const tipo = searchParams.get('tipo') || 'movie'

  useEffect(() => {
    resolver()
  }, [externalId, tipo])

  async function resolver() {
    setErro(false)
    const res = await callFunction('adicionar-titulo', {
      tmdb_id: Number(externalId),
      media_type: tipo,
      status: 'none',
    })

    if (res?.titulo_id) {
      navigate(`/titulo/${res.titulo_id}?tipo=${tipo}`, { replace: true })
    } else {
      setErro(true)
    }
  }

  if (erro) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted text-sm font-mono px-6 text-center">
        <p>Não foi possível abrir este título agora.</p>
        <button
          onClick={resolver}
          type="button"
          className="px-4 py-2 rounded-xl bg-surface border border-white/10 text-ink"
        >
          Tentar de novo
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center text-muted text-sm font-mono animate-pulse">
      Carregando…
    </div>
  )
}
