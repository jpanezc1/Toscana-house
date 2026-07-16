-- Toscana House — salud integral posterior al blindaje completo.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function public.th_system_health(
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_result jsonb;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  select jsonb_build_object(
    'ok',negative_stock=0 and empty_codes=0 and duplicate_codes=0 and orphan_sale_lines=0
      and duplicate_sale_lines=0 and partial_rejected_operations=0 and stale_operations=0
      and ledger_differences=0 and invalid_count_ledger=0 and invoices_review=0
      and admin_operations_review=0 and active_users_without_auth=0,
    'checkedAt',clock_timestamp(),
    'negativeStock',negative_stock,'emptyCodes',empty_codes,'duplicateCodes',duplicate_codes,
    'orphanSaleLines',orphan_sale_lines,'duplicateSaleLines',duplicate_sale_lines,
    'salesWithoutLines',sales_without_lines,'confirmedWithoutEvidence',confirmed_without_evidence,
    'partialRejectedOperations',partial_rejected_operations,'staleOperations',stale_operations,
    'ledgerDifferences',ledger_differences,'invalidCountLedger',invalid_count_ledger,
    'shadowDifferences',shadow_differences,'invoicesReview',invoices_review,
    'adminOperationsReview',admin_operations_review,'activeUsersWithoutAuth',active_users_without_auth,
    'productionMode',public.th_resolver_feature_flag('production','*','*','*')
  ) into v_result
  from (
    select
      (select count(*) from public.inventario where stock<0 or stock_inicial<0) negative_stock,
      (select count(*) from public.inventario where nullif(btrim(codigo),'') is null) empty_codes,
      (select count(*) from (select upper(btrim(codigo)) from public.inventario group by 1 having count(*)>1) d) duplicate_codes,
      (select count(*) from public.venta_items vi left join public.ventas v on v.id=vi.venta_id where v.id is null) orphan_sale_lines,
      (select count(*) from (select venta_id,line_key from public.venta_items where line_key is not null group by 1,2 having count(*)>1) d) duplicate_sale_lines,
      (select count(*) from public.ventas v where not exists(select 1 from public.venta_items vi where vi.venta_id=v.id)) sales_without_lines,
      (select count(*) from public.th_operaciones o where o.estado='confirmada'
        and not exists(select 1 from public.audit_log a where a.operation_id=o.id)
        and not exists(select 1 from public.th_verif_movimientos m where m.operation_id=o.id)) confirmed_without_evidence,
      (select count(*) from public.th_operaciones o where o.estado='rechazada' and (
        exists(select 1 from public.movimientos_inventario m where m.operation_id=o.id)
        or exists(select 1 from public.th_verif_movimientos vm where vm.operation_id=o.id)
        or exists(select 1 from public.ventas v where v.operation_id=o.id)
      )) partial_rejected_operations,
      (select count(*) from public.th_operaciones where estado='procesando' and updated_at<now()-interval '5 minutes') stale_operations,
      (select count(*) from public.th_inventario_conciliacion where diferencia<>0) ledger_differences,
      (select count(*) from public.th_verif_movimientos where delta<>1 or conteo_antes<0 or conteo_despues<>conteo_antes+delta) invalid_count_ledger,
      (select count(*) from public.th_shadow_observaciones where diferencia<>0 and created_at>now()-interval '24 hours') shadow_differences,
      (select count(*) from public.facturas_venta where estado in ('procesando','revision','anulacion_procesando','revision_anulacion')) invoices_review,
      (select count(*) from public.th_admin_operaciones where estado in ('procesando','revision') and updated_at<now()-interval '2 minutes') admin_operations_review,
      (select count(*) from public.usuarios where estado='activo' and auth_id is null) active_users_without_auth
  ) x;
  return v_result;
end;
$$;

revoke all on function public.th_system_health(jsonb) from public,anon;
grant execute on function public.th_system_health(jsonb) to authenticated,service_role;

commit;
