alter table public.comentario add column episode_id bigint references public.episode(id) on delete cascade;
alter table public.comentario alter column titulo_id drop not null;
alter table public.comentario add constraint comentario_target_check check (
  (episode_id is not null and titulo_id is null) or
  (episode_id is null and titulo_id is not null)
);

-- thread_id nulo = é uma thread raiz; preenchido = é uma resposta dentro da thread daquele id.
-- Fica só um nível porque o app nunca deixa criar um comentário com thread_id apontando pra
-- outro comentário que já é uma resposta (aplicado na camada de aplicação, não no banco).
alter table public.comentario add column thread_id bigint references public.comentario(id) on delete cascade;

create index comentario_thread_idx on public.comentario(thread_id);
create index comentario_titulo_idx on public.comentario(titulo_id) where titulo_id is not null;
create index comentario_episode_idx on public.comentario(episode_id) where episode_id is not null;
