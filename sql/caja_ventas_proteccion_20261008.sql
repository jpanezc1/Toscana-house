-- Protege los importes asociados a un arqueo sin modificar ventas anteriores.
-- Las ventas sin turno siguen sujetas a la política heredada hasta migrar todo
-- el sistema; este trigger no declara segura a la tabla ventas completa.
create or replace function public.th_caja_proteger_venta()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_estado text;
begin
  if tg_op = 'UPDATE' and old.caja_turno_id is not null then
    if new.caja_turno_id is distinct from old.caja_turno_id then
      raise exception 'No se puede cambiar el turno de una venta registrada';
    end if;
    if row(new.total,new.subtotal,new.metodo_pago,new.efectivo,new.qr,new.tarjeta,new.gc_usado)
       is distinct from
       row(old.total,old.subtotal,old.metodo_pago,old.efectivo,old.qr,old.tarjeta,old.gc_usado) then
      raise exception 'El importe y método de una venta de caja son inmutables';
    end if;
  end if;

  if new.caja_turno_id is not null then
    perform public.caja_actor();
    select estado into v_estado from public.th_caja_turnos where id=new.caja_turno_id;
    if v_estado is null then raise exception 'Turno de caja inexistente'; end if;
    if tg_op='INSERT' and v_estado <> 'abierto' then
      raise exception 'El turno de caja ya está cerrado';
    end if;
    if tg_op='UPDATE' and old.caja_turno_id is null then
      raise exception 'No se puede asociar una venta anterior a un turno';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists th_caja_proteger_venta on public.ventas;
create trigger th_caja_proteger_venta before insert or update on public.ventas
for each row execute function public.th_caja_proteger_venta();
revoke all on function public.th_caja_proteger_venta() from public, anon, authenticated;
