-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

DROP EXTENSION IF EXISTS pg_net;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE, INSERT, SELECT, UPDATE ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, USAGE ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;

CREATE SEQUENCE public.ator_id_seq;

CREATE SEQUENCE public.episode_id_seq;

CREATE SEQUENCE public.lista_id_seq;

CREATE SEQUENCE public.titulo_id_seq;

CREATE FUNCTION public.atualiza_media_episode()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_episode_id BIGINT := COALESCE(NEW.episode_id, OLD.episode_id);
BEGIN
  UPDATE episode e
  SET media_rating = sub.media,
      total_avaliacoes = sub.total
  FROM (
    SELECT AVG(rating_score)::NUMERIC(3,2) AS media, COUNT(*) AS total
    FROM user_rating_episode
    WHERE episode_id = v_episode_id
  ) sub
  WHERE e.id = v_episode_id;
  RETURN NULL;
END;
$function$;

GRANT ALL ON FUNCTION public.atualiza_media_episode() TO anon;

GRANT ALL ON FUNCTION public.atualiza_media_episode() TO authenticated;

GRANT ALL ON FUNCTION public.atualiza_media_episode() TO service_role;

CREATE FUNCTION public.atualiza_media_titulo()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_titulo_id BIGINT := COALESCE(NEW.titulo_id, OLD.titulo_id);
BEGIN
  UPDATE titulo t
  SET media_rating = sub.media,
      total_avaliacoes = sub.total
  FROM (
    SELECT AVG(rating_score)::NUMERIC(3,2) AS media, COUNT(*) AS total
    FROM user_rating
    WHERE titulo_id = v_titulo_id
  ) sub
  WHERE t.id = v_titulo_id;
  RETURN NULL;
END;
$function$;

GRANT ALL ON FUNCTION public.atualiza_media_titulo() TO anon;

GRANT ALL ON FUNCTION public.atualiza_media_titulo() TO authenticated;

GRANT ALL ON FUNCTION public.atualiza_media_titulo() TO service_role;

CREATE FUNCTION public.cria_perfil_usuario()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  INSERT INTO public.usuarios (id, username)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_cria_perfil_usuario
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.cria_perfil_usuario();

GRANT ALL ON FUNCTION public.cria_perfil_usuario() TO anon;

GRANT ALL ON FUNCTION public.cria_perfil_usuario() TO authenticated;

GRANT ALL ON FUNCTION public.cria_perfil_usuario() TO service_role;

CREATE FUNCTION public.marca_mudanca_status()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_atualizado_em := now();
  END IF;
  RETURN NEW;
END;
$function$;

GRANT ALL ON FUNCTION public.marca_mudanca_status() TO anon;

GRANT ALL ON FUNCTION public.marca_mudanca_status() TO authenticated;

GRANT ALL ON FUNCTION public.marca_mudanca_status() TO service_role;

CREATE TABLE public.ator (
  id    bigint                 DEFAULT nextval('public.ator_id_seq'::regclass) NOT NULL,
  name  character varying(255) NOT NULL,
  image text
);

ALTER SEQUENCE public.ator_id_seq OWNED BY public.ator.id;

GRANT ALL ON SEQUENCE public.ator_id_seq TO anon;

GRANT ALL ON SEQUENCE public.ator_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.ator_id_seq TO service_role;

ALTER TABLE public.ator
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ator
  ADD CONSTRAINT ator_pkey PRIMARY KEY (id);

GRANT ALL ON public.ator TO anon;

GRANT ALL ON public.ator TO authenticated;

GRANT ALL ON public.ator TO service_role;

CREATE POLICY "Catálogo público - ator" ON public.ator
  FOR SELECT
  USING (true);

CREATE TABLE public.elenco_episode (
  actor_id   bigint                 NOT NULL,
  episode_id bigint                 NOT NULL,
  personagem character varying(255)
);

ALTER TABLE public.elenco_episode
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.elenco_episode
  ADD CONSTRAINT elenco_episode_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.ator(id) ON DELETE CASCADE;

ALTER TABLE public.elenco_episode
  ADD CONSTRAINT elenco_episode_pkey PRIMARY KEY (actor_id, episode_id);

GRANT ALL ON public.elenco_episode TO anon;

GRANT ALL ON public.elenco_episode TO authenticated;

GRANT ALL ON public.elenco_episode TO service_role;

