-- Permite anexar uma imagem (upload próprio) ou um GIF (URL do GIPHY) a um
-- comentário, além do texto. `texto` deixa de ser obrigatório -- um
-- comentário agora precisa ter PELO MENOS um dos três (texto/imagem/gif),
-- não necessariamente os três.
ALTER TABLE public.comentario
  ALTER COLUMN texto DROP NOT NULL;

ALTER TABLE public.comentario
  ADD COLUMN imagem_url text,
  ADD COLUMN gif_url text;

ALTER TABLE public.comentario
  ADD CONSTRAINT comentario_conteudo_check CHECK (
    (texto IS NOT NULL AND btrim(texto) <> '') OR imagem_url IS NOT NULL OR gif_url IS NOT NULL
  );

-- Bucket de imagens anexadas a comentários -- mesmo padrão de leitura
-- pública / escrita restrita ao dono usado em avatars/capas
-- (20260811232239_add_profile_imgs.sql), mas com um arquivo por COMENTÁRIO
-- em vez de um por usuário, então o path usa um uuid em vez de nome fixo:
-- comentario_imagens/{user_id}/{uuid}.{ext}
INSERT INTO storage.buckets (id, name, public)
VALUES ('comentario_imagens', 'comentario_imagens', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Leitura pública - comentario_imagens"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'comentario_imagens');

CREATE POLICY "Usuário gerencia as próprias imagens de comentário"
  ON storage.objects FOR ALL
  USING (bucket_id = 'comentario_imagens' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'comentario_imagens' AND auth.uid()::text = (storage.foldername(name))[1]);
