-- Toscana House — RLS de las entidades nuevas.
-- No modifica todavía las políticas legacy de inventario/ventas para evitar interrupciones.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

create or replace function public.th_current_profile()
returns table(usuario text,rol text,marca_id integer)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.usuario,u.rol,u.marca_id
  from public.usuarios u
  where u.auth_id=auth.uid() and u.estado='activo'
  limit 1;
$$;

revoke all on function public.th_current_profile() from public,anon;
grant execute on function public.th_current_profile() to authenticated,service_role;

alter table public.th_operaciones enable row level security;
alter table public.movimientos_inventario enable row level security;
alter table public.th_feature_flags enable row level security;
alter table public.inventario_saldos_apertura enable row level security;
alter table public.th_shadow_observaciones enable row level security;
alter table public.gift_cards enable row level security;
alter table public.gift_card_usos enable row level security;
alter table public.cajas enable row level security;
alter table public.caja_turnos enable row level security;
alter table public.facturas_venta enable row level security;
alter table public.cambios enable row level security;
alter table public.cambio_items enable row level security;
alter table public.bajas_inventario enable row level security;

grant select on public.th_operaciones,public.movimientos_inventario,public.th_feature_flags,
  public.inventario_saldos_apertura,public.th_shadow_observaciones,public.gift_cards,
  public.gift_card_usos,public.cajas,public.caja_turnos,public.facturas_venta,
  public.cambios,public.cambio_items,public.bajas_inventario to authenticated;

revoke all on public.th_inventario_conciliacion,public.th_ventas_integridad from public,anon,authenticated;

drop policy if exists th_operaciones_lectura on public.th_operaciones;
create policy th_operaciones_lectura on public.th_operaciones for select to authenticated
using (
  auth_id=auth.uid()
  or exists(select 1 from public.th_current_profile() p where p.rol='admin')
);

drop policy if exists movimientos_lectura on public.movimientos_inventario;
create policy movimientos_lectura on public.movimientos_inventario for select to authenticated
using (
  exists(select 1 from public.th_current_profile() p
    where p.rol in ('admin','caja')
       or (p.rol='marca' and exists(
         select 1 from public.inventario i where i.id=movimientos_inventario.producto_id and i.marca_id=p.marca_id
       )))
);

drop policy if exists feature_flags_lectura on public.th_feature_flags;
create policy feature_flags_lectura on public.th_feature_flags for select to authenticated using (enabled);

drop policy if exists apertura_admin_lectura on public.inventario_saldos_apertura;
create policy apertura_admin_lectura on public.inventario_saldos_apertura for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol='admin'));

drop policy if exists shadow_admin_lectura on public.th_shadow_observaciones;
create policy shadow_admin_lectura on public.th_shadow_observaciones for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol='admin'));

drop policy if exists gift_cards_lectura on public.gift_cards;
create policy gift_cards_lectura on public.gift_cards for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol in ('admin','caja')));

drop policy if exists gift_card_usos_lectura on public.gift_card_usos;
create policy gift_card_usos_lectura on public.gift_card_usos for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol in ('admin','caja')));

drop policy if exists cajas_lectura on public.cajas;
create policy cajas_lectura on public.cajas for select to authenticated
using (exists(select 1 from public.th_current_profile()));

drop policy if exists caja_turnos_lectura on public.caja_turnos;
create policy caja_turnos_lectura on public.caja_turnos for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol in ('admin','caja')));

drop policy if exists facturas_lectura on public.facturas_venta;
create policy facturas_lectura on public.facturas_venta for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol in ('admin','caja')));

drop policy if exists cambios_lectura on public.cambios;
create policy cambios_lectura on public.cambios for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol in ('admin','caja')));

drop policy if exists cambio_items_lectura on public.cambio_items;
create policy cambio_items_lectura on public.cambio_items for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol in ('admin','caja')));

drop policy if exists bajas_lectura on public.bajas_inventario;
create policy bajas_lectura on public.bajas_inventario for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol='admin'));

-- Las escrituras quedan exclusivamente en RPC SECURITY DEFINER. No hay políticas INSERT/UPDATE/DELETE.
commit;
