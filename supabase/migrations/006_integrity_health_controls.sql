-- Toscana House — restricciones aditivas, salud operativa y activación auditada
-- Las restricciones NOT VALID protegen escrituras nuevas sin bloquear por datos históricos.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='inventario_stock_no_negativo_chk' and conrelid='public.inventario'::regclass) then
    alter table public.inventario add constraint inventario_stock_no_negativo_chk
      check (stock >= 0 and stock_inicial >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='inventario_codigo_no_vacio_chk' and conrelid='public.inventario'::regclass) then
    alter table public.inventario add constraint inventario_codigo_no_vacio_chk
      check (nullif(btrim(codigo),'') is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='venta_items_cantidad_positiva_chk' and conrelid='public.venta_items'::regclass) then
    alter table public.venta_items add constraint venta_items_cantidad_positiva_chk
      check (cantidad > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='retiros_cantidad_positiva_chk' and conrelid='public.retiros'::regclass) then
    alter table public.retiros add constraint retiros_cantidad_positiva_chk
      check (cantidad > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='bajas_cantidad_positiva_chk' and conrelid='public.bajas_inventario'::regclass) then
    alter table public.bajas_inventario add constraint bajas_cantidad_positiva_chk
      check (cantidad > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='gift_cards_saldo_valido_chk' and conrelid='public.gift_cards'::regclass) then
    alter table public.gift_cards add constraint gift_cards_saldo_valido_chk
      check (monto >= 0 and saldo >= 0 and saldo <= monto) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='descuentos_pct_valido_chk' and conrelid='public.config_descuentos'::regclass) then
    alter table public.config_descuentos add constraint descuentos_pct_valido_chk
      check (pct >= 0 and pct <= 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='descuentos_codigo_pct_valido_chk' and conrelid='public.descuentos_codigo'::regclass) then
    alter table public.descuentos_codigo add constraint descuentos_codigo_pct_valido_chk
      check (pct >= 0 and pct <= 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname='cambio_items_direccion_chk' and conrelid='public.cambio_items'::regclass) then
    alter table public.cambio_items add constraint cambio_items_direccion_chk
      check (direccion in ('ENTRADA','SALIDA')) not valid;
  end if;
end $$;

create or replace function public.th_prevenir_mutacion_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op='UPDATE' and new is not distinct from old then
    return new;
  end if;
  raise exception using
    errcode='42501',
    message='El registro de auditoría es inmutable; agregue un evento compensatorio';
end;
$$;

drop trigger if exists audit_log_no_delete on public.audit_log;
drop trigger if exists audit_log_inmutable on public.audit_log;
create trigger audit_log_inmutable
before update or delete on public.audit_log
for each row execute function public.th_prevenir_mutacion_audit();

create or replace view public.th_ventas_integridad as
select
  v.id as venta_id,
  v.operation_id,
  v.engine,
  v.anulada,
  count(vi.id)::integer as lineas,
  coalesce(sum(vi.subtotal),0)::numeric as suma_lineas,
  coalesce(v.subtotal,0)::numeric as subtotal_cabecera,
  (coalesce(sum(vi.subtotal),0)-coalesce(v.subtotal,0))::numeric as diferencia_subtotal,
  count(*) filter (where vi.prod_id is null)::integer as lineas_sin_producto
from public.ventas v
left join public.venta_items vi on vi.venta_id=v.id
group by v.id,v.operation_id,v.engine,v.anulada,v.subtotal;

