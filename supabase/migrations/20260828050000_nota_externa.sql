-- Nota do título na fonte de origem (TMDB vote_average, 0-10 com decimais;
-- IGDB total_rating, 0-100) -- lado a lado com media_rating (a nota interna,
-- calculada a partir das avaliações dos próprios usuários do app). A escala
-- de leitura depende de `titulo.fonte` (já existente), então não precisa de
-- uma coluna extra só pra guardar qual escala usar.
ALTER TABLE public.titulo
  ADD COLUMN nota_externa numeric(5,2);
