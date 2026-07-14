-- Toscana House — idempotencia y estado de revisión para mutaciones de identidad.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create table if not exists public.th_admin_operaciones (
  id uuid primary key,
  accion text not null,
  afectado text not null,
  payload_hash text not null,
  estado text not null default 'procesando'
    check(estado in ('procesando','confirmada','rechazada','revision')),
  resultado jsonb,
  error_message text,
  solicitado_por text not null,
  auth_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists th_admin_operaciones_estado_idx
  on public.th_admin_operaciones(estado,created_at desc);

alter table public.th_admin_operaciones enable row level security;
revoke insert,update,delete on public.th_admin_operaciones from authenticated,anon;
grant select on public.th_admin_operaciones to authenticated;

drop policy if exists th_admin_operaciones_lectura on public.th_admin_operaciones;
create policy th_admin_operaciones_lectura on public.th_admin_operaciones for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol='admin'));

commit;
