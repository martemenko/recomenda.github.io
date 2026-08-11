-- Colunas novas em usuarios pra guardar o path do arquivo no Storage
ALTER TABLE public.usuarios
  ADD COLUMN foto_perfil text,
  ADD COLUMN foto_capa text;

-- Buckets de Storage (públicos: qualquer um pode ver a foto de perfil/capa de qualquer usuário)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('capas', 'capas', true)
ON CONFLICT (id) DO NOTHING;

-- Leitura pública dos dois buckets (necessário mesmo com bucket "public = true",
-- pra permitir SELECT via API/policy)
CREATE POLICY "Leitura pública - avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Leitura pública - capas"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'capas');

-- Usuário só pode enviar/atualizar/deletar arquivo dentro da própria pasta,
-- convenção de path: avatars/{user_id}/arquivo.jpg
CREATE POLICY "Usuário gerencia seu próprio avatar"
  ON storage.objects FOR ALL
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Usuário gerencia sua própria capa"
  ON storage.objects FOR ALL
  USING (bucket_id = 'capas' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'capas' AND auth.uid()::text = (storage.foldername(name))[1]);
