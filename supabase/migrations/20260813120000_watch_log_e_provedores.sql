-- Histórico de marcações de "assistido" (inicial + reassistido), por episódio ou por título
-- (filme/jogo). Aditivo: watched_episode/user_item.status continuam respondendo "está visto
-- agora?"; watch_log responde "quantas vezes e quando" e nunca é apagado ao desmarcar.
CREATE TABLE public.watch_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  episode_id bigint REFERENCES public.episode(id) ON DELETE CASCADE,
  titulo_id  bigint REFERENCES public.titulo(id) ON DELETE CASCADE,
  watched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watch_log_target_check CHECK (
    (episode_id IS NOT NULL AND titulo_id IS NULL) OR
    (episode_id IS NULL AND titulo_id IS NOT NULL)
  )
);

CREATE INDEX watch_log_user_episode_idx ON public.watch_log(user_id, episode_id);
CREATE INDEX watch_log_user_titulo_idx ON public.watch_log(user_id, titulo_id);

ALTER TABLE public.watch_log ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.watch_log TO anon;
GRANT ALL ON public.watch_log TO authenticated;
GRANT ALL ON public.watch_log TO service_role;

CREATE POLICY "Usuário gerencia seu próprio histórico de assistidos" ON public.watch_log
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Streaming (TMDB) e loja (IGDB) cacheados por título, pra montar a seção "Onde
-- assistir"/"Onde jogar" sem depender da API externa a cada visita à tela.
CREATE TABLE public.titulo_provedor (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo_id       bigint NOT NULL REFERENCES public.titulo(id) ON DELETE CASCADE,
  tipo            text NOT NULL,   -- 'flatrate' | 'rent' | 'buy' (tmdb) | 'loja' (igdb)
  provider_name   text NOT NULL,
  logo_path       text,            -- caminho relativo da tmdb; null para igdb (sem logo)
  url             text,            -- link direto por loja (só igdb - tmdb não permite por ToS)
  display_priority integer,
  UNIQUE (titulo_id, tipo, provider_name)
);

CREATE INDEX titulo_provedor_titulo_idx ON public.titulo_provedor(titulo_id);

ALTER TABLE public.titulo_provedor ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.titulo_provedor TO anon;
GRANT ALL ON public.titulo_provedor TO authenticated;
GRANT ALL ON public.titulo_provedor TO service_role;

CREATE POLICY "Catálogo público - titulo_provedor" ON public.titulo_provedor
  FOR SELECT
  USING (true);

-- Link único de atribuição da JustWatch/TMDB por título+região (a API não permite
-- link individual por provedor de streaming, só esse link combinado).
ALTER TABLE public.series ADD COLUMN watch_providers_link text;
ALTER TABLE public.movies ADD COLUMN watch_providers_link text;
