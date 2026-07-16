-- Toscana House — turnos de caja compartidos e idempotentes.
-- La pantalla histórica continúa oculta; esta migración prepara su reactivación segura.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $$
begin
  if exists(
    select 1 from public.caja_turnos where cerrada_at is null
    group by caja_id having count(*)>1
  ) then
    raise exception 'Hay cajas con más de un turno abierto; concilie antes de instalar el índice de exclusión';
  end if;
end $$;

create unique index if not exists caja_turnos_un_abierto_uidx
  on public.caja_turnos(caja_id) where cerrada_at is null;
alter table public.caja_turnos add column if not exists close_operation_id uuid;
create unique index if not exists caja_turnos_operation_uidx
  on public.caja_turnos(operation_id) where operation_id is not null;
create unique index if not exists caja_turnos_close_operation_uidx
  on public.caja_turnos(close_operation_id) where close_operation_id is not null;

insert into public.cajas(codigo,nombre,activa,metadata)
values
  ('MANANA','Caja Turno en la mañana',true,jsonb_build_object('seed','toscana-safe')),
  ('TARDE','Caja Turno en la tarde',true,jsonb_build_object('seed','toscana-safe'))
on conflict(codigo) do nothing;

create or replace function public.th_cambiar_turno_caja(
  p_operation_id uuid,
  p_caja_id bigint,
  p_accion text,
  p_balance numeric default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_accion text:=upper(btrim(coalesce(p_accion,'')));
  v_payload jsonb:=jsonb_build_object(
    'cajaId',p_caja_id,'accion',upper(btrim(coalesce(p_accion,''))),'balance',p_balance
  );
  v_prepared jsonb;
  v_caja public.cajas%rowtype;
  v_turno public.caja_turnos%rowtype;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor,array['admin','caja']);
  if v_accion not in ('ABRIR','CERRAR') then
    raise exception using errcode='22023',message='Acción de caja inválida';
  end if;
  v_prepared:=public.th_prepare_operation(p_operation_id,'CAJA_'||v_accion,v_payload,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    select * into v_caja from public.cajas where id=p_caja_id and activa for update;
    if not found then raise exception using errcode='P0002',message='Caja inexistente o inactiva'; end if;

    if v_accion='ABRIR' then
      if exists(select 1 from public.caja_turnos where caja_id=p_caja_id and cerrada_at is null) then
        raise exception using errcode='23505',message='La caja ya tiene un turno abierto';
      end if;
      insert into public.caja_turnos(
        caja_id,abierta_at,abierta_por,balance_apertura,operation_id,device_id,metadata
      ) values(
        p_caja_id,clock_timestamp(),v_actor->>'usuario',coalesce(p_balance,0),p_operation_id,
        v_actor->>'deviceId',jsonb_build_object(
          'authId',v_actor->>'authId','clientVersion',v_actor->>'clientVersion'
        )
      ) returning * into v_turno;
    else
      select * into v_turno from public.caja_turnos
      where caja_id=p_caja_id and cerrada_at is null for update;
      if not found then raise exception using errcode='P0002',message='La caja no tiene un turno abierto'; end if;
      if p_balance is null or p_balance<0 or p_balance>1000000000 then
        raise exception using errcode='22023',message='Balance de cierre inválido';
      end if;
      update public.caja_turnos set
        cerrada_at=clock_timestamp(),cerrada_por=v_actor->>'usuario',balance_cierre=p_balance,
        close_operation_id=p_operation_id,device_id=v_actor->>'deviceId',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'closeAuthId',v_actor->>'authId','closeClientVersion',v_actor->>'clientVersion'
        )
      where id=v_turno.id returning * into v_turno;
    end if;

    perform public.th_append_audit(
      p_operation_id,'CAJA_'||v_accion,v_actor,jsonb_build_object(
        'resumen',format('Caja %s %s por %s',v_caja.nombre,lower(v_accion),v_actor->>'nombre'),
        'cajaId',v_caja.id,'caja',v_caja.nombre,'turnoId',v_turno.id,
        'balance',case when v_accion='CERRAR' then p_balance else coalesce(p_balance,0) end,
        'engine','transactional'
      )
    );
    v_result:=jsonb_build_object(
      'ok',true,'operationId',p_operation_id,'accion',v_accion,'cajaId',v_caja.id,
      'turnoId',v_turno.id,'engine','transactional','serverTime',clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('cajaId',p_caja_id,'accion',v_accion));
  end;
end;
$$;

revoke all on function public.th_cambiar_turno_caja(uuid,bigint,text,numeric,jsonb) from public,anon;
grant execute on function public.th_cambiar_turno_caja(uuid,bigint,text,numeric,jsonb) to authenticated,service_role;

commit;
