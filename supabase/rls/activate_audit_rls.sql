-- GATE MANUAL. Ejecutar sólo con el bundle nuevo adoptado y el outbox auditLog vacío.

begin;

do $$
begin
  if exists(select 1 from public.usuarios where estado='activo' and auth_id is null) then
    raise exception 'No se puede activar RLS de auditoría: hay usuarios activos sin auth_id';
  end if;
  if to_regprocedure('public.th_registrar_evento_cliente(jsonb,jsonb)') is null then
    raise exception 'No se puede activar RLS de auditoría: falta la RPC autenticada';
  end if;
end $$;

alter table public.audit_log enable row level security;
grant select on public.audit_log to authenticated;
revoke insert,update,delete on public.audit_log from authenticated;
revoke all on public.audit_log from anon;

drop policy if exists "allow all audit_log" on public.audit_log;

drop policy if exists audit_log_lectura_admin on public.audit_log;
create policy audit_log_lectura_admin on public.audit_log for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol='admin'));

commit;
