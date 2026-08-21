create table public.seguidor (
  seguidor_id uuid not null references public.usuarios(id) on delete cascade,
  seguido_id  uuid not null references public.usuarios(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (seguidor_id, seguido_id),
  constraint seguidor_nao_pode_seguir_si_mesmo check (seguidor_id <> seguido_id)
);
alter table public.seguidor enable row level security;

create policy "Relações de seguir são públicas para leitura" on public.seguidor
  for select using (true);
create policy "Usuário gerencia quem ele segue" on public.seguidor
  for all using (auth.uid() = seguidor_id) with check (auth.uid() = seguidor_id);
