-- GATE MANUAL IRREVERSIBLE.
-- Ejecutar únicamente después de verificar que todos los usuarios activos pueden iniciar con Supabase Auth.

begin;
do $$
begin
  if exists(select 1 from public.usuarios where estado='activo' and auth_id is null) then
    raise exception 'Hay usuarios activos sin auth_id; no se purgaron contraseñas legacy';
  end if;
end $$;

update public.usuarios set password=null where password is not null;
comment on column public.usuarios.password is 'LEGACY: debe permanecer NULL; credenciales administradas por Supabase Auth';
commit;

select count(*) as legacy_passwords_remaining from public.usuarios where password is not null;
