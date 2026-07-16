-- Toscana House — conteo físico multi-dispositivo atómico, idempotente y trazable.
-- Aditivo: el gate RLS se activa por separado después de validar staging.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

alter table public.th_verif_sesion
  add column if not exists created_by text,
  add column if not exists updated_by text,
  add column if not exists auth_id uuid,
  add column if not exists device_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.th_verif_movimientos (
  id bigint generated always as identity primary key,
  operation_id uuid not null unique,
  sesion_id text not null references public.th_verif_sesion(id),
  codigo text not null,
  delta integer not null check(delta=1),
  conteo_antes integer not null check(conteo_antes>=0),
  conteo_despues integer not null check(conteo_despues=conteo_antes+delta),
  usuario text not null,
  auth_id uuid,
  device_id text,
  client_version text,
  created_at timestamptz not null default now()
);

create index if not exists th_verif_movimientos_sesion_idx
  on public.th_verif_movimientos(sesion_id,created_at);
create index if not exists th_verif_movimientos_codigo_idx
  on public.th_verif_movimientos(sesion_id,codigo);

create or replace function public.th_bloquear_mutacion_verif()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  raise exception using errcode='55000',
    message='Los movimientos del conteo físico son inmutables; reinicie la sesión con una operación compensatoria';
end;
$$;

drop trigger if exists th_verif_movimientos_inmutables on public.th_verif_movimientos;
create trigger th_verif_movimientos_inmutables
before update or delete on public.th_verif_movimientos
for each row execute function public.th_bloquear_mutacion_verif();

alter table public.th_verif_movimientos enable row level security;
revoke insert,update,delete on public.th_verif_movimientos from authenticated,anon;
grant select on public.th_verif_movimientos to authenticated;

drop policy if exists th_verif_movimientos_lectura_admin on public.th_verif_movimientos;
create policy th_verif_movimientos_lectura_admin on public.th_verif_movimientos
for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol='admin'));

