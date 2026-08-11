CREATE SEQUENCE public.comentario_id_seq;

CREATE TABLE public.comentario (
  id         bigint                   DEFAULT nextval('public.comentario_id_seq'::regclass) NOT NULL,
  user_id    uuid                     NOT NULL,
  titulo_id  bigint                   NOT NULL,
  texto      text                     NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER SEQUENCE public.comentario_id_seq OWNED BY public.comentario.id;

ALTER TABLE public.comentario
  ADD CONSTRAINT comentario_pkey PRIMARY KEY (id);

ALTER TABLE public.comentario
  ADD CONSTRAINT comentario_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

ALTER TABLE public.comentario
  ADD CONSTRAINT comentario_titulo_id_fkey FOREIGN KEY (titulo_id) REFERENCES public.titulo(id) ON DELETE CASCADE;

ALTER TABLE public.comentario
  ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.comentario TO anon;
GRANT ALL ON public.comentario TO authenticated;
GRANT ALL ON public.comentario TO service_role;
GRANT ALL ON SEQUENCE public.comentario_id_seq TO anon;
GRANT ALL ON SEQUENCE public.comentario_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.comentario_id_seq TO service_role;

-- Qualquer usuário autenticado pode ler comentários (público, tipo review)
CREATE POLICY "Comentários são públicos para leitura" ON public.comentario
  FOR SELECT
  USING (true);

-- Usuário só cria/edita/deleta o próprio comentário
CREATE POLICY "Usuário gerencia seus próprios comentários" ON public.comentario
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
  