create table public.comentario_reacao (
  comentario_id bigint not null references public.comentario(id) on delete cascade,
  user_id       uuid   not null references public.usuarios(id) on delete cascade,
  tipo          text   not null check (tipo in ('curtir', 'rir', 'amei')),
  created_at    timestamptz not null default now(),
  primary key (comentario_id, user_id)
);
alter table public.comentario_reacao enable row level security;

create policy "Reações são públicas para leitura" on public.comentario_reacao
  for select using (true);
create policy "Usuário gerencia suas próprias reações" on public.comentario_reacao
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
