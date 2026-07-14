-- Evidencias de inventario y notas de venta: almacenamiento privado con RLS.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
  ('cargas-evidencia','cargas-evidencia',false,10485760,
    array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]),
  ('notas','notas',false,5242880,array['application/pdf']::text[])
on conflict (id) do update set
  -- Compatibilidad de despliegue: un bucket ya existente conserva temporalmente
  -- su visibilidad. Producción se vuelve privada en una migración posterior,
  -- sólo después de desplegar el cliente con enlaces firmados y migrar Auth.
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists th_documentos_privados_lectura on storage.objects;
create policy th_documentos_privados_lectura
on storage.objects for select to authenticated
using (
  bucket_id in ('cargas-evidencia','notas')
  and exists(select 1 from public.th_current_profile())
);

drop policy if exists th_documentos_privados_insertar on storage.objects;
create policy th_documentos_privados_insertar
on storage.objects for insert to authenticated
with check (
  bucket_id in ('cargas-evidencia','notas')
  and exists(select 1 from public.th_current_profile())
);

drop policy if exists th_documentos_privados_actualizar on storage.objects;
create policy th_documentos_privados_actualizar
on storage.objects for update to authenticated
using (
  bucket_id in ('cargas-evidencia','notas')
  and exists(select 1 from public.th_current_profile())
)
with check (
  bucket_id in ('cargas-evidencia','notas')
  and exists(select 1 from public.th_current_profile())
);

drop policy if exists th_documentos_privados_eliminar on storage.objects;
create policy th_documentos_privados_eliminar
on storage.objects for delete to authenticated
using (
  bucket_id in ('cargas-evidencia','notas')
  and exists(select 1 from public.th_current_profile() p where p.rol='admin')
);

commit;
