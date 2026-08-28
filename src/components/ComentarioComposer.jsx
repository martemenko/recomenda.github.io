import { useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import GifPicker from './GifPicker'

export default function ComentarioComposer({ onEnviar, placeholder = 'Escreva um comentário...', autoFocus = false }) {
  const [texto, setTexto] = useState('')
  const [imagemFile, setImagemFile] = useState(null)
  const [imagemPreview, setImagemPreview] = useState(null)
  const [gifUrl, setGifUrl] = useState(null)
  const [gifPickerAberto, setGifPickerAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const inputArquivoRef = useRef(null)

  const temConteudo = texto.trim() || imagemFile || gifUrl

  function selecionarImagem(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      alert('Selecione uma imagem JPEG ou PNG.')
      return
    }
    setGifUrl(null)
    setImagemFile(file)
    setImagemPreview(URL.createObjectURL(file))
  }

  function removerImagem() {
    setImagemFile(null)
    setImagemPreview(null)
  }

  function escolherGif(url) {
    setImagemFile(null)
    setImagemPreview(null)
    setGifUrl(url)
    setGifPickerAberto(false)
  }

  async function enviar() {
    if (!temConteudo || enviando) return
    setEnviando(true)
    const ok = await onEnviar({ texto: texto.trim(), imagemFile, gifUrl })
    setEnviando(false)
    if (ok) {
      setTexto('')
      removerImagem()
      setGifUrl(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={placeholder}
        rows={2}
        autoFocus={autoFocus}
        className="w-full bg-surface2/40 border border-white/10 rounded-xl p-2.5 text-sm text-ink placeholder:text-muted/60 resize-none focus:outline-none focus:border-amber/40"
      />

      {(imagemPreview || gifUrl) && (
        <div className="relative w-24">
          <img src={imagemPreview || gifUrl} alt="" className="w-24 h-24 object-cover rounded-lg border border-white/10" />
          <button
            onClick={() => { removerImagem(); setGifUrl(null) }}
            aria-label="Remover"
            className="absolute -top-1.5 -right-1.5 bg-bg border border-white/10 rounded-full p-0.5 text-muted"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <input
            ref={inputArquivoRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={selecionarImagem}
            className="hidden"
          />
          <button
            onClick={() => inputArquivoRef.current?.click()}
            aria-label="Anexar imagem"
            className="p-1.5 text-muted hover:text-ink rounded-lg"
          >
            <ImageIcon size={18} />
          </button>
          <button
            onClick={() => setGifPickerAberto(true)}
            aria-label="Anexar GIF"
            className="px-1.5 h-[26px] flex items-center justify-center border border-current rounded-md text-muted hover:text-ink text-[10px] font-display font-bold tracking-tight"
          >
            GIF
          </button>
        </div>
        <button
          onClick={enviar}
          disabled={enviando || !temConteudo}
          className="px-3 py-1.5 bg-amber text-bg rounded-xl text-xs font-display font-semibold disabled:opacity-50"
        >
          {enviando ? 'Enviando…' : 'Comentar'}
        </button>
      </div>

      {gifPickerAberto && (
        <GifPicker onEscolher={escolherGif} onFechar={() => setGifPickerAberto(false)} />
      )}
    </div>
  )
}