create or replace function public.th_iniciar_sesion_verificacion(
  p_id text,
  p_mk text,
  p_marca_id integer,
  p_base_ts timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_sesion public.th_verif_sesion%rowtype;
  v_inserted integer:=0;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  if coalesce(p_id,'')!~'^VERIF-[A-Za-z0-9_-]{3,100}$' or coalesce(p_mk,'')!~'^[0-9]{4}-[0-9]{2}$' then
    raise exception using errcode='22023',message='Identificador de sesión de verificación inválido';
  end if;
  if p_base_ts is null then
    raise exception using errcode='22023',message='La fecha base de la verificación es obligatoria';
  end if;

  insert into public.th_verif_sesion(
    id,mk,marca_id,base_ts,conteo,created_by,updated_by,auth_id,device_id,metadata,created_at,updated_at
  ) values(
    p_id,p_mk,p_marca_id,p_base_ts,'{}'::jsonb,v_actor->>'usuario',v_actor->>'usuario',
    nullif(v_actor->>'authId','')::uuid,v_actor->>'deviceId',
    jsonb_build_object('clientVersion',v_actor->>'clientVersion'),now(),now()
  ) on conflict(id) do nothing;
  get diagnostics v_inserted=row_count;

  select * into strict v_sesion from public.th_verif_sesion where id=p_id;
  if v_sesion.mk<>p_mk or v_sesion.marca_id is distinct from p_marca_id then
    raise exception using errcode='23505',message='La sesión ya existe con otro mes o alcance de marca';
  end if;

  return jsonb_build_object(
    'ok',true,'created',v_inserted=1,'id',v_sesion.id,'conteo',v_sesion.conteo,
    'baseTs',v_sesion.base_ts,'serverTime',clock_timestamp()
  );
end;
$$;

create or replace function public.th_incrementar_conteo_verificacion(
  p_operation_id uuid,
  p_id text,
  p_codigo text,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_codigo text:=upper(btrim(coalesce(p_codigo,'')));
  v_payload jsonb:=jsonb_build_object('sesionId',p_id,'codigo',upper(btrim(coalesce(p_codigo,''))));
  v_prepared jsonb;
  v_sesion public.th_verif_sesion%rowtype;
  v_antes integer:=0;
  v_despues integer;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'CONTEO_FISICO_SCAN',v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    if v_codigo='' or length(v_codigo)>120 then
      raise exception using errcode='22023',message='Código de producto inválido';
    end if;
    select * into v_sesion from public.th_verif_sesion where id=p_id for update;
    if not found then raise exception using errcode='P0002',message='Sesión de verificación no encontrada'; end if;

    if not exists(
      select 1 from public.inventario i
      where upper(btrim(i.codigo))=v_codigo and i.activo
        and (v_sesion.marca_id is null or i.marca_id=v_sesion.marca_id)
    ) then
      raise exception using errcode='P0002',message='Producto inexistente, inactivo o fuera del alcance de la verificación';
    end if;

    if coalesce(v_sesion.conteo->>v_codigo,'')~'^[0-9]+$' then
      v_antes:=(v_sesion.conteo->>v_codigo)::integer;
    end if;
    v_despues:=v_antes+1;
    update public.th_verif_sesion set
      conteo=jsonb_set(coalesce(conteo,'{}'::jsonb),array[v_codigo],to_jsonb(v_despues),true),
      updated_by=v_actor->>'usuario',auth_id=nullif(v_actor->>'authId','')::uuid,
      device_id=v_actor->>'deviceId',updated_at=now()
    where id=p_id;

    insert into public.th_verif_movimientos(
      operation_id,sesion_id,codigo,delta,conteo_antes,conteo_despues,
      usuario,auth_id,device_id,client_version
    ) values(
      p_operation_id,p_id,v_codigo,1,v_antes,v_despues,v_actor->>'usuario',
      nullif(v_actor->>'authId','')::uuid,v_actor->>'deviceId',v_actor->>'clientVersion'
    );

    v_result:=jsonb_build_object(
      'ok',true,'operationId',p_operation_id,'sesionId',p_id,
      'codigo',v_codigo,'conteo',jsonb_build_object(v_codigo,v_despues),
      'engine','transactional','serverTime',clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('sesionId',p_id,'codigo',v_codigo));
  end;
end;
$$;

create or replace function public.th_reiniciar_sesion_verificacion(
  p_operation_id uuid,
  p_id text,
  p_motivo text default 'reinicio_manual',
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_motivo text:=left(btrim(coalesce(p_motivo,'reinicio_manual')),200);
  v_payload jsonb:=jsonb_build_object('sesionId',p_id,'motivo',left(btrim(coalesce(p_motivo,'reinicio_manual')),200));
  v_prepared jsonb;
  v_sesion public.th_verif_sesion%rowtype;
  v_productos integer:=0;
  v_unidades integer:=0;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin']);
  v_prepared:=public.th_prepare_operation(p_operation_id,'CONTEO_FISICO_RESET',v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    select * into v_sesion from public.th_verif_sesion where id=p_id for update;
    if not found then raise exception using errcode='P0002',message='Sesión de verificación no encontrada'; end if;
    select count(*),coalesce(sum(value::integer),0) into v_productos,v_unidades
    from jsonb_each_text(coalesce(v_sesion.conteo,'{}'::jsonb));

    update public.th_verif_sesion set
      conteo='{}'::jsonb,updated_by=v_actor->>'usuario',
      auth_id=nullif(v_actor->>'authId','')::uuid,device_id=v_actor->>'deviceId',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'ultimoReinicio',clock_timestamp(),'ultimoReinicioMotivo',v_motivo,
        'ultimoReinicioOperationId',p_operation_id
      ),updated_at=now()
    where id=p_id;

    perform public.th_append_audit(
      p_operation_id,'CONTEO_FISICO_REINICIADO',v_actor,
      jsonb_build_object(
        'resumen',format('Conteo %s reiniciado por %s',p_id,v_actor->>'nombre'),
        'sesionId',p_id,'motivo',v_motivo,'productosAntes',v_productos,
        'unidadesAntes',v_unidades,'engine','transactional'
      )
    );
    v_result:=jsonb_build_object(
      'ok',true,'operationId',p_operation_id,'sesionId',p_id,
      'productosAntes',v_productos,'unidadesAntes',v_unidades,
      'engine','transactional','serverTime',clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('sesionId',p_id));
  end;
end;
$$;

revoke all on function public.th_iniciar_sesion_verificacion(text,text,integer,timestamptz,jsonb) from public,anon;
revoke all on function public.th_incrementar_conteo_verificacion(uuid,text,text,jsonb) from public,anon;
revoke all on function public.th_reiniciar_sesion_verificacion(uuid,text,text,jsonb) from public,anon;
grant execute on function public.th_iniciar_sesion_verificacion(text,text,integer,timestamptz,jsonb) to authenticated,service_role;
grant execute on function public.th_incrementar_conteo_verificacion(uuid,text,text,jsonb) to authenticated,service_role;
grant execute on function public.th_reiniciar_sesion_verificacion(uuid,text,text,jsonb) to authenticated,service_role;

commit;