CREATE POLICY "Catálogo público - elenco_episode" ON public.elenco_episode
  FOR SELECT
  USING (true);

CREATE TABLE public.elenco_movie (
  actor_id   bigint                 NOT NULL,
  titulo_id  bigint                 NOT NULL,
  personagem character varying(255)
);

ALTER TABLE public.elenco_movie
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.elenco_movie
  ADD CONSTRAINT elenco_movie_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.ator(id) ON DELETE CASCADE;

ALTER TABLE public.elenco_movie
  ADD CONSTRAINT elenco_movie_pkey PRIMARY KEY (actor_id, titulo_id);

GRANT ALL ON public.elenco_movie TO anon;

GRANT ALL ON public.elenco_movie TO authenticated;

GRANT ALL ON public.elenco_movie TO service_role;

CREATE POLICY "Catálogo público - elenco_movie" ON public.elenco_movie
  FOR SELECT
  USING (true);

CREATE TABLE public.elenco_serie (
  actor_id   bigint                 NOT NULL,
  titulo_id  bigint                 NOT NULL,
  personagem character varying(255)
);

ALTER TABLE public.elenco_serie
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.elenco_serie
  ADD CONSTRAINT elenco_serie_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.ator(id) ON DELETE CASCADE;

ALTER TABLE public.elenco_serie
  ADD CONSTRAINT elenco_serie_pkey PRIMARY KEY (actor_id, titulo_id);

GRANT ALL ON public.elenco_serie TO anon;

GRANT ALL ON public.elenco_serie TO authenticated;

GRANT ALL ON public.elenco_serie TO service_role;

CREATE POLICY "Catálogo público - elenco_serie" ON public.elenco_serie
  FOR SELECT
  USING (true);

CREATE TABLE public.episode (
  id               bigint                 DEFAULT nextval('public.episode_id_seq'::regclass) NOT NULL,
  titulo_id        bigint                 NOT NULL,
  episode_name     character varying(255),
  duration         integer,
  launch_date      date,
  media_rating     numeric(3,2),
  total_avaliacoes integer                DEFAULT 0 NOT NULL,
  season_number    integer,
  episode_number   integer,
  sinopse          text
);

ALTER SEQUENCE public.episode_id_seq OWNED BY public.episode.id;

GRANT ALL ON SEQUENCE public.episode_id_seq TO anon;

GRANT ALL ON SEQUENCE public.episode_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.episode_id_seq TO service_role;

ALTER TABLE public.episode
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.episode
  ADD CONSTRAINT episode_pkey PRIMARY KEY (id);

ALTER TABLE public.elenco_episode
  ADD CONSTRAINT elenco_episode_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episode(id) ON DELETE CASCADE;

GRANT ALL ON public.episode TO anon;

GRANT ALL ON public.episode TO authenticated;

GRANT ALL ON public.episode TO service_role;

CREATE POLICY "Catálogo público - episode" ON public.episode
  FOR SELECT
  USING (true);

