-- Toscana House — importación financiera sin SKU, atómica y auditable.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

alter table public.ventas add column if not exists parent_operation_id uuid;
create index if not exists ventas_parent_operation_idx on public.ventas(parent_operation_id) where parent_operation_id is not null;

create or replace function public.th_importar_ventas_libres(
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
  v_sales jsonb:=coalesce(p_data->'ventas','[]'::jsonb);
  v_prepared jsonb;
  v_sale jsonb;
  v_item jsonb;
  v_sale_ord bigint;
  v_item_ord bigint;
  v_sale_id text;
  v_total numeric;
  v_count integer:=0;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'IMPORT_VENTAS_LIBRES',p_data,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;
  begin
    if jsonb_typeof(v_sales)<>'array' or jsonb_array_length(v_sales)=0 then
      raise exception using errcode='22023',message='La importación no contiene ventas';
    end if;
    for v_sale,v_sale_ord in select value,ordinality from jsonb_array_elements(v_sales) with ordinality loop
      v_sale_id:=coalesce(nullif(v_sale->>'id',''),'VL'||replace(p_operation_id::text,'-','')||'_'||v_sale_ord::text);
      v_total:=coalesce(nullif(v_sale->>'total','')::numeric,0);
      if v_total<=0 then raise exception using errcode='22023',message=format('Total inválido en venta %s',v_sale_ord); end if;
      if jsonb_typeof(coalesce(v_sale->'items','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(v_sale->'items','[]'::jsonb))=0 then
        raise exception using errcode='22023',message=format('Venta %s sin líneas',v_sale_ord);
      end if;

      insert into public.ventas(
        id,fecha,hora,mk,mes,anio,total,subtotal,desc_pct,metodo_pago,vendedor,
        origen,canal,parent_operation_id,engine,device_id,client_version,metadata,server_created_at
      ) values(
        v_sale_id,v_sale->>'fecha',v_sale->>'hora',v_sale->>'mk',nullif(v_sale->>'mes','')::integer,
        nullif(v_sale->>'anio','')::integer,v_total,coalesce(nullif(v_sale->>'subtotal','')::numeric,v_total),
        coalesce(nullif(v_sale->>'descPct','')::numeric,0),v_sale->>'metodoPago',
        coalesce(nullif(v_sale->>'vendedor',''),v_actor->>'nombre'),'IMPORT_LIBRE','HISTORICO',
        p_operation_id,'transactional',v_actor->>'deviceId',v_actor->>'clientVersion',
        v_sale-'items',clock_timestamp()
      );
      for v_item,v_item_ord in
        select value,ordinality from jsonb_array_elements(v_sale->'items') with ordinality
      loop
        if coalesce(nullif(v_item->>'cantidad','')::integer,0)<=0 then
          raise exception using errcode='22023',message='Cantidad inválida en importación sin SKU';
        end if;
        insert into public.venta_items(
          venta_id,prod_id,codigo,nombre,marca_id,marca_nombre,cantidad,precio_unit,subtotal,desc_pct,line_key,metadata
        ) values(
          v_sale_id,null,coalesce(nullif(v_item->>'codigo',''),'LIBRE'),v_item->>'nombre',
          nullif(v_item->>'marcaId','')::integer,v_item->>'marcaNombre',
          (v_item->>'cantidad')::integer,coalesce(nullif(v_item->>'precioUnit','')::numeric,0),
          coalesce(nullif(v_item->>'subtotal','')::numeric,0),coalesce(nullif(v_item->>'descPct','')::numeric,0),
          p_operation_id::text||':'||v_sale_ord::text||':'||v_item_ord::text,v_item
        );
      end loop;
      v_count:=v_count+1;
    end loop;

    perform public.th_append_audit(p_operation_id,'IMPORT_VENTAS_LIBRES',v_actor,
      jsonb_build_object('ventas',v_count,'filas',coalesce(nullif(p_data->>'filas','')::integer,0),'engine','transactional'));
    v_result:=jsonb_build_object('ok',true,'operationId',p_operation_id,'ventas',v_count,
      'engine','transactional','serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo','IMPORT_VENTAS_LIBRES'));
  end;
end;
$$;

revoke all on function public.th_importar_ventas_libres(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.th_importar_ventas_libres(uuid,jsonb,jsonb) to authenticated,service_role;

commit;
