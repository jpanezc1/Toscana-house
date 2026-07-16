-- Cierre de documentos públicos después de adoptar el cliente con enlaces firmados.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $$
begin
  if exists(
    select 1 from public.usuarios
    where estado='activo' and auth_id is null
  ) then
    raise exception 'No se puede cerrar Storage: hay usuarios activos sin Supabase Auth';
  end if;

  if exists(
    select 1 from storage.buckets
    where id in ('cargas-evidencia','notas') and public
  ) and public.th_resolver_feature_flag(
    'production','DOCUMENTOS_PRIVADOS','__storage_gate__','__storage_gate__'
  ) <> 'transactional' then
    raise exception 'No se puede cerrar Storage: falta el gate production/DOCUMENTOS_PRIVADOS=transactional';
  end if;
end $$;

update storage.buckets
set public=false
where id in ('cargas-evidencia','notas');

commit;