CREATE TABLE public.episode_traducao (
  episode_id    bigint                   NOT NULL,
  idioma        character varying(10)    NOT NULL,
  episode_name  character varying(255),
  sinopse       text,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.episode_traducao
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.episode_traducao
  ADD CONSTRAINT episode_traducao_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episode(id) ON DELETE CASCADE;

ALTER TABLE public.episode_traducao
  ADD CONSTRAINT episode_traducao_pkey PRIMARY KEY (episode_id, idioma);

GRANT ALL ON public.episode_traducao TO anon;

GRANT ALL ON public.episode_traducao TO authenticated;

GRANT ALL ON public.episode_traducao TO service_role;

CREATE POLICY "Traduções de episódio são públicas para leitura" ON public.episode_traducao
  FOR SELECT
  USING (true);

CREATE TABLE public.games (
  titulo_id   bigint            NOT NULL,
  launch_date date,
  platforms   text[],
  developer   character varying
);

ALTER TABLE public.games
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.games
  ADD CONSTRAINT games_pkey PRIMARY KEY (titulo_id);

GRANT ALL ON public.games TO anon;

GRANT ALL ON public.games TO authenticated;

GRANT ALL ON public.games TO service_role;

CREATE POLICY "Catálogo público - games" ON public.games
  FOR SELECT
  USING (true);

CREATE TABLE public.lista (
  id         bigint                   DEFAULT nextval('public.lista_id_seq'::regclass) NOT NULL,
  user_id    uuid                     NOT NULL,
  nome       character varying(100)   NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE public.lista_id_seq OWNED BY public.lista.id;

GRANT ALL ON SEQUENCE public.lista_id_seq TO anon;

GRANT ALL ON SEQUENCE public.lista_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.lista_id_seq TO service_role;

ALTER TABLE public.lista
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lista
  ADD CONSTRAINT lista_pkey PRIMARY KEY (id);

GRANT ALL ON public.lista TO anon;

GRANT ALL ON public.lista TO authenticated;

GRANT ALL ON public.lista TO service_role;

CREATE POLICY "Usuário gerencia suas próprias listas" ON public.lista
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.lista_item (
  lista_id  bigint                   NOT NULL,
  titulo_id bigint                   NOT NULL,
  added_at  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.lista_item
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lista_item
  ADD CONSTRAINT lista_item_lista_id_fkey FOREIGN KEY (lista_id) REFERENCES public.lista(id) ON DELETE CASCADE;

ALTER TABLE public.lista_item
  ADD CONSTRAINT lista_item_pkey PRIMARY KEY (lista_id, titulo_id);

GRANT ALL ON public.lista_item TO anon;

GRANT ALL ON public.lista_item TO authenticated;

GRANT ALL ON public.lista_item TO service_role;

CREATE POLICY "Usuário gerencia itens das próprias listas" ON public.lista_item
  USING ((EXISTS ( SELECT 1
   FROM public.lista
  WHERE ((lista.id = lista_item.lista_id) AND (lista.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.lista
  WHERE ((lista.id = lista_item.lista_id) AND (lista.user_id = auth.uid())))));

CREATE TABLE public.movies (
  titulo_id   bigint  NOT NULL,
  duration    integer,
  launch_date date
);

ALTER TABLE public.movies
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.movies
  ADD CONSTRAINT movies_pkey PRIMARY KEY (titulo_id);

ALTER TABLE public.elenco_movie
  ADD CONSTRAINT elenco_movie_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.movies(titulo_id) ON DELETE CASCADE;

GRANT ALL ON public.movies TO anon;

GRANT ALL ON public.movies TO authenticated;

GRANT ALL ON public.movies TO service_role;

CREATE POLICY "Catálogo público - movies" ON public.movies
  FOR SELECT
  USING (true);

CREATE TABLE public.series (
  titulo_id   bigint  NOT NULL,
  launch_date date,
  end_date    date,
  temporadas  integer
);

ALTER TABLE public.series
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.series
  ADD CONSTRAINT series_pkey PRIMARY KEY (titulo_id);

ALTER TABLE public.elenco_serie
  ADD CONSTRAINT elenco_serie_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.series(titulo_id) ON DELETE CASCADE;

ALTER TABLE public.episode
  ADD CONSTRAINT episode_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.series(titulo_id) ON DELETE CASCADE;

GRANT ALL ON public.series TO anon;

GRANT ALL ON public.series TO authenticated;

GRANT ALL ON public.series TO service_role;

CREATE POLICY "Catálogo público - series" ON public.series
  FOR SELECT
  USING (true);

CREATE TABLE public.titulo (
  id               bigint                 DEFAULT nextval('public.titulo_id_seq'::regclass) NOT NULL,
  nome             character varying(255) NOT NULL,
  sinopse          text,
  genero           character varying(100),
  imagem           text,
  media_rating     numeric(3,2),
  total_avaliacoes integer                DEFAULT 0 NOT NULL,
  fonte            character varying      DEFAULT 'tmdb'::character varying NOT NULL,
  external_id      bigint                 NOT NULL
);

ALTER SEQUENCE public.titulo_id_seq OWNED BY public.titulo.id;

GRANT ALL ON SEQUENCE public.titulo_id_seq TO anon;

GRANT ALL ON SEQUENCE public.titulo_id_seq TO authenticated;

GRANT ALL ON SEQUENCE public.titulo_id_seq TO service_role;

ALTER TABLE public.titulo
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.titulo
  ADD CONSTRAINT titulo_fonte_check CHECK (fonte::text = ANY (ARRAY['tmdb'::character varying, 'igdb'::character varying]::text[]));

ALTER TABLE public.titulo
  ADD CONSTRAINT titulo_fonte_external_id_key UNIQUE (fonte, external_id);

ALTER TABLE public.titulo
  ADD CONSTRAINT titulo_pkey PRIMARY KEY (id);

ALTER TABLE public.games
  ADD CONSTRAINT games_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.titulo(id);

ALTER TABLE public.lista_item
  ADD CONSTRAINT lista_item_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.titulo(id) ON DELETE CASCADE;

ALTER TABLE public.movies
  ADD CONSTRAINT movies_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.titulo(id) ON DELETE CASCADE;

ALTER TABLE public.series
  ADD CONSTRAINT series_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.titulo(id) ON DELETE CASCADE;

GRANT ALL ON public.titulo TO anon;

GRANT ALL ON public.titulo TO authenticated;

GRANT ALL ON public.titulo TO service_role;

CREATE POLICY "Catálogo público - titulo" ON public.titulo
  FOR SELECT
  USING (true);

CREATE TABLE public.titulo_traducao (
  titulo_id     bigint                   NOT NULL,
  idioma        character varying(10)    NOT NULL,
  nome          character varying(255),
  sinopse       text,
  genero        character varying(100),
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.titulo_traducao
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.titulo_traducao
  ADD CONSTRAINT titulo_traducao_pkey PRIMARY KEY (titulo_id, idioma);

ALTER TABLE public.titulo_traducao
  ADD CONSTRAINT titulo_traducao_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.titulo(id) ON DELETE CASCADE;

GRANT ALL ON public.titulo_traducao TO anon;

GRANT ALL ON public.titulo_traducao TO authenticated;

GRANT ALL ON public.titulo_traducao TO service_role;

CREATE POLICY "Traduções são públicas para leitura" ON public.titulo_traducao
  FOR SELECT
  USING (true);

CREATE TABLE public.user_item (
  user_id              uuid                     NOT NULL,
  titulo_id            bigint                   NOT NULL,
  status               character varying(20)    NOT NULL,
  favorito             boolean                  DEFAULT false NOT NULL,
  added_at             timestamp with time zone DEFAULT now() NOT NULL,
  status_atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.user_item
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_item
  ADD CONSTRAINT user_item_pkey PRIMARY KEY (user_id, titulo_id);

ALTER TABLE public.user_item
  ADD CONSTRAINT user_item_status_check
    CHECK
    (status::text = ANY (ARRAY['quero_ver'::character varying::text, 'vendo'::character varying::text, 'visto'::character varying::text, 'interrompida'::character varying::text]));

ALTER TABLE public.user_item
  ADD CONSTRAINT user_item_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.titulo(id) ON DELETE CASCADE;

GRANT ALL ON public.user_item TO anon;

GRANT ALL ON public.user_item TO authenticated;

GRANT ALL ON public.user_item TO service_role;

CREATE TRIGGER trg_marca_mudanca_status
  BEFORE UPDATE ON public.user_item
  FOR EACH ROW
  EXECUTE FUNCTION public.marca_mudanca_status();

CREATE POLICY "Usuário gerencia seus próprios user_item" ON public.user_item
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.user_rating (
  user_id      uuid                     NOT NULL,
  titulo_id    bigint                   NOT NULL,
  rating_score smallint                 NOT NULL,
  rated_at     timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.user_rating
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_rating
  ADD CONSTRAINT user_rating_pkey PRIMARY KEY (user_id, titulo_id);

ALTER TABLE public.user_rating
  ADD CONSTRAINT user_rating_rating_score_check CHECK (rating_score >= 1 AND rating_score <= 10);

ALTER TABLE public.user_rating
  ADD CONSTRAINT user_rating_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.titulo(id) ON DELETE CASCADE;

GRANT ALL ON public.user_rating TO anon;

GRANT ALL ON public.user_rating TO authenticated;

GRANT ALL ON public.user_rating TO service_role;

CREATE TRIGGER trg_media_titulo
  AFTER INSERT OR DELETE OR UPDATE ON public.user_rating
  FOR EACH ROW
  EXECUTE FUNCTION public.atualiza_media_titulo();

CREATE POLICY "Usuário gerencia suas próprias avaliações (título)" ON public.user_rating
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.user_rating_episode (
  user_id      uuid                     NOT NULL,
  episode_id   bigint                   NOT NULL,
  rating_score smallint                 NOT NULL,
  rated_at     timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.user_rating_episode
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_rating_episode
  ADD CONSTRAINT user_rating_episode_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episode(id) ON DELETE CASCADE;

ALTER TABLE public.user_rating_episode
  ADD CONSTRAINT user_rating_episode_pkey PRIMARY KEY (user_id, episode_id);

ALTER TABLE public.user_rating_episode
  ADD CONSTRAINT user_rating_episode_rating_score_check CHECK (rating_score >= 1 AND rating_score <= 10);

GRANT ALL ON public.user_rating_episode TO anon;

GRANT ALL ON public.user_rating_episode TO authenticated;

GRANT ALL ON public.user_rating_episode TO service_role;

CREATE TRIGGER trg_media_episode
  AFTER INSERT OR DELETE OR UPDATE ON public.user_rating_episode
  FOR EACH ROW
  EXECUTE FUNCTION public.atualiza_media_episode();

CREATE POLICY "Usuário gerencia suas próprias avaliações (episódio)" ON public.user_rating_episode
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE TABLE public.usuarios (
  id               uuid                     NOT NULL,
  username         character varying(100)   NOT NULL,
  user_age         integer,
  created_at       timestamp with time zone DEFAULT now() NOT NULL,
  perfil_privado   boolean                  DEFAULT false NOT NULL,
  idioma_preferido character varying(10)
);

ALTER TABLE public.usuarios
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);

ALTER TABLE public.lista
  ADD CONSTRAINT lista_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

ALTER TABLE public.user_item
  ADD CONSTRAINT user_item_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

ALTER TABLE public.user_rating
  ADD CONSTRAINT user_rating_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

ALTER TABLE public.user_rating_episode
  ADD CONSTRAINT user_rating_episode_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

ALTER TABLE public.usuarios
  ADD CONSTRAINT usuarios_username_key UNIQUE (username);

GRANT ALL ON public.usuarios TO anon;

GRANT ALL ON public.usuarios TO authenticated;

GRANT ALL ON public.usuarios TO service_role;

CREATE POLICY "Usuário cria o próprio perfil" ON public.usuarios
  FOR INSERT
  WITH CHECK ((auth.uid() = id));

CREATE POLICY "Usuário edita o próprio perfil" ON public.usuarios
  FOR UPDATE
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));

CREATE POLICY "Usuário vê o próprio perfil" ON public.usuarios
  FOR SELECT
  USING ((auth.uid() = id));

CREATE TABLE public.watched_episode (
  user_id    uuid                     NOT NULL,
  episode_id bigint                   NOT NULL,
  watched_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.watched_episode
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.watched_episode
  ADD CONSTRAINT watched_episode_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES public.episode(id) ON DELETE CASCADE;

ALTER TABLE public.watched_episode
  ADD CONSTRAINT watched_episode_pkey PRIMARY KEY (user_id, episode_id);

ALTER TABLE public.watched_episode
  ADD CONSTRAINT watched_episode_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

GRANT ALL ON public.watched_episode TO anon;

GRANT ALL ON public.watched_episode TO authenticated;

GRANT ALL ON public.watched_episode TO service_role;

CREATE POLICY "Usuário gerencia seus próprios episódios assistidos" ON public.watched_episode
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE VIEW public.trending_semana AS WITH atividade AS (
         SELECT user_item.titulo_id,
            count(DISTINCT user_item.user_id) AS contagem
           FROM public.user_item
          WHERE ((((user_item.status)::text = 'quero_ver'::text) AND (user_item.added_at >= (now() - '7 days'::interval))) OR (((user_item.status)::text = 'visto'::text) AND (user_item.status_atualizado_em >= (now() - '7 days'::interval))))
          GROUP BY user_item.titulo_id
        )
 SELECT t.id AS titulo_id,
    t.nome,
    t.imagem,
    t.genero,
        CASE
            WHEN (s.titulo_id IS NOT NULL) THEN 'tv'::text
            WHEN (g.titulo_id IS NOT NULL) THEN 'game'::text
            ELSE 'movie'::text
        END AS media_type,
    a.contagem
   FROM (((atividade a
     JOIN public.titulo t ON ((t.id = a.titulo_id)))
     LEFT JOIN public.series s ON ((s.titulo_id = t.id)))
     LEFT JOIN public.games g ON ((g.titulo_id = t.id)))
  ORDER BY a.contagem DESC;

GRANT ALL ON public.trending_semana TO anon;

GRANT ALL ON public.trending_semana TO authenticated;

GRANT ALL ON public.trending_semana TO service_role;
