-- Toscana House — importaciones, reversión segura y conciliación en sombra

begin;
set local statement_timeout = '180s';
set local lock_timeout = '10s';

create table if not exists public.inventario_saldos_apertura (
  producto_id bigint primary key references public.inventario(id),
  codigo text not null,
  stock_apertura integer not null,
  stock_inicial_apertura integer not null,
  tomado_at timestamptz not null default now(),
  tomado_por text,
  operation_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.th_shadow_observaciones (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid,
  tipo text not null,
  producto_id bigint references public.inventario(id),
  codigo text,
  stock_observado integer,
  stock_esperado integer,
  diferencia integer,
  payload jsonb not null default '{}'::jsonb,
  usuario text,
  device_id text,
  client_version text,
  created_at timestamptz not null default now()
);

create index if not exists th_shadow_diferencia_idx
  on public.th_shadow_observaciones(created_at desc)
  where diferencia <> 0;

create or replace function public.th_inicializar_saldos_apertura(
  p_operation_id uuid,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_prepared jsonb;
  v_count integer;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'SALDO_APERTURA','{}'::jsonb,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;
  begin
    lock table public.inventario in share row exclusive mode;
    insert into public.inventario_saldos_apertura(
      producto_id,codigo,stock_apertura,stock_inicial_apertura,tomado_por,operation_id,metadata
    )
    select id,codigo,stock,stock_inicial,v_actor->>'usuario',p_operation_id,
           jsonb_build_object('deviceId',v_actor->>'deviceId','clientVersion',v_actor->>'clientVersion')
    from public.inventario
    on conflict (producto_id) do nothing;
    get diagnostics v_count=row_count;
    perform public.th_append_audit(p_operation_id,'SALDO_APERTURA',v_actor,jsonb_build_object('productos',v_count));
    v_result:=jsonb_build_object('ok',true,'inserted',v_count,'operationId',p_operation_id,'serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo','SALDO_APERTURA'));
  end;
end;
$$;

create or replace function public.th_registrar_importacion(
  p_operation_id uuid,
  p_carga jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_prepared jsonb;
  v_carga_id text;
  v_items jsonb:=coalesce(p_carga->'items','[]'::jsonb);
  v_item jsonb;
  v_product jsonb;
  v_ord bigint;
  v_prod public.inventario%rowtype;
  v_qty integer;
  v_before integer;
  v_initial_before integer;
  v_created boolean;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'IMPORTACION',p_carga,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then
      raise exception using errcode='22023',message='La importación no contiene ítems';
    end if;
    v_carga_id:=coalesce(nullif(p_carga->>'id',''),'CRG_'||replace(p_operation_id::text,'-',''));
    insert into public.cargas_inventario(
      id,ts,fecha,hora,tipo,usuario,nombre,rol,marca_id,marca_nombre,resumen,
      total_items,nuevos,actualizados,detalle,archivo_nombre,archivo_url,operation_id,metadata
    ) values(
      v_carga_id,floor(extract(epoch from clock_timestamp())*1000)::bigint,
      coalesce(p_carga->>'fecha',to_char(current_date,'DD/MM/YYYY')),
      coalesce(p_carga->>'hora',to_char(clock_timestamp() at time zone 'America/La_Paz','HH24:MI:SS')),
      coalesce(p_carga->>'tipo','IMPORT'),v_actor->>'usuario',v_actor->>'nombre',v_actor->>'rol',
      nullif(p_carga->>'marcaId','')::integer,p_carga->>'marcaNombre',p_carga->>'resumen',
      jsonb_array_length(v_items),coalesce(nullif(p_carga->>'nuevos','')::integer,0),
      coalesce(nullif(p_carga->>'actualizados','')::integer,0),v_items,
      p_carga->>'archivoNombre',p_carga->>'archivoUrl',p_operation_id,p_carga-'items'
    );

    for v_item,v_ord in select value,ordinality from jsonb_array_elements(v_items) with ordinality loop
      v_product:=coalesce(v_item->'producto',v_item);
      v_qty:=coalesce(
        nullif(v_item->>'stockSumado','')::integer,
        nullif(v_item->>'stock','')::integer,
        nullif(v_product->>'stock','')::integer,
        0
      );
      if v_qty<0 then raise exception using errcode='22023',message='La importación contiene stock negativo'; end if;
      if nullif(btrim(coalesce(v_item->>'codigo',v_product->>'codigo')),'') is null then
        raise exception using errcode='22023',message='La importación contiene un código vacío';
      end if;

      select * into v_prod from public.inventario
      where upper(btrim(codigo))=upper(btrim(coalesce(v_item->>'codigo',v_product->>'codigo')))
      limit 1 for update;
      v_created:=not found;

      if v_created then
        insert into public.inventario(
          codigo,marca_id,marca_nombre,nombre,categoria,descripcion,subcat,precio,
          stock,stock_inicial,fecha,activo,metadata
        ) values(
          upper(btrim(coalesce(v_item->>'codigo',v_product->>'codigo'))),
          coalesce(nullif(v_product->>'marcaId','')::integer,nullif(v_item->>'marcaId','')::integer),
          coalesce(v_product->>'marcaNombre',v_item->>'marca'),
          coalesce(nullif(v_product->>'nombre',''),coalesce(v_item->>'codigo',v_product->>'codigo')),
          coalesce(nullif(v_product->>'categoria',''),'GENERAL'),
          coalesce(v_product->>'descripcion',''),coalesce(v_product->>'subcat',''),
          coalesce(nullif(v_product->>'precio','')::numeric,0),v_qty,v_qty,
          coalesce(v_product->>'fecha',to_char(current_date,'YYYY-MM-DD')),true,
          jsonb_build_object('createdByImport',v_carga_id)
        ) returning * into v_prod;
        v_before:=0;
        v_initial_before:=0;
      else
        v_before:=v_prod.stock;
        v_initial_before:=v_prod.stock_inicial;
        update public.inventario set
          stock=stock+v_qty,
          stock_inicial=stock_inicial+v_qty,
          nombre=coalesce(nullif(v_product->>'nombre',''),nombre),
          descripcion=coalesce(nullif(v_product->>'descripcion',''),descripcion),
          subcat=coalesce(nullif(v_product->>'subcat',''),subcat),
          categoria=coalesce(nullif(v_product->>'categoria',''),categoria),
          precio=coalesce(nullif(v_product->>'precio','')::numeric,precio),
          activo=true,row_version=row_version+1,updated_at=now()
        where id=v_prod.id
        returning * into v_prod;
      end if;

      if v_qty>0 then
        insert into public.movimientos_inventario(
          operation_id,line_key,producto_id,codigo,tipo,cantidad_delta,stock_antes,stock_despues,
          stock_inicial_antes,stock_inicial_despues,carga_id,motivo,usuario,auth_id,rol,
          device_id,client_version,metadata
        ) values(
          p_operation_id,'IMPORTACION:'||v_ord::text,v_prod.id,v_prod.codigo,'IMPORTACION',v_qty,
          v_before,v_before+v_qty,v_initial_before,v_initial_before+v_qty,v_carga_id,
          'Importación de inventario',v_actor->>'usuario',nullif(v_actor->>'authId','')::uuid,
          v_actor->>'rol',v_actor->>'deviceId',v_actor->>'clientVersion',
          v_item||jsonb_build_object('created',v_created,'ordinal',v_ord)
        );
      end if;
    end loop;

    perform public.th_append_audit(p_operation_id,'IMPORT',v_actor,p_carga||jsonb_build_object('cargaId',v_carga_id,'engine','transactional'));
    v_result:=jsonb_build_object('ok',true,'operationId',p_operation_id,'cargaId',v_carga_id,'items',jsonb_array_length(v_items),'engine','transactional','serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo','IMPORTACION'));
  end;
end;
$$;

create or replace function public.th_revertir_carga(
  p_operation_id uuid,
  p_carga_id text,
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
  v_payload jsonb:=jsonb_build_object('cargaId',p_carga_id,'motivo',coalesce(p_motivo,''));
  v_prepared jsonb;
  v_carga public.cargas_inventario%rowtype;
  v_mov public.movimientos_inventario%rowtype;
  v_prod public.inventario%rowtype;
  v_reverse integer;
  v_initial_delta integer;
  v_count integer:=0;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'REVERSO_CARGA',v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    select * into v_carga from public.cargas_inventario where id=p_carga_id for update;
    if not found then raise exception using errcode='P0002',message='Carga no encontrada'; end if;
    if v_carga.revertida then raise exception using errcode='P0001',message='La carga ya fue revertida'; end if;
    if not exists(select 1 from public.movimientos_inventario where carga_id=p_carga_id and tipo='IMPORTACION') then
      raise exception using errcode='P0001',message='La carga legacy no tiene movimientos reversibles; debe conciliarse manualmente';
    end if;

    for v_mov in
      select * from public.movimientos_inventario
      where carga_id=p_carga_id and tipo='IMPORTACION'
      order by created_at desc,id
    loop
      select * into v_prod from public.inventario where id=v_mov.producto_id for update;
      if not found then raise exception using errcode='P0002',message=format('Producto %s no encontrado',v_mov.codigo); end if;
      v_reverse:=-v_mov.cantidad_delta;
      v_initial_delta:=coalesce(v_mov.stock_inicial_despues,0)-coalesce(v_mov.stock_inicial_antes,0);
      if v_prod.stock+v_reverse<0 then
        raise exception using errcode='P0001',message=format('No se puede revertir %s: parte del stock de la carga ya salió',v_prod.codigo);
      end if;
      if v_prod.stock_inicial-v_initial_delta<0 then
        raise exception using errcode='P0001',message=format('Stock inicial incompatible para %s',v_prod.codigo);
      end if;

      update public.inventario set
        stock=stock+v_reverse,
        stock_inicial=stock_inicial-v_initial_delta,
        activo=case when coalesce((v_mov.metadata->>'created')::boolean,false) and stock+v_reverse=0 then false else activo end,
        row_version=row_version+1,updated_at=now()
      where id=v_prod.id;

      insert into public.movimientos_inventario(
        operation_id,line_key,producto_id,codigo,tipo,cantidad_delta,stock_antes,stock_despues,
        stock_inicial_antes,stock_inicial_despues,carga_id,movimiento_revertido_id,motivo,
        usuario,auth_id,rol,device_id,client_version,metadata
      ) values(
        p_operation_id,'REVERSO:'||v_mov.id::text,v_prod.id,v_prod.codigo,'REVERSO_CARGA',v_reverse,
        v_prod.stock,v_prod.stock+v_reverse,v_prod.stock_inicial,v_prod.stock_inicial-v_initial_delta,
        p_carga_id,v_mov.id,coalesce(nullif(p_motivo,''),'Reversión de carga'),v_actor->>'usuario',
        nullif(v_actor->>'authId','')::uuid,v_actor->>'rol',v_actor->>'deviceId',v_actor->>'clientVersion',
        jsonb_build_object('originalMovementId',v_mov.id,'originalOperationId',v_mov.operation_id)
      );
      v_count:=v_count+1;
    end loop;

    update public.cargas_inventario set revertida=true,revertida_at=now(),revertida_por=v_actor->>'usuario' where id=p_carga_id;
    perform public.th_append_audit(p_operation_id,'REVERSO_CARGA',v_actor,jsonb_build_object('cargaId',p_carga_id,'movimientos',v_count,'motivo',p_motivo,'engine','transactional'));
    v_result:=jsonb_build_object('ok',true,'operationId',p_operation_id,'cargaId',p_carga_id,'movimientosRevertidos',v_count,'engine','transactional','serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('cargaId',p_carga_id));
  end;
end;
$$;

create or replace view public.th_inventario_conciliacion as
select
  i.id as producto_id,
  i.codigo,
  i.nombre,
  i.marca_id,
  a.stock_apertura,
  coalesce(sum(m.cantidad_delta),0)::bigint as delta_movimientos,
  (a.stock_apertura+coalesce(sum(m.cantidad_delta),0))::bigint as stock_esperado,
  i.stock::bigint as stock_actual,
  (i.stock-(a.stock_apertura+coalesce(sum(m.cantidad_delta),0)))::bigint as diferencia,
  max(m.created_at) as ultimo_movimiento
from public.inventario i
join public.inventario_saldos_apertura a on a.producto_id=i.id
left join public.movimientos_inventario m on m.producto_id=i.id
  and m.created_at>=a.tomado_at
group by i.id,i.codigo,i.nombre,i.marca_id,i.stock,a.stock_apertura;

create or replace function public.th_registrar_shadow(
  p_operation_id uuid,
  p_tipo text,
  p_payload jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_count integer:=0;
begin
  insert into public.th_shadow_observaciones(
    operation_id,tipo,producto_id,codigo,stock_observado,stock_esperado,diferencia,
    payload,usuario,device_id,client_version
  )
  select p_operation_id,p_tipo,c.producto_id,c.codigo,c.stock_actual,c.stock_esperado,c.diferencia,
         coalesce(p_payload,'{}'::jsonb),v_actor->>'usuario',v_actor->>'deviceId',v_actor->>'clientVersion'
  from public.th_inventario_conciliacion c
  where c.diferencia<>0;
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'operationId',p_operation_id,'differences',v_count,'serverTime',clock_timestamp());
end;
$$;

revoke all on function public.th_inicializar_saldos_apertura(uuid,jsonb) from public,anon;
revoke all on function public.th_registrar_importacion(uuid,jsonb,jsonb) from public,anon;
revoke all on function public.th_revertir_carga(uuid,text,text,jsonb) from public,anon;
revoke all on function public.th_registrar_shadow(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.th_inicializar_saldos_apertura(uuid,jsonb) to authenticated,service_role;
grant execute on function public.th_registrar_importacion(uuid,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.th_revertir_carga(uuid,text,text,jsonb) to authenticated,service_role;
grant execute on function public.th_registrar_shadow(uuid,text,jsonb,jsonb) to authenticated,service_role;

commit;
