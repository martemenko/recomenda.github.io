-- Leitura pública de atividade (o que a pessoa assistiu) para o perfil público
-- funcionar, mas só quando o dono não marcou o perfil como privado. A escrita
-- continua restrita ao dono pela policy FOR ALL já existente em cada tabela —
-- essa mesma policy já cobre o dono ver a própria atividade mesmo com
-- perfil_privado=true, então essas policies novas só precisam cuidar de terceiros.
create policy "Atividade pública quando o perfil não é privado" on public.watched_episode
  for select using (
    exists (
      select 1 from public.usuarios u
      where u.id = watched_episode.user_id and u.perfil_privado = false
    )
  );

create policy "Itens do usuário públicos quando o perfil não é privado" on public.user_item
  for select using (
    exists (
      select 1 from public.usuarios u
      where u.id = user_item.user_id and u.perfil_privado = false
    )
  );
