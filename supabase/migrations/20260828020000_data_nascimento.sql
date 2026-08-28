-- Troca a coleta de "idade" (número) por data de nascimento -- mais preciso
-- e não precisa ser atualizado manualmente ano a ano. `user_age` (coluna já
-- existente desde o schema original) não é mais escrita pelo app a partir
-- desta migração, mas fica intacta (sem DROP) por precaução; nada mais no
-- código depende dela.
ALTER TABLE public.usuarios
  ADD COLUMN data_nascimento date;

-- usuarios_publico continua expondo uma IDADE (inteiro), nunca a data de
-- nascimento exata -- computada a partir de data_nascimento, mesma regra de
-- opt-in (compartilhar_idade) de antes. Mantém o nome de coluna `user_age`
-- pra não exigir mudança no lado que já lê esse campo (PerfilPublico.jsx).
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
    CASE WHEN compartilhar_idade AND data_nascimento IS NOT NULL
      THEN date_part('year', age(data_nascimento))::integer
      ELSE NULL
    END AS user_age
  FROM public.usuarios;

GRANT SELECT ON public.usuarios_publico TO anon, authenticated;
