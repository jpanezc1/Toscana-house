-- Reinicio operativo de caja solicitado el 09/10/2026.
-- Conserva las 11 ventas reales del 08/10 y sus vínculos para auditoría.
-- Los dos turnos del día de arranque quedan fuera de la vista operativa;
-- no se inventa un cierre ni se altera dinero, inventario o facturas.
begin;
set local lock_timeout = '5s';

alter table public.th_caja_turnos
  add column if not exists descartado_at timestamptz,
  add column if not exists descarte_motivo text;

do $$
declare
  v_ids uuid[] := array[
    '50a49f72-9ae1-462f-8e71-e0429fea299e'::uuid,
    'a71236c0-a704-43ee-9622-7350535c27e8'::uuid
  ];
  v_turnos integer;
  v_ventas integer;
  v_total numeric;
begin
  -- El ALTER anterior mantiene bloqueadas las escrituras concurrentes.
  select count(*) into v_turnos from public.th_caja_turnos
   where id = any(v_ids)
     and abierto_at >= timestamptz '2026-10-08 04:00:00+00'
     and abierto_at < timestamptz '2026-10-09 04:00:00+00'
     and descartado_at is null
     and ((id = v_ids[1] and estado = 'cerrado')
       or (id = v_ids[2] and estado = 'abierto'));
  if v_turnos <> 2 then
    raise exception 'Cambió el estado de los turnos; no se descarta nada';
  end if;

  if exists(select 1 from public.th_caja_movimientos where turno_id = any(v_ids)) then
    raise exception 'Aparecieron movimientos de caja; revisar antes de continuar';
  end if;

  select count(*),coalesce(sum(total) filter (where coalesce(anulada,false)=false),0)
    into v_ventas,v_total from public.ventas where caja_turno_id = any(v_ids);
  if v_ventas <> 11 or v_total <> 5345.50 then
    raise exception 'Cambió el conjunto de ventas; no se descarta nada';
  end if;
  if exists(select 1 from public.ventas
     where caja_turno_id = any(v_ids) and fecha <> '2026-10-08') then
    raise exception 'Hay ventas de otro día vinculadas; no se descarta nada';
  end if;
end $$;

alter table public.th_caja_turnos drop constraint th_caja_turnos_estado_check;
alter table public.th_caja_turnos drop constraint caja_cierre_completo;
alter table public.th_caja_turnos add constraint th_caja_turnos_estado_check
  check (estado in ('abierto','cerrado','descartado'));
alter table public.th_caja_turnos add constraint caja_cierre_completo check (
  (estado='abierto' and cerrado_at is null and efectivo_contado is null and descartado_at is null)
  or (estado='cerrado' and cerrado_at is not null and efectivo_contado is not null
      and cierre_resumen is not null and descartado_at is null)
  or (estado='descartado' and descartado_at is not null
      and nullif(trim(descarte_motivo),'') is not null)
);

update public.th_caja_turnos
   set estado='descartado', descartado_at=now(),
       descarte_motivo='Reinicio operativo solicitado: caja comienza el 09/10/2026. Ventas del 08/10 conservadas sin modificación.'
 where id in (
   '50a49f72-9ae1-462f-8e71-e0429fea299e'::uuid,
   'a71236c0-a704-43ee-9622-7350535c27e8'::uuid
 );

commit;
