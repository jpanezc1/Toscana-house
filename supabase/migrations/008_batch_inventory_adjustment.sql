-- Toscana House — cuadre de auditoría por lote, todo o nada.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function public.th_ajustar_inventario_batch(
  p_operation_id uuid,
  p_ajuste jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_items jsonb:=coalesce(p_ajuste->'items','[]'::jsonb);
  v_prepared jsonb;
  v_item jsonb;
  v_ord bigint;
  v_prod public.inventario%rowtype;
  v_target integer;
  v_delta integer;
  v_changed integer:=0;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'AJUSTE_AUDITORIA_BATCH',p_ajuste,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then
      raise exception using errcode='22023',message='El cuadre no contiene productos';
    end if;

    -- Orden estable de bloqueos para evitar deadlocks entre dos auditorías simultáneas.
    perform i.id
    from public.inventario i
    join (
      select distinct case when coalesce(value->>'prodId','')~'^[0-9]+$' then (value->>'prodId')::bigint end as id
      from jsonb_array_elements(v_items)
      where coalesce(value->>'prodId','')~'^[0-9]+$'
    ) requested on requested.id=i.id
    order by i.id
    for update;

    for v_item,v_ord in
      select value,ordinality from jsonb_array_elements(v_items) with ordinality
    loop
      v_target:=nullif(v_item->>'stockObjetivo','')::integer;
      if v_target is null or v_target<0 then
        raise exception using errcode='22023',message=format('Stock objetivo inválido en línea %s',v_ord);
      end if;

      select * into v_prod from public.inventario i
      where i.id=case when coalesce(v_item->>'prodId','')~'^[0-9]+$' then (v_item->>'prodId')::bigint end
         or upper(btrim(i.codigo))=upper(btrim(v_item->>'codigo'))
      order by (i.id=case when coalesce(v_item->>'prodId','')~'^[0-9]+$' then (v_item->>'prodId')::bigint end) desc nulls last
      limit 1 for update;
      if not found then
        raise exception using errcode='P0002',message=format('Producto %s no encontrado',coalesce(v_item->>'codigo',v_item->>'prodId'));
      end if;

      v_delta:=v_target-v_prod.stock;
      if v_delta=0 then continue; end if;
      update public.inventario set stock=v_target,row_version=row_version+1,updated_at=now(),activo=true
      where id=v_prod.id;

      insert into public.movimientos_inventario(
        operation_id,line_key,producto_id,codigo,tipo,cantidad_delta,stock_antes,stock_despues,
        stock_inicial_antes,stock_inicial_despues,auditoria_id,motivo,usuario,auth_id,rol,
        device_id,client_version,metadata
      ) values(
        p_operation_id,'AJUSTE_AUDITORIA:'||v_ord::text,v_prod.id,v_prod.codigo,'AJUSTE_AUDITORIA',
        v_delta,v_prod.stock,v_target,v_prod.stock_inicial,v_prod.stock_inicial,
        nullif(p_ajuste->>'auditoriaId',''),coalesce(nullif(p_ajuste->>'motivo',''),'Cuadre de auditoría'),
        v_actor->>'usuario',nullif(v_actor->>'authId','')::uuid,v_actor->>'rol',
        v_actor->>'deviceId',v_actor->>'clientVersion',v_item
      );
      v_changed:=v_changed+1;
    end loop;

    if v_changed=0 then
      raise exception using errcode='P0001',message='El inventario ya coincide con el conteo';
    end if;
    perform public.th_append_audit(p_operation_id,'CUADRE_AUDITORIA',v_actor,
      p_ajuste||jsonb_build_object('productosAjustados',v_changed,'engine','transactional'));
    v_result:=jsonb_build_object('ok',true,'operationId',p_operation_id,'productosAjustados',v_changed,
      'engine','transactional','serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo','AJUSTE_AUDITORIA_BATCH'));
  end;
end;
$$;

revoke all on function public.th_ajustar_inventario_batch(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.th_ajustar_inventario_batch(uuid,jsonb,jsonb) to authenticated,service_role;

commit;
