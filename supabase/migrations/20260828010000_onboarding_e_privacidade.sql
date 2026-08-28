-- Onboarding (usuário escolhe username/idade/nome no primeiro login) e
-- privacidade granular por seção do perfil (estatísticas, histórico,
-- favoritos, listas, dados pessoais), além do toggle de perfil inteiro que
-- já existia (perfil_privado).

ALTER TABLE public.usuarios
  ADD COLUMN nome                 text,
  ADD COLUMN onboarding_completo  boolean NOT NULL DEFAULT false,
  ADD COLUMN privado_estatisticas boolean NOT NULL DEFAULT false,
  ADD COLUMN privado_historico    boolean NOT NULL DEFAULT false,
  ADD COLUMN privado_favoritos    boolean NOT NULL DEFAULT false,
  ADD COLUMN privado_listas       boolean NOT NULL DEFAULT false,
  ADD COLUMN compartilhar_idade   boolean NOT NULL DEFAULT false,
  ADD COLUMN compartilhar_nome    boolean NOT NULL DEFAULT false;

-- Contas já existentes não devem cair no fluxo de onboarding
UPDATE public.usuarios SET onboarding_completo = true;

-- usuarios_publico ganha nome/idade, mas só quando o dono optou por
-- compartilhar (dados pessoais); mantém as colunas que já existiam. As 4
-- flags de seção também são expostas (são só booleanos, não dado sensível
-- em si) para que a UI do perfil público consiga distinguir "seção oculta"
-- de "seção vazia" em vez de simplesmente omitir a seção sem explicação.
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
    CASE WHEN compartilhar_nome THEN nome ELSE NULL END AS nome,
    CASE WHEN compartilhar_idade THEN user_age ELSE NULL END AS user_age
  FROM public.usuarios;

GRANT SELECT ON public.usuarios_publico TO anon, authenticated;

-- As policies "tudo ou nada" abaixo (perfil_privado=false libera a leitura
-- de watched_episode/user_item inteiros) não conseguem respeitar
-- privado_historico/privado_favoritos, porque uma mesma linha de user_item
-- carrega status (histórico) e favorito (favoritos) ao mesmo tempo — RLS por
-- linha não separa colunas. Substituídas por views que suprimem coluna a
-- coluna, mesmo modelo de usuarios_publico acima.
DROP POLICY IF EXISTS "Atividade pública quando o perfil não é privado" ON public.watched_episode;
DROP POLICY IF EXISTS "Itens do usuário públicos quando o perfil não é privado" ON public.user_item;

CREATE VIEW public.user_item_publico AS
  SELECT
    ui.user_id,
    ui.titulo_id,
    CASE WHEN u.privado_historico THEN NULL ELSE ui.status END AS status,
    CASE WHEN u.privado_historico THEN NULL ELSE ui.status_atualizado_em END AS status_atualizado_em,
    CASE WHEN u.privado_favoritos THEN NULL ELSE ui.favorito END AS favorito,
    ui.added_at
  FROM public.user_item ui
  JOIN public.usuarios u ON u.id = ui.user_id
  WHERE u.perfil_privado = false;

GRANT SELECT ON public.user_item_publico TO anon, authenticated;

CREATE VIEW public.watched_episode_publico AS
  SELECT we.user_id, we.episode_id, we.watched_at
  FROM public.watched_episode we
  JOIN public.usuarios u ON u.id = we.user_id
  WHERE u.perfil_privado = false AND u.privado_historico = false;

GRANT SELECT ON public.watched_episode_publico TO anon, authenticated;

CREATE VIEW public.lista_publico AS
  SELECT l.id, l.user_id, l.nome, l.created_at
  FROM public.lista l
  JOIN public.usuarios u ON u.id = l.user_id
  WHERE u.perfil_privado = false AND u.privado_listas = false;

GRANT SELECT ON public.lista_publico TO anon, authenticated;

-- lista_item não tem (nunca teve) policy de leitura pública -- só o dono
-- pode ler via "Usuário gerencia itens das próprias listas" (FOR ALL). Essa
-- view reaproveita o filtro de privacidade de lista_publico via join, sem
-- precisar mexer na policy da tabela base (mesmo truque de bypass de RLS por
-- dono da view usado em todas as views acima).
CREATE VIEW public.lista_item_publico AS
  SELECT li.lista_id, li.titulo_id, li.added_at
  FROM public.lista_item li
  JOIN public.lista_publico lp ON lp.id = li.lista_id;

GRANT SELECT ON public.lista_item_publico TO anon, authenticated;

-- Estatísticas (tempo assistido, contagens) são um agregado sobre as mesmas
-- tabelas de histórico, mas com uma flag de privacidade PRÓPRIA
-- (privado_estatisticas) — não dá pra reaproveitar user_item_publico/
-- watched_episode_publico acima (essas respeitam privado_historico, uma
-- seção diferente). Função com SECURITY DEFINER: lê as tabelas base
-- ignorando RLS, mas só devolve algo se o chamador for o dono ou o alvo
-- permitir estatísticas públicas.
CREATE FUNCTION public.estatisticas_publicas(alvo_id uuid)
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
  SELECT (auth.uid() = alvo_id) OR (u.perfil_privado = false AND u.privado_estatisticas = false)
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
