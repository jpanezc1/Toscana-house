-- Caja Toscana: categorías y canales como ReKids, sin reemplazar el libro
-- transaccional ni reescribir cierres ya guardados.
alter table public.th_caja_movimientos
  add column if not exists categoria text,
  add column if not exists metodo text not null default 'efectivo',
  add column if not exists comprobante text,
  add column if not exists saldo_efectivo numeric(12,2);

update public.th_caja_movimientos
  set categoria = case when tipo = 'aporte' then 'aporte' else 'retiro' end
  where categoria is null;

alter table public.th_caja_movimientos
  add constraint caja_mov_categoria_valida
    check (categoria in ('gasto','retiro','deposito','aporte','reversa'));
alter table public.th_caja_movimientos
  add constraint caja_mov_metodo_valido check (metodo in ('efectivo','qr'));

create or replace function public.th_caja_mov_clasificar()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.categoria is null then
    new.categoria := case when new.tipo='aporte' then 'aporte' else 'retiro' end;
  end if;
  return new;
end $$;
create trigger th_caja_mov_clasificar before insert on public.th_caja_movimientos
for each row execute function public.th_caja_mov_clasificar();

-- Nueva RPC: la antigua caja_movimiento permanece para las sesiones que aún
-- no se hayan actualizado. Ninguna de las dos borra movimientos.
create or replace function public.caja_movimiento_detallado(
  p_turno uuid, p_categoria text, p_metodo text, p_monto numeric,
  p_concepto text, p_entregado_a text default null,
  p_comprobante text default null, p_reversa_de uuid default null
) returns public.th_caja_movimientos
language plpgsql security definer set search_path = '' as $$
declare
  v_usuario text; v_turno public.th_caja_turnos;
  v_original public.th_caja_movimientos; v_mov public.th_caja_movimientos;
  v_tipo text;
begin
  v_usuario := public.caja_actor();
  select * into v_turno from public.th_caja_turnos where id = p_turno for update;
  if not found or v_turno.estado <> 'abierto' then raise exception 'Turno no abierto'; end if;
  if p_categoria not in ('gasto','retiro','deposito','aporte','reversa')
     or p_metodo not in ('efectivo','qr')
     or p_monto is null or p_monto <= 0 or p_monto > 1000000
     or round(p_monto,2) <> p_monto
     or nullif(trim(p_concepto),'') is null
     or length(trim(p_concepto)) > 300
     or (p_categoria in ('retiro','deposito') and length(trim(coalesce(p_entregado_a,''))) < 3)
     or (p_categoria = 'reversa' and p_reversa_de is null)
     or (p_categoria <> 'reversa' and p_reversa_de is not null)
     or (p_comprobante is not null and
         (length(p_comprobante) > 255 or p_comprobante not like p_turno::text || '/%')) then
    raise exception 'Movimiento inválido';
  end if;
  v_tipo := case when p_categoria = 'aporte' then 'aporte' else 'retiro' end;
  if p_reversa_de is not null then
    select * into v_original from public.th_caja_movimientos
     where id = p_reversa_de and turno_id = p_turno;
    if not found or v_original.reversa_de is not null
       or exists(select 1 from public.th_caja_movimientos where reversa_de = p_reversa_de)
       or v_original.monto <> p_monto or v_original.metodo <> p_metodo then
      raise exception 'Reversa inválida';
    end if;
    v_tipo := case when v_original.tipo = 'retiro' then 'aporte' else 'retiro' end;
  end if;
  insert into public.th_caja_movimientos
    (turno_id,tipo,monto,destinatario,motivo,creado_por,creado_usuario,
     reversa_de,categoria,metodo,comprobante)
  values
    (p_turno,v_tipo,p_monto,coalesce(nullif(trim(p_entregado_a),''),'Toscana House'),
     trim(p_concepto),auth.uid(),v_usuario,p_reversa_de,p_categoria,p_metodo,p_comprobante)
  returning * into v_mov;
  update public.th_caja_movimientos
     set saldo_efectivo = (public.caja_resumen(p_turno)->>'esperado')::numeric
   where id = v_mov.id returning * into v_mov;
  return v_mov;
end $$;
revoke all on function public.caja_movimiento_detallado(uuid,text,text,numeric,text,text,text,uuid) from public, anon;
grant execute on function public.caja_movimiento_detallado(uuid,text,text,numeric,text,text,text,uuid) to authenticated;

