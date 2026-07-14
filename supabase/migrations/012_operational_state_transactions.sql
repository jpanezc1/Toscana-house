-- Toscana House — estados operativos y configuraciones con autorización y auditoría.
-- Instalación aditiva; producción conserva legacy hasta activar cada flag.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function public.th_guardar_estado_operativo(
  p_operation_id uuid,
  p_tipo text,
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
  v_tipo text:=upper(btrim(coalesce(p_tipo,'')));
  v_payload jsonb:=jsonb_build_object('tipo',v_tipo,'data',coalesce(p_data,'{}'::jsonb));
  v_prepared jsonb;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
  v_marca_id integer;
  v_pct numeric;
  v_codigo text;
  v_item jsonb;
  v_updated integer:=0;
begin
  if v_tipo not in (
    'CIERRE_MENSUAL','VERIFICAR_CARGA','AUDITORIA_INVENTARIO','CONFIG_MARCAS',
    'DESCUENTO_MARCA','DESCUENTO_CODIGO','ELIMINAR_DESCUENTO_CODIGO'
  ) then
    raise exception using errcode='22023',message='Tipo de estado operativo no soportado';
  end if;

  if v_tipo in ('DESCUENTO_MARCA','DESCUENTO_CODIGO','ELIMINAR_DESCUENTO_CODIGO') then
    perform public.th_require_roles(v_actor,array['admin','marca']);
  else
    perform public.th_require_roles(v_actor,array['admin']);
  end if;

  v_prepared:=public.th_prepare_operation(p_operation_id,'ESTADO_'||v_tipo,v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    if v_tipo='CIERRE_MENSUAL' then
      v_marca_id:=nullif(p_data->>'marcaId','')::integer;
      if nullif(p_data->>'id','') is null or nullif(p_data->>'mk','') is null or v_marca_id is null then
        raise exception using errcode='22023',message='Cierre mensual incompleto';
      end if;
      insert into public.cierres(id,marca_id,mk,cerrado,fecha,usuario,device_id,operation_id,metadata,updated_at)
      values(
        p_data->>'id',v_marca_id,p_data->>'mk',coalesce((p_data->>'cerrado')::boolean,false),
        nullif(p_data->>'fecha',''),v_actor->>'usuario',v_actor->>'deviceId',p_operation_id,
        p_data-'id'-'marcaId'-'mk'-'cerrado'-'fecha',now()
      ) on conflict(id) do update set
        marca_id=excluded.marca_id,mk=excluded.mk,cerrado=excluded.cerrado,fecha=excluded.fecha,
        usuario=excluded.usuario,device_id=excluded.device_id,operation_id=excluded.operation_id,
        metadata=excluded.metadata,updated_at=now();
      v_updated:=1;

    elsif v_tipo='VERIFICAR_CARGA' then
      update public.cargas_inventario set
        verificado=coalesce((p_data->>'verificado')::boolean,false),
        verificado_ts=case when coalesce((p_data->>'verificado')::boolean,false) then now() else null end,
        verificado_por=case when coalesce((p_data->>'verificado')::boolean,false) then v_actor->>'nombre' else null end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verificationOperationId',p_operation_id)
      where id=p_data->>'cargaId';
      get diagnostics v_updated=row_count;
      if v_updated<>1 then raise exception using errcode='P0002',message='Carga no encontrada'; end if;

    elsif v_tipo='AUDITORIA_INVENTARIO' then
      if nullif(p_data->>'id','') is null then raise exception using errcode='22023',message='ID de auditoría obligatorio'; end if;
      insert into public.auditorias_inventario(
        id,mk,mes,anio,fecha,hora,usuario,marca_id,total_productos,ok,faltantes,sobrantes,
        valor_fuga,valor_sobrante,detalle,marcado_ok_por,marcado_ok_ts,operation_id,metadata
      ) values(
        p_data->>'id',p_data->>'mk',nullif(p_data->>'mes','')::integer,nullif(p_data->>'anio','')::integer,
        p_data->>'fecha',p_data->>'hora',v_actor->>'usuario',nullif(p_data->>'marcaId','')::integer,
        coalesce(nullif(p_data->>'totalProductos','')::integer,0),coalesce(nullif(p_data->>'ok','')::integer,0),
        coalesce(nullif(p_data->>'faltantes','')::integer,0),coalesce(nullif(p_data->>'sobrantes','')::integer,0),
        coalesce(nullif(p_data->>'valorFuga','')::numeric,0),coalesce(nullif(p_data->>'valorSobrante','')::numeric,0),
        coalesce(p_data->'detalle','[]'::jsonb),nullif(p_data->>'marcadoOkPor',''),
        nullif(p_data->>'marcadoOkTs','')::timestamptz,p_operation_id,
        jsonb_build_object('deviceId',v_actor->>'deviceId','clientVersion',v_actor->>'clientVersion')
      ) on conflict(id) do update set
        mk=excluded.mk,mes=excluded.mes,anio=excluded.anio,fecha=excluded.fecha,hora=excluded.hora,
        usuario=excluded.usuario,marca_id=excluded.marca_id,total_productos=excluded.total_productos,
        ok=excluded.ok,faltantes=excluded.faltantes,sobrantes=excluded.sobrantes,
        valor_fuga=excluded.valor_fuga,valor_sobrante=excluded.valor_sobrante,detalle=excluded.detalle,
        marcado_ok_por=excluded.marcado_ok_por,marcado_ok_ts=excluded.marcado_ok_ts,
        operation_id=excluded.operation_id,metadata=excluded.metadata;
      v_updated:=1;

    elsif v_tipo='CONFIG_MARCAS' then
      if coalesce(jsonb_typeof(p_data->'items'),'null')<>'array' or coalesce(jsonb_array_length(p_data->'items'),0)=0 then
        raise exception using errcode='22023',message='No hay marcas para guardar';
      end if;
      if jsonb_array_length(p_data->'items')>500 then
        raise exception using errcode='22023',message='Demasiadas marcas en una operación';
      end if;
      for v_item in select value from jsonb_array_elements(p_data->'items') loop
        v_marca_id:=nullif(v_item->>'id','')::integer;
        if v_marca_id is null or nullif(btrim(v_item->>'nombre'),'') is null then
          raise exception using errcode='22023',message='Marca inválida';
        end if;
        insert into public.marcas(id,data,updated_at) values(v_marca_id,v_item,now())
        on conflict(id) do update set data=excluded.data,updated_at=now();
        v_updated:=v_updated+1;
      end loop;

    elsif v_tipo='DESCUENTO_MARCA' then
      v_marca_id:=nullif(p_data->>'marcaId','')::integer;
      v_pct:=coalesce(nullif(p_data->>'pct','')::numeric,0);
      if v_marca_id is null or v_pct<0 or v_pct>50 then
        raise exception using errcode='22023',message='Descuento de marca inválido';
      end if;
      if v_actor->>'rol'='marca' and nullif(v_actor->>'marcaId','')::integer is distinct from v_marca_id then
        raise exception using errcode='42501',message='La marca sólo puede configurar su propio descuento';
      end if;
      insert into public.config_descuentos(marca_id,marca_nombre,activo,pct,hasta,updated_by,updated_at)
      values(
        v_marca_id,left(coalesce(p_data->>'marcaNombre',''),200),coalesce((p_data->>'activo')::boolean,false),
        v_pct,nullif(p_data->>'hasta','')::date,v_actor->>'usuario',now()
      ) on conflict(marca_id) do update set
        marca_nombre=excluded.marca_nombre,activo=excluded.activo,pct=excluded.pct,hasta=excluded.hasta,
        updated_by=excluded.updated_by,updated_at=now();
      v_updated:=1;

    elsif v_tipo in ('DESCUENTO_CODIGO','ELIMINAR_DESCUENTO_CODIGO') then
      v_codigo:=upper(btrim(coalesce(p_data->>'codigo','')));
      if v_codigo='' then raise exception using errcode='22023',message='Código de producto obligatorio'; end if;
      select marca_id into v_marca_id from public.inventario
      where upper(btrim(codigo))=v_codigo and activo limit 1;
      if not found then raise exception using errcode='P0002',message='Producto no encontrado o inactivo'; end if;
      if v_actor->>'rol'='marca' and nullif(v_actor->>'marcaId','')::integer is distinct from v_marca_id then
        raise exception using errcode='42501',message='La marca sólo puede configurar sus propios productos';
      end if;
      if v_tipo='ELIMINAR_DESCUENTO_CODIGO' then
        delete from public.descuentos_codigo where codigo=v_codigo;
        get diagnostics v_updated=row_count;
      else
        v_pct:=coalesce(nullif(p_data->>'pct','')::numeric,0);
        if v_pct<=0 or v_pct>50 then raise exception using errcode='22023',message='Descuento por código inválido'; end if;
        insert into public.descuentos_codigo(
          codigo,marca_id,marca_nombre,nombre,activo,pct,hasta,updated_by,updated_at
        ) values(
          v_codigo,v_marca_id,left(coalesce(p_data->>'marcaNombre',''),200),left(coalesce(p_data->>'nombre',''),300),
          true,v_pct,nullif(p_data->>'hasta','')::date,v_actor->>'usuario',now()
        ) on conflict(codigo) do update set
          marca_id=excluded.marca_id,marca_nombre=excluded.marca_nombre,nombre=excluded.nombre,
          activo=true,pct=excluded.pct,hasta=excluded.hasta,updated_by=excluded.updated_by,updated_at=now();
        v_updated:=1;
      end if;
    end if;

    perform public.th_append_audit(
      p_operation_id,v_tipo,v_actor,
      jsonb_build_object(
        'resumen',format('%s confirmado por %s',replace(v_tipo,'_',' '),v_actor->>'nombre'),
        'tipo',v_tipo,'entidadId',coalesce(p_data->>'id',p_data->>'cargaId',p_data->>'codigo',p_data->>'marcaId'),
        'registros',v_updated,'engine','transactional',
        'cerrado',case when v_tipo='CIERRE_MENSUAL' then p_data->'cerrado' else null end,
        'snapshotHash',case when v_tipo='CIERRE_MENSUAL'
          then public.th_payload_hash(coalesce(p_data->'snapshot','{}'::jsonb)) else null end
      )
    );
    v_result:=jsonb_build_object(
      'ok',true,'operationId',p_operation_id,'tipo',v_tipo,'registros',v_updated,
      'engine','transactional','serverTime',clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo',v_tipo));
  end;
end;
$$;

revoke all on function public.th_guardar_estado_operativo(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.th_guardar_estado_operativo(uuid,text,jsonb,jsonb) to authenticated,service_role;

commit;
