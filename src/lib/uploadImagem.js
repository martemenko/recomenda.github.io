import { supabase } from './supabaseClient'

const TAMANHO_MAX_MB = 8
const MIME_PERMITIDOS = { 'image/jpeg': 'jpg', 'image/png': 'png' }

// Upload genérico de imagem pra um bucket público -- mesma validação
// (mimetype + tamanho) e padrão de path ({user_id}/arquivo) já usados pelo
// avatar/capa em Perfil.jsx, generalizado pra qualquer bucket/arquivo. Ao
// contrário do avatar/capa (upsert num path fixo, um arquivo por usuário),
// aqui cada upload gera seu próprio nome (`nomeArquivo`) -- útil quando um
// usuário tem múltiplos arquivos no mesmo bucket, como imagens de
// comentário.
export async function enviarImagemParaBucket({ file, bucket, userId, nomeArquivo }) {
  if (!file || !userId) return { url: null, error: new Error('Arquivo ou usuário ausente.') }

  const extensao = MIME_PERMITIDOS[file.type]
  if (!extensao) {
    return { url: null, error: new Error('Selecione uma imagem JPEG ou PNG.') }
  }
  if (file.size > TAMANHO_MAX_MB * 1024 * 1024) {
    return { url: null, error: new Error(`A imagem precisa ter no máximo ${TAMANHO_MAX_MB}MB.`) }
  }

  const nome = nomeArquivo ?? crypto.randomUUID()
  const path = `${userId}/${nome}.${extensao}`

  const { error: erroUpload } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type })

  if (erroUpload) return { url: null, error: erroUpload }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}

// Wrapper específico pro bucket de imagens de comentário (ver migração
// 20260828040000_comentario_anexos.sql) -- usado por TituloDetalhe.jsx e
// EpisodioDetalhe.jsx antes de chamar postarComentario. `file` pode ser
// null/undefined (comentário sem imagem), nesse caso não faz nada.
export async function enviarImagemComentario(file, userId) {
  if (!file) return { url: null, error: null }
  const { url, error } = await enviarImagemParaBucket({ file, bucket: 'comentario_imagens', userId })
  if (error) {
    console.error('[enviarImagemComentario] Erro ao enviar imagem:', error)
    alert(error.message ?? 'Não foi possível enviar a imagem.')
  }
  return { url, error }
}