create or replace function public.th_system_health(
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_result jsonb;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  select jsonb_build_object(
    'ok',
      (negativeStock=0 and emptyCodes=0 and duplicateCodes=0 and orphanSaleLines=0
       and duplicateSaleLines=0 and partialRejectedOperations=0 and staleOperations=0
       and ledgerDifferences=0),
    'checkedAt',clock_timestamp(),
    'negativeStock',negativeStock,
    'emptyCodes',emptyCodes,
    'duplicateCodes',duplicateCodes,
    'orphanSaleLines',orphanSaleLines,
    'duplicateSaleLines',duplicateSaleLines,
    'salesWithoutLines',salesWithoutLines,
    'confirmedWithoutAudit',confirmedWithoutAudit,
    'partialRejectedOperations',partialRejectedOperations,
    'staleOperations',staleOperations,
    'ledgerDifferences',ledgerDifferences,
    'shadowDifferences',shadowDifferences,
    'productionMode',public.th_resolver_feature_flag('production','*','*','*')
  ) into v_result
  from (
    select
      (select count(*) from public.inventario where stock<0 or stock_inicial<0) as negativeStock,
      (select count(*) from public.inventario where nullif(btrim(codigo),'') is null) as emptyCodes,
      (select count(*) from (select upper(btrim(codigo)) from public.inventario group by 1 having count(*)>1) d) as duplicateCodes,
      (select count(*) from public.venta_items vi left join public.ventas v on v.id=vi.venta_id where v.id is null) as orphanSaleLines,
      (select count(*) from (select venta_id,line_key from public.venta_items where line_key is not null group by 1,2 having count(*)>1) d) as duplicateSaleLines,
      (select count(*) from public.ventas v where not exists(select 1 from public.venta_items vi where vi.venta_id=v.id)) as salesWithoutLines,
      (select count(*) from public.th_operaciones o where o.estado='confirmada' and not exists(select 1 from public.audit_log a where a.operation_id=o.id)) as confirmedWithoutAudit,
      (select count(*) from public.th_operaciones o where o.estado='rechazada' and (
        exists(select 1 from public.movimientos_inventario m where m.operation_id=o.id)
        or exists(select 1 from public.ventas v where v.operation_id=o.id)
      )) as partialRejectedOperations,
      (select count(*) from public.th_operaciones where estado='procesando' and updated_at<now()-interval '5 minutes') as staleOperations,
      (select count(*) from public.th_inventario_conciliacion where diferencia<>0) as ledgerDifferences,
      (select count(*) from public.th_shadow_observaciones where diferencia<>0 and created_at>now()-interval '24 hours') as shadowDifferences
  ) x;
  return v_result;
end;
$$;

create or replace function public.th_configurar_feature_flag(
  p_ambiente text,
  p_operacion text,
  p_modo text,
  p_usuario text default '*',
  p_device_id text default '*',
  p_motivo text default '',
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_operation_id uuid:=gen_random_uuid();
begin
  perform public.th_require_roles(v_actor,array['admin']);
  if p_modo not in ('legacy','shadow','transactional') then
    raise exception using errcode='22023',message='Modo de operación inválido';
  end if;
  if coalesce(nullif(p_ambiente,''),'') not in ('production','staging','local','*') then
    raise exception using errcode='22023',message='Ambiente inválido';
  end if;

  insert into public.th_feature_flags(
    ambiente,operacion,usuario,device_id,modo,enabled,updated_by,updated_at,metadata
  ) values(
    p_ambiente,coalesce(nullif(p_operacion,''),'*'),coalesce(nullif(p_usuario,''),'*'),
    coalesce(nullif(p_device_id,''),'*'),p_modo,true,v_actor->>'usuario',now(),
    jsonb_build_object('motivo',coalesce(p_motivo,''),'operationId',v_operation_id)
  )
  on conflict (ambiente,operacion,usuario,device_id) do update set
    modo=excluded.modo,enabled=true,updated_by=excluded.updated_by,
    updated_at=excluded.updated_at,metadata=excluded.metadata;

  perform public.th_append_audit(
    v_operation_id,'FEATURE_FLAG',v_actor,
    jsonb_build_object('ambiente',p_ambiente,'operacion',p_operacion,'usuario',p_usuario,
      'deviceId',p_device_id,'modo',p_modo,'motivo',p_motivo)
  );
  return jsonb_build_object('ok',true,'operationId',v_operation_id,'ambiente',p_ambiente,
    'operacion',p_operacion,'usuario',p_usuario,'deviceId',p_device_id,'modo',p_modo);
end;
$$;

revoke all on function public.th_system_health(jsonb) from public,anon;
revoke all on function public.th_configurar_feature_flag(text,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.th_system_health(jsonb) to authenticated,service_role;
grant execute on function public.th_configurar_feature_flag(text,text,text,text,text,text,jsonb) to authenticated,service_role;

commit;
