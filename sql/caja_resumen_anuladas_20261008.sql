-- Incluye las anulaciones por separado, sin sumarlas al efectivo esperado.
create or replace function public.caja_resumen(p_turno uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_turno public.th_caja_turnos; v_ventas jsonb; v_mov jsonb;
        v_mov_cantidad bigint; v_aportes numeric; v_retiros numeric;
begin
  perform public.caja_actor();
  select * into v_turno from public.th_caja_turnos where id = p_turno;
  if not found then raise exception 'Turno inexistente'; end if;
  select jsonb_build_object(
    'cantidad', count(*) filter (where coalesce(anulada,false)=false),
    'total', coalesce(sum(total) filter (where coalesce(anulada,false)=false),0),
    'efectivo', coalesce(sum(efectivo) filter (where coalesce(anulada,false)=false),0),
    'qr', coalesce(sum(qr) filter (where coalesce(anulada,false)=false),0),
    'tarjeta', coalesce(sum(tarjeta) filter (where coalesce(anulada,false)=false),0),
    'giftcard', coalesce(sum(gc_usado) filter (where coalesce(anulada,false)=false),0),
    'anuladas_cantidad', count(*) filter (where coalesce(anulada,false)=true),
    'anuladas_total', coalesce(sum(total) filter (where coalesce(anulada,false)=true),0)
  ) into v_ventas from public.ventas where caja_turno_id = p_turno;
  select coalesce(sum(monto) filter (where tipo='aporte'),0),
         coalesce(sum(monto) filter (where tipo='retiro'),0), count(*)
    into v_aportes,v_retiros,v_mov_cantidad
    from public.th_caja_movimientos where turno_id = p_turno;
  v_mov := jsonb_build_object('aportes',v_aportes,'retiros',v_retiros,'cantidad',v_mov_cantidad);
  return jsonb_build_object('turno_id',p_turno,'apertura',v_turno.efectivo_apertura,
    'ventas',v_ventas,'movimientos',v_mov,
    'esperado',v_turno.efectivo_apertura + (v_ventas->>'efectivo')::numeric + v_aportes - v_retiros);
end $$;
revoke all on function public.caja_resumen(uuid) from public, anon;
grant execute on function public.caja_resumen(uuid) to authenticated;