-- El arqueo del cajón cuenta únicamente efectivo. QR fuera de ventas se
-- informa por separado. La gift card no vuelve a ingresar dinero al cobrar.
create or replace function public.caja_resumen(p_turno uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_turno public.th_caja_turnos; v_ventas jsonb; v_mov jsonb;
  v_prendas bigint; v_aportes numeric; v_salidas numeric;
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

  select coalesce(sum(i.cantidad),0) into v_prendas
    from public.venta_items i join public.ventas v on v.id=i.venta_id
   where v.caja_turno_id=p_turno and coalesce(v.anulada,false)=false;
  v_ventas := v_ventas || jsonb_build_object('prendas',v_prendas);

  select jsonb_build_object(
    'cantidad', count(*),
    'aportes', coalesce(sum(monto) filter (where tipo='aporte' and metodo='efectivo'),0),
    'retiros', coalesce(sum(monto) filter (where tipo='retiro' and metodo='efectivo'),0),
    'gastos', coalesce(sum(monto) filter (where tipo='retiro' and metodo='efectivo' and categoria='gasto'),0),
    'retiros_puros', coalesce(sum(monto) filter (where tipo='retiro' and metodo='efectivo' and categoria='retiro'),0),
    'depositos', coalesce(sum(monto) filter (where tipo='retiro' and metodo='efectivo' and categoria='deposito'),0),
    'qr_ingresos', coalesce(sum(monto) filter (where tipo='aporte' and metodo='qr'),0),
    'qr_egresos', coalesce(sum(monto) filter (where tipo='retiro' and metodo='qr'),0)
  ) into v_mov from public.th_caja_movimientos where turno_id = p_turno;
  v_aportes := (v_mov->>'aportes')::numeric;
  v_salidas := (v_mov->>'retiros')::numeric;
  return jsonb_build_object('turno_id',p_turno,'apertura',v_turno.efectivo_apertura,
    'ventas',v_ventas,'movimientos',v_mov,
    'esperado',v_turno.efectivo_apertura + (v_ventas->>'efectivo')::numeric + v_aportes - v_salidas);
end $$;
revoke all on function public.caja_resumen(uuid) from public, anon;
grant execute on function public.caja_resumen(uuid) to authenticated;

-- Cierre en dos pasos: el resumen que la cajera revisó debe coincidir con la
-- foto transaccional del momento de cerrar. Si otra caja registró una venta o
-- un movimiento mientras miraba la vista previa, debe revisar otra vez.
create or replace function public.caja_cerrar_verificado(
  p_turno uuid, p_contado numeric, p_revision jsonb
) returns public.th_caja_turnos
language plpgsql security definer set search_path = '' as $$
declare v_usuario text; v_turno public.th_caja_turnos; v_resumen jsonb;
begin
  v_usuario := public.caja_actor();
  if p_contado is null or p_contado < 0 or p_contado > 1000000
     or round(p_contado,2) <> p_contado then raise exception 'Efectivo contado inválido'; end if;
  select * into v_turno from public.th_caja_turnos where id = p_turno for update;
  if not found or v_turno.estado <> 'abierto' then raise exception 'Turno no abierto'; end if;
  v_resumen := public.caja_resumen(p_turno);
  if exists (
    select 1 from public.ventas v where v.caja_turno_id=p_turno
      and coalesce(v.anulada,false)=false
      and not exists(select 1 from public.venta_items i where i.venta_id=v.id)
  ) then
    raise exception 'Hay una venta del turno sin detalle de prendas. Esperá la sincronización antes de cerrar.';
  end if;
  if p_revision is null or v_resumen <> p_revision then
    raise exception 'La caja cambió desde que se mostró el resumen. Actualizá y revisá antes de cerrar.';
  end if;
  v_resumen := v_resumen || jsonb_build_object('contado',p_contado,
    'diferencia',p_contado-(v_resumen->>'esperado')::numeric);
  update public.th_caja_turnos set estado='cerrado',cerrado_por=auth.uid(),
    cerrado_usuario=v_usuario,cerrado_at=now(),efectivo_contado=p_contado,
    cierre_resumen=v_resumen where id=p_turno returning * into v_turno;
  return v_turno;
end $$;
revoke all on function public.caja_cerrar_verificado(uuid,numeric,jsonb) from public, anon;
grant execute on function public.caja_cerrar_verificado(uuid,numeric,jsonb) to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('caja-comprobantes','caja-comprobantes',false,5242880,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
create policy caja_comprobante_leer on storage.objects for select to authenticated
  using (bucket_id='caja-comprobantes' and public.caja_actor() is not null);
create policy caja_comprobante_subir on storage.objects for insert to authenticated
  with check (
    bucket_id='caja-comprobantes' and public.caja_actor() is not null
    and exists(select 1 from public.th_caja_turnos t
      where t.id::text=split_part(name,'/',1) and t.estado='abierto')
  );
