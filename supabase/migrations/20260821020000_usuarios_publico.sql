-- View pública com apenas as colunas de "usuarios" seguras para qualquer pessoa ver
-- (username, foto de perfil) — a tabela "usuarios" continua restrita a auth.uid() = id.
-- Views sem "security_invoker" rodam com o privilégio do dono (postgres, que tem
-- bypassrls), então esta view ignora a RLS restritiva da tabela base de propósito.
create view public.usuarios_publico as
  select id, username, foto_perfil, perfil_privado
  from public.usuarios;

grant select on public.usuarios_publico to anon, authenticated;
