-- Muda o modelo de privacidade por seção de "opt-out independente do perfil
-- inteiro" para "exceção dentro de um perfil privado": as 4 flags
-- privado_estatisticas/historico/favoritos/listas (e as 2 de dados pessoais,
-- compartilhar_nome/idade) só têm QUALQUER efeito quando perfil_privado=true
-- -- com perfil_privado=false o perfil é 100% público e essas flags são
-- ignoradas. Com perfil_privado=true, tudo começa oculto e o usuário
-- desmarca uma seção pra reabri-la como exceção (ver ContaConfiguracoes.jsx).
--
-- Isso substitui a regra das views/função criadas nas migrações
-- 20260828010000 e 20260828020000 (lá, perfil_privado=true bloqueava tudo
-- sem exceção e as flags de seção operavam mesmo com o perfil público).

DROP VIEW IF EXISTS public.usuarios_publico;

CREATE VIEW public.usuarios_publico AS
  SELECT
    id,
    username,
    foto_perfil,
    perfil_privado,
    privado_estatisticas,
    privado_historico,
    privado_favoritos,
    privado_listas,
    CASE WHEN (NOT perfil_privado) OR compartilhar_nome THEN nome ELSE NULL END AS nome,
    CASE WHEN (NOT perfil_privado) OR compartilhar_idade
      THEN
        CASE WHEN data_nascimento IS NOT NULL THEN date_part('year', age(data_nascimento))::integer END
      ELSE NULL
    END AS user_age
  FROM public.usuarios;

GRANT SELECT ON public.usuarios_publico TO anon, authenticated;

DROP VIEW IF EXISTS public.user_item_publico;

CREATE VIEW public.user_item_publico AS
  SELECT
    ui.user_id,
    ui.titulo_id,
    CASE WHEN u.perfil_privado AND u.privado_historico THEN NULL ELSE ui.status END AS status,
    CASE WHEN u.perfil_privado AND u.privado_historico THEN NULL ELSE ui.status_atualizado_em END AS status_atualizado_em,
    CASE WHEN u.perfil_privado AND u.privado_favoritos THEN NULL ELSE ui.favorito END AS favorito,
    ui.added_at
  FROM public.user_item ui
  JOIN public.usuarios u ON u.id = ui.user_id;

GRANT SELECT ON public.user_item_publico TO anon, authenticated;

DROP VIEW IF EXISTS public.watched_episode_publico;

CREATE VIEW public.watched_episode_publico AS
  SELECT we.user_id, we.episode_id, we.watched_at
  FROM public.watched_episode we
  JOIN public.usuarios u ON u.id = we.user_id
  WHERE NOT (u.perfil_privado AND u.privado_historico);

GRANT SELECT ON public.watched_episode_publico TO anon, authenticated;

DROP VIEW IF EXISTS public.lista_item_publico;
DROP VIEW IF EXISTS public.lista_publico;

CREATE VIEW public.lista_publico AS
  SELECT l.id, l.user_id, l.nome, l.created_at
  FROM public.lista l
  JOIN public.usuarios u ON u.id = l.user_id
  WHERE NOT (u.perfil_privado AND u.privado_listas);

GRANT SELECT ON public.lista_publico TO anon, authenticated;

CREATE VIEW public.lista_item_publico AS
  SELECT li.lista_id, li.titulo_id, li.added_at
  FROM public.lista_item li
  JOIN public.lista_publico lp ON lp.id = li.lista_id;

GRANT SELECT ON public.lista_item_publico TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.estatisticas_publicas(alvo_id uuid)
RETURNS TABLE (
  minutos_tv    integer,
  episodios     integer,
  minutos_filme integer,
  filmes        integer,
  jogos         integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pode_ver boolean;
BEGIN
  SELECT (auth.uid() = alvo_id) OR NOT (u.perfil_privado AND u.privado_estatisticas)
    INTO pode_ver
    FROM public.usuarios u
   WHERE u.id = alvo_id;

  IF NOT COALESCE(pode_ver, false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(e.duration), 0)::integer AS minutos_tv,
    COUNT(we.episode_id)::integer AS episodios,
    (SELECT COALESCE(SUM(m.duration), 0)::integer
       FROM public.user_item ui
       JOIN public.movies m ON m.titulo_id = ui.titulo_id
      WHERE ui.user_id = alvo_id AND ui.status = 'visto') AS minutos_filme,
    (SELECT COUNT(*)::integer
       FROM public.user_item ui
       JOIN public.movies m ON m.titulo_id = ui.titulo_id
      WHERE ui.user_id = alvo_id AND ui.status = 'visto') AS filmes,
    (SELECT COUNT(*)::integer
       FROM public.user_item ui
       JOIN public.games g ON g.titulo_id = ui.titulo_id
      WHERE ui.user_id = alvo_id AND ui.status = 'visto') AS jogos
    FROM public.watched_episode we
    JOIN public.episode e ON e.id = we.episode_id
   WHERE we.user_id = alvo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.estatisticas_publicas(uuid) TO anon, authenticated;
