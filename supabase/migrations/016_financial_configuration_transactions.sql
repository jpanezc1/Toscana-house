-- Toscana House — configuración financiera compartida, validada y auditable.
-- Las fórmulas visibles no cambian; se elimina la dependencia exclusiva del navegador.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create table if not exists public.liquidacion_config (
  marca_id integer primary key,
  pct_tarjeta numeric not null default 1.8 check(pct_tarjeta between 0 and 100),
  pct_comision numeric not null default 0 check(pct_comision between 0 and 100),
  alquiler numeric not null default 0 check(alquiler between 0 and 1000000000),
  operation_id uuid,
  updated_by text,
  auth_id uuid,
  device_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.liquidacion_periodos (
  marca_id integer not null,
  mk text not null check(mk~'^[0-9]{4}-[0-9]{2}$'),
  gastos jsonb not null default '[]'::jsonb check(jsonb_typeof(gastos)='array'),
  total_gastos numeric not null default 0 check(total_gastos between 0 and 1000000000),
  operation_id uuid,
  updated_by text,
  auth_id uuid,
  device_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(marca_id,mk)
);

create table if not exists public.alquiler_estados (
  id text primary key,
  marca_id integer not null,
  mk text not null check(mk~'^[0-9]{4}-[0-9]{2}$'),
  mes integer not null check(mes between 0 and 11),
  anio integer not null check(anio between 2020 and 2200),
  pagado boolean not null default false,
  fecha_pago text,
  operation_id uuid,
  updated_by text,
  auth_id uuid,
  device_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(marca_id,mk)
);

alter table public.liquidacion_config enable row level security;
alter table public.liquidacion_periodos enable row level security;
alter table public.alquiler_estados enable row level security;
revoke insert,update,delete on public.liquidacion_config,public.liquidacion_periodos,public.alquiler_estados
  from authenticated,anon;
grant select on public.liquidacion_config,public.liquidacion_periodos,public.alquiler_estados to authenticated;

drop policy if exists liquidacion_config_lectura on public.liquidacion_config;
create policy liquidacion_config_lectura on public.liquidacion_config for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol='admin' or (p.rol='marca' and p.marca_id=liquidacion_config.marca_id)));

drop policy if exists liquidacion_periodos_lectura on public.liquidacion_periodos;
create policy liquidacion_periodos_lectura on public.liquidacion_periodos for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol='admin' or (p.rol='marca' and p.marca_id=liquidacion_periodos.marca_id)));

drop policy if exists alquiler_estados_lectura on public.alquiler_estados;
create policy alquiler_estados_lectura on public.alquiler_estados for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol='admin' or (p.rol='marca' and p.marca_id=alquiler_estados.marca_id)));

