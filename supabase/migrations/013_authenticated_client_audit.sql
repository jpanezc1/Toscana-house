-- Toscana House — eventos de interfaz autenticados por servidor e idempotentes por ID.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

alter table public.audit_log add column if not exists payload_hash text;

create or replace function public.th_registrar_evento_cliente(
  p_evento jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_id text:=btrim(coalesce(p_evento->>'id',''));
  v_tipo text:=upper(btrim(coalesce(p_evento->>'tipo','')));
  v_detalle jsonb:=coalesce(p_evento,'{}'::jsonb)-array['id','ts','fecha','hora','tipo','usuario','nombre','rol','operationId'];
  v_hash text;
  v_existing_hash text;
  v_now timestamptz:=clock_timestamp();
  v_inserted integer:=0;
begin
  if v_id='' or length(v_id)>120 or v_id!~'^EVT_[A-Za-z0-9_-]+$' then
    raise exception using errcode='22023',message='ID de evento inválido';
  end if;
  if v_tipo='' or length(v_tipo)>80 then
    raise exception using errcode='22023',message='Tipo de evento inválido';
  end if;
  if pg_column_size(v_detalle)>1048576 then
    raise exception using errcode='22023',message='El detalle del evento supera 1 MB';
  end if;
  v_hash:=public.th_payload_hash(jsonb_build_object('tipo',v_tipo,'detalle',v_detalle));

  insert into public.audit_log(
    id,ts,fecha,hora,tipo,usuario,nombre,rol,detalle,operation_id,auth_id,
    device_id,client_version,server_created_at,payload_hash
  ) values(
    v_id,floor(extract(epoch from v_now)*1000)::bigint,
    to_char(v_now at time zone 'America/La_Paz','DD/MM/YYYY'),
    to_char(v_now at time zone 'America/La_Paz','HH24:MI:SS'),
    v_tipo,v_actor->>'usuario',v_actor->>'nombre',v_actor->>'rol',v_detalle,
    case when coalesce(p_evento->>'operationId','')~'^[0-9a-fA-F-]{36}$' then (p_evento->>'operationId')::uuid end,
    nullif(v_actor->>'authId','')::uuid,v_actor->>'deviceId',v_actor->>'clientVersion',v_now,v_hash
  ) on conflict(id) do nothing;
  get diagnostics v_inserted=row_count;

  if v_inserted=0 then
    select payload_hash into v_existing_hash from public.audit_log where id=v_id;
    if v_existing_hash is not null and v_existing_hash<>v_hash then
      raise exception using errcode='23505',message='El ID de evento ya existe con otro contenido';
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,'eventId',v_id,'replay',v_inserted=0,'serverTime',v_now
  );
end;
$$;

revoke all on function public.th_registrar_evento_cliente(jsonb,jsonb) from public,anon;
grant execute on function public.th_registrar_evento_cliente(jsonb,jsonb) to authenticated,service_role;

commit;
