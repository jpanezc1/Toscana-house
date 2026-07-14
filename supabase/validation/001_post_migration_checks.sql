-- Validación solo lectura posterior a migraciones.
-- PASS exige affected=0 salvo los checks INFO.

begin;
set local statement_timeout='60s';
set local lock_timeout='5s';

select 'ERROR' as severity,'negative_stock' as check_name,count(*)::bigint as affected
from public.inventario where stock<0 or stock_inicial<0
union all
select 'ERROR','empty_product_codes',count(*) from public.inventario where nullif(btrim(codigo),'') is null
union all
select 'ERROR','duplicate_product_codes',count(*) from (
  select upper(btrim(codigo)) from public.inventario
  where nullif(btrim(codigo),'') is not null group by 1 having count(*)>1
) x
union all
select 'ERROR','orphan_sale_lines',count(*) from public.venta_items vi
left join public.ventas v on v.id=vi.venta_id where v.id is null
union all
select 'ERROR','duplicate_idempotent_sale_lines',count(*) from (
  select venta_id,line_key from public.venta_items where line_key is not null
  group by 1,2 having count(*)>1
) x
union all
select 'ERROR','confirmed_operations_without_audit',count(*) from public.th_operaciones o
where o.estado='confirmada'
  and not exists(select 1 from public.audit_log a where a.operation_id=o.id)
  and not exists(select 1 from public.th_verif_movimientos m where m.operation_id=o.id)
union all
select 'ERROR','rejected_operations_with_movements',count(*) from public.th_operaciones o
where o.estado='rechazada' and exists(select 1 from public.movimientos_inventario m where m.operation_id=o.id)
union all
select 'ERROR','stale_processing_operations',count(*) from public.th_operaciones
where estado='procesando' and updated_at<now()-interval '5 minutes'
union all
select 'ERROR','ledger_stock_differences',count(*) from public.th_inventario_conciliacion where diferencia<>0
union all
select 'ERROR','invalid_inventory_count_ledger',count(*) from public.th_verif_movimientos
where delta<>1 or conteo_antes<0 or conteo_despues<>conteo_antes+delta
union all
select 'INFO','invoices_pending_review',count(*) from public.facturas_venta
where estado in ('procesando','revision','anulacion_procesando','revision_anulacion')
union all
select 'INFO','admin_operations_pending_review',count(*) from public.th_admin_operaciones
where estado in ('procesando','revision') and updated_at<now()-interval '2 minutes'
union all
select 'INFO','legacy_sales_without_lines',count(*) from public.ventas v
where not exists(select 1 from public.venta_items vi where vi.venta_id=v.id)
union all
select 'INFO','active_users_without_auth_id',count(*) from public.usuarios
where estado='activo' and auth_id is null
order by severity desc,check_name;

select ambiente,operacion,usuario,device_id,modo,enabled,updated_by,updated_at
from public.th_feature_flags
order by ambiente,operacion,usuario,device_id;

select conrelid::regclass as table_name,conname,convalidated
from pg_constraint
where conname in (
  'inventario_stock_no_negativo_chk','inventario_codigo_no_vacio_chk',
  'venta_items_cantidad_positiva_chk','retiros_cantidad_positiva_chk',
  'bajas_cantidad_positiva_chk','gift_cards_saldo_valido_chk',
  'descuentos_pct_valido_chk','descuentos_codigo_pct_valido_chk',
  'cambio_items_direccion_chk'
)
order by (conrelid::regclass)::text,conname;

rollback;
