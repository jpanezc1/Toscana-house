-- GATE MANUAL. Ejecutar sólo después de staging, usuarios Auth completos y flags transaccionales.
-- Este archivo no pertenece a la secuencia automática de migraciones.

begin;

do $$
declare
  v_operacion text;
  v_operaciones text[]:=array[
    'VENTA','VENTA_HISTORICA','IMPORT_VENTAS_LIBRES','ANULACION','CAMBIO',
    'RETIRO','BAJA','REPOSICION','RECEPCION','IMPORTACION','REVERSO_CARGA',
    'AJUSTE_AUDITORIA','EDICION_PRODUCTO','DESACTIVAR_PRODUCTO','RECUPERACION_INVENTARIO'
  ];
begin
  if exists(select 1 from public.usuarios where estado='activo' and auth_id is null) then
    raise exception 'No se puede activar RLS legacy: hay usuarios activos sin auth_id';
  end if;
  foreach v_operacion in array v_operaciones loop
    if public.th_resolver_feature_flag('production',v_operacion,'__rls_gate__','__rls_gate__')<>'transactional' then
      raise exception 'No se puede activar RLS: la operación % no está en transactional para toda producción',v_operacion;
    end if;
  end loop;
end $$;

alter table public.inventario enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_items enable row level security;
alter table public.retiros enable row level security;
alter table public.usuarios enable row level security;

grant select on public.inventario,public.ventas,public.venta_items,public.retiros,public.usuarios to authenticated;
revoke insert,update,delete on public.inventario,public.ventas,public.venta_items,public.retiros,public.usuarios from authenticated;
revoke all on public.inventario,public.ventas,public.venta_items,public.retiros,public.usuarios from anon;

-- Retirar políticas heredadas `using (true)`; una política permisiva se suma a
-- las nuevas y anularía por completo la separación por rol.
drop policy if exists public_all on public.inventario;
drop policy if exists public_all on public.ventas;
drop policy if exists public_all on public.venta_items;
drop policy if exists "allow all retiros" on public.retiros;
drop policy if exists "allow all usuarios" on public.usuarios;

drop policy if exists inventario_lectura_operativa on public.inventario;
create policy inventario_lectura_operativa on public.inventario for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol in ('admin','caja') or (p.rol='marca' and p.marca_id=inventario.marca_id)));

drop policy if exists ventas_lectura_operativa on public.ventas;
create policy ventas_lectura_operativa on public.ventas for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol in ('admin','caja') or (p.rol='marca' and exists(
    select 1 from public.venta_items vi where vi.venta_id=ventas.id and vi.marca_id=p.marca_id
  ))));

drop policy if exists venta_items_lectura_operativa on public.venta_items;
create policy venta_items_lectura_operativa on public.venta_items for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol in ('admin','caja') or (p.rol='marca' and p.marca_id=venta_items.marca_id)));

drop policy if exists retiros_lectura_operativa on public.retiros;
create policy retiros_lectura_operativa on public.retiros for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol in ('admin','caja') or (p.rol='marca' and p.marca_id=retiros.marca_id)));

drop policy if exists usuarios_lectura_perfil on public.usuarios;
create policy usuarios_lectura_perfil on public.usuarios for select to authenticated
using (
  auth_id=auth.uid()
  or exists(select 1 from public.th_current_profile() p where p.rol='admin')
);

-- No se crean políticas de escritura: los cambios pasan por RPC autorizadas.
-- Cargas, auditorías y audit_log quedan fuera de este gate hasta tener sus propias RPC.
commit;