create or replace function public.th_guardar_configuracion_financiera(
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
  v_payload jsonb:=jsonb_build_object('tipo',upper(btrim(coalesce(p_tipo,''))),'data',coalesce(p_data,'{}'::jsonb));
  v_prepared jsonb;
  v_marca_id integer;
  v_mk text;
  v_cfg jsonb;
  v_item jsonb;
  v_gastos jsonb:='[]'::jsonb;
  v_monto numeric;
  v_total numeric:=0;
  v_id text;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  if v_tipo not in ('LIQUIDACION_CONFIG','LIQUIDACION_GASTOS','ALQUILER_ESTADO') then
    raise exception using errcode='22023',message='Tipo de configuración financiera no soportado';
  end if;
  v_prepared:=public.th_prepare_operation(p_operation_id,'FINANZAS_'||v_tipo,v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    v_marca_id:=nullif(p_data->>'marcaId','')::integer;
    if v_marca_id is null or v_marca_id<=0 then
      raise exception using errcode='22023',message='Marca inválida';
    end if;

    if v_tipo='LIQUIDACION_CONFIG' then
      v_cfg:=coalesce(p_data->'configuracion','{}'::jsonb);
      if coalesce(nullif(v_cfg->>'pctTarjeta','')::numeric,0) not between 0 and 100
        or coalesce(nullif(v_cfg->>'pctComision','')::numeric,0) not between 0 and 100
        or coalesce(nullif(v_cfg->>'alquiler','')::numeric,0) not between 0 and 1000000000 then
        raise exception using errcode='22023',message='Porcentajes o alquiler fuera de rango';
      end if;
      insert into public.liquidacion_config(
        marca_id,pct_tarjeta,pct_comision,alquiler,operation_id,updated_by,auth_id,device_id,metadata,updated_at
      ) values(
        v_marca_id,coalesce(nullif(v_cfg->>'pctTarjeta','')::numeric,0),
        coalesce(nullif(v_cfg->>'pctComision','')::numeric,0),coalesce(nullif(v_cfg->>'alquiler','')::numeric,0),
        p_operation_id,v_actor->>'usuario',nullif(v_actor->>'authId','')::uuid,v_actor->>'deviceId',
        jsonb_build_object('clientVersion',v_actor->>'clientVersion'),now()
      ) on conflict(marca_id) do update set
        pct_tarjeta=excluded.pct_tarjeta,pct_comision=excluded.pct_comision,alquiler=excluded.alquiler,
        operation_id=excluded.operation_id,updated_by=excluded.updated_by,auth_id=excluded.auth_id,
        device_id=excluded.device_id,metadata=excluded.metadata,updated_at=now();

    elsif v_tipo='LIQUIDACION_GASTOS' then
      v_mk:=btrim(coalesce(p_data->>'mk',''));
      if v_mk!~'^[0-9]{4}-[0-9]{2}$'
        or coalesce(jsonb_typeof(coalesce(p_data->'gastos','null'::jsonb)),'null')<>'array' then
        raise exception using errcode='22023',message='Período o lista de gastos inválida';
      end if;
      if jsonb_array_length(p_data->'gastos')>100 then
        raise exception using errcode='22023',message='Demasiados gastos para un período';
      end if;
      if exists(select 1 from public.cierres where id=v_mk||'-'||v_marca_id and cerrado) then
        raise exception using errcode='55000',message='La liquidación está cerrada; reábrala antes de cambiar gastos';
      end if;
      for v_item in select value from jsonb_array_elements(p_data->'gastos') loop
        v_id:=left(btrim(coalesce(v_item->>'id','')),120);
        v_monto:=coalesce(nullif(v_item->>'monto','')::numeric,0);
        if v_id='' or length(coalesce(v_item->>'desc',''))>300 or v_monto not between 0 and 1000000000 then
          raise exception using errcode='22023',message='Gasto inválido';
        end if;
        v_gastos:=v_gastos||jsonb_build_array(jsonb_build_object(
          'id',v_id,'desc',btrim(coalesce(v_item->>'desc','')),'monto',v_monto
        ));
        v_total:=v_total+v_monto;
      end loop;
      insert into public.liquidacion_periodos(
        marca_id,mk,gastos,total_gastos,operation_id,updated_by,auth_id,device_id,metadata,updated_at
      ) values(
        v_marca_id,v_mk,v_gastos,v_total,p_operation_id,v_actor->>'usuario',
        nullif(v_actor->>'authId','')::uuid,v_actor->>'deviceId',
        jsonb_build_object('clientVersion',v_actor->>'clientVersion'),now()
      ) on conflict(marca_id,mk) do update set
        gastos=excluded.gastos,total_gastos=excluded.total_gastos,operation_id=excluded.operation_id,
        updated_by=excluded.updated_by,auth_id=excluded.auth_id,device_id=excluded.device_id,
        metadata=excluded.metadata,updated_at=now();

    else
      v_mk:=lpad((p_data->>'anio'),4,'0')||'-'||lpad(((p_data->>'mes')::integer+1)::text,2,'0');
      v_id:=left(coalesce(nullif(p_data->>'id',''),'ALQ-'||v_mk||'-'||v_marca_id),120);
      if (p_data->>'mes')::integer not between 0 and 11 or (p_data->>'anio')::integer not between 2020 and 2200 then
        raise exception using errcode='22023',message='Período de alquiler inválido';
      end if;
      insert into public.alquiler_estados(
        id,marca_id,mk,mes,anio,pagado,fecha_pago,operation_id,updated_by,auth_id,device_id,metadata,updated_at
      ) values(
        v_id,v_marca_id,v_mk,(p_data->>'mes')::integer,(p_data->>'anio')::integer,
        coalesce((p_data->>'pagado')::boolean,false),nullif(p_data->>'fechaPago',''),p_operation_id,
        v_actor->>'usuario',nullif(v_actor->>'authId','')::uuid,v_actor->>'deviceId',
        jsonb_build_object('clientVersion',v_actor->>'clientVersion'),now()
      ) on conflict(marca_id,mk) do update set
        pagado=excluded.pagado,fecha_pago=excluded.fecha_pago,operation_id=excluded.operation_id,
        updated_by=excluded.updated_by,auth_id=excluded.auth_id,device_id=excluded.device_id,
        metadata=excluded.metadata,updated_at=now();
    end if;

    perform public.th_append_audit(
      p_operation_id,v_tipo,v_actor,jsonb_build_object(
        'resumen',format('%s de marca %s confirmado por %s',replace(v_tipo,'_',' '),v_marca_id,v_actor->>'nombre'),
        'marcaId',v_marca_id,'mk',v_mk,'totalGastos',v_total,
        'payloadHash',public.th_payload_hash(v_payload),'engine','transactional'
      )
    );
    v_result:=jsonb_build_object(
      'ok',true,'operationId',p_operation_id,'tipo',v_tipo,'marcaId',v_marca_id,
      'mk',v_mk,'engine','transactional','serverTime',clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo',v_tipo,'marcaId',v_marca_id));
  end;
end;
$$;

revoke all on function public.th_guardar_configuracion_financiera(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.th_guardar_configuracion_financiera(uuid,text,jsonb,jsonb) to authenticated,service_role;

commit;
