-- trending_semana hoje só sobe uma série quando alguém marca o TÍTULO
-- inteiro como "quero_ver"/"visto" -- assistir episódios individuais (sem
-- nunca virar "visto" na série toda, ex: quem está no meio de uma temporada)
-- não contava. Substitui a CTE de atividade por uma UNIÃO de duas fontes de
-- sinal (user_item + watched_episode), contando USUÁRIOS DISTINTOS no
-- conjunto combinado -- quem fez as duas coisas na mesma semana não é
-- contado em dobro.
CREATE OR REPLACE VIEW public.trending_semana AS
WITH atividade_titulo AS (
  SELECT user_item.user_id, user_item.titulo_id
    FROM public.user_item
   WHERE ((user_item.status)::text = 'quero_ver'::text AND user_item.added_at >= (now() - '7 days'::interval))
      OR ((user_item.status)::text = 'visto'::text AND user_item.status_atualizado_em >= (now() - '7 days'::interval))
),
atividade_episodio AS (
  SELECT we.user_id, e.titulo_id
    FROM public.watched_episode we
    JOIN public.episode e ON e.id = we.episode_id
   WHERE we.watched_at >= (now() - '7 days'::interval)
),
atividade AS (
  SELECT titulo_id, count(DISTINCT user_id) AS contagem
    FROM (
      SELECT * FROM atividade_titulo
      UNION
      SELECT * FROM atividade_episodio
    ) combinado
   GROUP BY titulo_id
)
SELECT
  t.id AS titulo_id,
  t.nome,
  t.imagem,
  t.genero,
  CASE
    WHEN s.titulo_id IS NOT NULL THEN 'tv'::text
    WHEN g.titulo_id IS NOT NULL THEN 'game'::text
    ELSE 'movie'::text
  END AS media_type,
  a.contagem
FROM atividade a
JOIN public.titulo t ON t.id = a.titulo_id
LEFT JOIN public.series s ON s.titulo_id = t.id
LEFT JOIN public.games g ON g.titulo_id = t.id
ORDER BY a.contagem DESC;
