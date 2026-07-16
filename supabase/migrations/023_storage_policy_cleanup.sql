-- Retira políticas anónimas heredadas y limita documentos autenticados por entidad/rol.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $$
begin
  if exists(select 1 from public.usuarios where estado='activo' and auth_id is null) then
    raise exception 'No se puede cerrar Storage: existen usuarios activos sin Auth';
  end if;
  if exists(select 1 from storage.buckets
    where id in ('cargas-evidencia','notas') and public) then
    raise exception 'No se puede limpiar Storage: los buckets aún son públicos';
  end if;
end $$;

drop policy if exists evidencia_insert on storage.objects;
drop policy if exists evidencia_public_read on storage.objects;
drop policy if exists notas_anon_delete on storage.objects;
drop policy if exists notas_anon_insert on storage.objects;
drop policy if exists notas_anon_update on storage.objects;
drop policy if exists notas_public_read on storage.objects;

drop policy if exists th_documentos_privados_lectura on storage.objects;
create policy th_documentos_privados_lectura
on storage.objects for select to authenticated
using (
  (
    bucket_id='notas'
    and exists(
      select 1 from public.th_current_profile() p
      where p.rol='admin'
        or (p.rol='caja' and exists(
          select 1 from public.ventas v where v.id=split_part(storage.objects.name,'/',1)
        ))
        or (p.rol='marca' and exists(
          select 1 from public.venta_items vi
          where vi.venta_id=split_part(storage.objects.name,'/',1)
            and vi.marca_id=p.marca_id
        ))
    )
  )
  or
  (
    bucket_id='cargas-evidencia'
    and exists(
      select 1 from public.th_current_profile() p
      where p.rol='admin'
        or (p.rol='marca' and exists(
          select 1 from public.cargas_inventario c
          where c.id=split_part(storage.objects.name,'/',1)
            and c.marca_id=p.marca_id
        ))
    )
  )
);

drop policy if exists th_documentos_privados_insertar on storage.objects;
create policy th_documentos_privados_insertar
on storage.objects for insert to authenticated
with check (
  (bucket_id='cargas-evidencia' and exists(
    select 1 from public.th_current_profile() p where p.rol in ('admin','marca')
  ))
  or
  (bucket_id='notas' and exists(
    select 1 from public.th_current_profile() p
    where p.rol='admin'
      or (p.rol='caja' and exists(
        select 1 from public.ventas v where v.id=split_part(storage.objects.name,'/',1)
      ))
      or (p.rol='marca' and exists(
        select 1 from public.venta_items vi
        where vi.venta_id=split_part(storage.objects.name,'/',1)
          and vi.marca_id=p.marca_id
      ))
  ))
);

drop policy if exists th_documentos_privados_actualizar on storage.objects;
create policy th_documentos_privados_actualizar
on storage.objects for update to authenticated
using (
  (bucket_id='cargas-evidencia' and exists(
    select 1 from public.th_current_profile() p
    where p.rol='admin' or (p.rol='marca' and exists(
      select 1 from public.cargas_inventario c
      where c.id=split_part(storage.objects.name,'/',1) and c.marca_id=p.marca_id
    ))
  ))
  or
  (bucket_id='notas' and exists(
    select 1 from public.th_current_profile() p
    where p.rol='admin'
      or (p.rol='caja' and exists(
        select 1 from public.ventas v where v.id=split_part(storage.objects.name,'/',1)
      ))
      or (p.rol='marca' and exists(
        select 1 from public.venta_items vi
        where vi.venta_id=split_part(storage.objects.name,'/',1) and vi.marca_id=p.marca_id
      ))
  ))
)
with check (bucket_id in ('cargas-evidencia','notas'));

drop policy if exists th_documentos_privados_eliminar on storage.objects;
create policy th_documentos_privados_eliminar
on storage.objects for delete to authenticated
using (
  bucket_id in ('cargas-evidencia','notas')
  and exists(select 1 from public.th_current_profile() p where p.rol='admin')
);

do $$
begin
  if exists(select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname in (
        'evidencia_insert','evidencia_public_read','notas_anon_delete',
        'notas_anon_insert','notas_anon_update','notas_public_read'
      )) then
    raise exception 'Persisten políticas legacy de Storage';
  end if;
end $$;

commit;
