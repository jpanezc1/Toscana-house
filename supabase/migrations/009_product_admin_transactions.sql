-- Toscana House — edición administrativa y retiro lógico de productos.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function public.th_editar_producto(
  p_operation_id uuid,
  p_data jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_prepared jsonb;
  v_prod public.inventario%rowtype;
  v_target integer;
  v_initial_target integer;
  v_price numeric;
  v_delta integer:=0;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'EDICION_PRODUCTO',p_data,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;
  begin
    select * into v_prod from public.inventario i
    where i.id=case when coalesce(p_data->>'prodId','')~'^[0-9]+$' then (p_data->>'prodId')::bigint end
       or upper(btrim(i.codigo))=upper(btrim(p_data->>'codigo'))
    order by (i.id=case when coalesce(p_data->>'prodId','')~'^[0-9]+$' then (p_data->>'prodId')::bigint end) desc nulls last
    limit 1 for update;
    if not found then raise exception using errcode='P0002',message='Producto no encontrado'; end if;

    v_target:=coalesce(nullif(p_data->>'stockObjetivo','')::integer,v_prod.stock);
    v_initial_target:=coalesce(nullif(p_data->>'stockInicialObjetivo','')::integer,v_prod.stock_inicial);
    v_price:=coalesce(nullif(p_data->>'precio','')::numeric,v_prod.precio);
    if v_target<0 or v_initial_target<0 then raise exception using errcode='22023',message='El stock no puede ser negativo'; end if;
    if v_price<=0 then raise exception using errcode='22023',message='El precio debe ser mayor a cero'; end if;
    if v_target>v_prod.stock then raise exception using errcode='P0001',message='Para aumentar stock use recepción o reposición'; end if;
    if v_target<>v_prod.stock and nullif(btrim(coalesce(p_data->>'motivo','')),'') is null then
      raise exception using errcode='22023',message='El motivo es obligatorio para corregir stock';
    end if;

    v_delta:=v_target-v_prod.stock;
    update public.inventario set
      nombre=coalesce(nullif(btrim(p_data->>'nombre'),''),nombre),
      precio=v_price,
      descripcion=coalesce(p_data->>'descripcion',descripcion),
      subcat=coalesce(p_data->>'subcat',subcat),
      categoria=coalesce(nullif(btrim(p_data->>'categoria'),''),categoria),
      stock=v_target,stock_inicial=v_initial_target,activo=true,
      row_version=row_version+1,updated_at=now()
    where id=v_prod.id;

    if v_delta<>0 then
      insert into public.movimientos_inventario(
        operation_id,line_key,producto_id,codigo,tipo,cantidad_delta,stock_antes,stock_despues,
        stock_inicial_antes,stock_inicial_despues,motivo,usuario,auth_id,rol,device_id,client_version,metadata
      ) values(
        p_operation_id,'CORRECCION_ADMIN:'||v_prod.id::text,v_prod.id,v_prod.codigo,'CORRECCION_ADMIN',
        v_delta,v_prod.stock,v_target,v_prod.stock_inicial,v_initial_target,p_data->>'motivo',
        v_actor->>'usuario',nullif(v_actor->>'authId','')::uuid,v_actor->>'rol',
        v_actor->>'deviceId',v_actor->>'clientVersion',p_data
      );
    end if;

    perform public.th_append_audit(p_operation_id,'EDICION_PRODUCTO',v_actor,jsonb_build_object(
      'codigo',v_prod.codigo,'nombreAntes',v_prod.nombre,'nombreDespues',coalesce(nullif(p_data->>'nombre',''),v_prod.nombre),
      'precioAntes',v_prod.precio,'precioDespues',v_price,'stockAntes',v_prod.stock,'stockDespues',v_target,
      'stockInicialAntes',v_prod.stock_inicial,'stockInicialDespues',v_initial_target,'motivo',p_data->>'motivo',
      'engine','transactional'
    ));
    v_result:=jsonb_build_object('ok',true,'operationId',p_operation_id,'productoId',v_prod.id,
      'codigo',v_prod.codigo,'stock',v_target,'stockInicial',v_initial_target,'precio',v_price,
      'nombre',coalesce(nullif(p_data->>'nombre',''),v_prod.nombre),'descripcion',coalesce(p_data->>'descripcion',v_prod.descripcion),
      'engine','transactional','serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo','EDICION_PRODUCTO'));
  end;
end;
$$;

create or replace function public.th_desactivar_producto(
  p_operation_id uuid,
  p_producto_id bigint,
  p_motivo text default '',
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_payload jsonb:=jsonb_build_object('productoId',p_producto_id,'motivo',coalesce(p_motivo,''));
  v_prepared jsonb;
  v_prod public.inventario%rowtype;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'DESACTIVAR_PRODUCTO',v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;
  begin
    select * into v_prod from public.inventario where id=p_producto_id for update;
    if not found then raise exception using errcode='P0002',message='Producto no encontrado'; end if;
    if not v_prod.activo then raise exception using errcode='P0001',message='El producto ya estaba inactivo'; end if;
    if v_prod.stock<>0 then
      raise exception using errcode='P0001',message=format('No se puede retirar %s: todavía tiene %s unidad(es). Registre baja o reversión primero',v_prod.codigo,v_prod.stock);
    end if;
    update public.inventario set activo=false,row_version=row_version+1,updated_at=now(),
      metadata=metadata||jsonb_build_object('deactivatedAt',clock_timestamp(),'deactivatedBy',v_actor->>'usuario','reason',coalesce(p_motivo,''))
    where id=v_prod.id;
    perform public.th_append_audit(p_operation_id,'DESACTIVAR_PRODUCTO',v_actor,jsonb_build_object(
      'productoId',v_prod.id,'codigo',v_prod.codigo,'nombre',v_prod.nombre,'motivo',p_motivo,'engine','transactional'));
    v_result:=jsonb_build_object('ok',true,'operationId',p_operation_id,'productoId',v_prod.id,'codigo',v_prod.codigo,
      'activo',false,'engine','transactional','serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo','DESACTIVAR_PRODUCTO'));
  end;
end;
$$;

revoke all on function public.th_editar_producto(uuid,jsonb,jsonb) from public,anon;
revoke all on function public.th_desactivar_producto(uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.th_editar_producto(uuid,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.th_desactivar_producto(uuid,bigint,text,jsonb) to authenticated,service_role;

commit;
