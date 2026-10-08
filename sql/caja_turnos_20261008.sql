-- Toscana House: libro de caja por turnos. No modifica stock ni ventas históricas.
-- La apertura/cierre se ejecuta exclusivamente con JWT de Supabase Auth.
create table if not exists public.th_caja_turnos (
  id uuid primary key default gen_random_uuid(),
  abierto_por uuid not null references auth.users(id),
  abierto_usuario text not null,
  abierto_at timestamptz not null default now(),
  efectivo_apertura numeric(12,2) not null check (efectivo_apertura >= 0),
  estado text not null default 'abierto' check (estado in ('abierto','cerrado')),
  cerrado_por uuid references auth.users(id),
  cerrado_usuario text,
  cerrado_at timestamptz,
  efectivo_contado numeric(12,2),
  cierre_resumen jsonb,
  constraint caja_cierre_completo check (
    (estado = 'abierto' and cerrado_at is null and efectivo_contado is null)
    or (estado = 'cerrado' and cerrado_at is not null and efectivo_contado is not null and cierre_resumen is not null)
  )
);
create unique index if not exists caja_un_turno_abierto
  on public.th_caja_turnos (estado) where estado = 'abierto';
create index if not exists caja_turnos_fecha on public.th_caja_turnos (abierto_at desc);

create table if not exists public.th_caja_movimientos (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null references public.th_caja_turnos(id),
  tipo text not null check (tipo in ('retiro','aporte')),
  monto numeric(12,2) not null check (monto > 0),
  destinatario text not null,
  motivo text not null,
  creado_por uuid not null references auth.users(id),
  creado_usuario text not null,
  creado_at timestamptz not null default now(),
  reversa_de uuid unique references public.th_caja_movimientos(id),
  constraint caja_mov_textos check (length(trim(destinatario)) > 0 and length(trim(motivo)) > 0)
);
create index if not exists caja_movimientos_turno on public.th_caja_movimientos (turno_id, creado_at);

alter table public.ventas add column if not exists caja_turno_id uuid references public.th_caja_turnos(id);
create index if not exists ventas_caja_turno on public.ventas (caja_turno_id) where caja_turno_id is not null;

alter table public.th_caja_turnos enable row level security;
alter table public.th_caja_movimientos enable row level security;
revoke all on public.th_caja_turnos from anon, authenticated;
revoke all on public.th_caja_movimientos from anon, authenticated;
grant select on public.th_caja_turnos, public.th_caja_movimientos to authenticated;

create or replace function public.caja_actor()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_usuario text;
begin
  select u.usuario into v_usuario from public.usuarios u
   where u.auth_id = auth.uid() and u.estado = 'activo' and u.rol in ('caja','admin')
   limit 1;
  if v_usuario is null then raise exception 'Cuenta de caja no autorizada'; end if;
  return v_usuario;
end $$;
revoke all on function public.caja_actor() from public, anon;
grant execute on function public.caja_actor() to authenticated;

create policy caja_turnos_lectura on public.th_caja_turnos for select to authenticated
  using (public.caja_actor() is not null);
create policy caja_movimientos_lectura on public.th_caja_movimientos for select to authenticated
  using (public.caja_actor() is not null);

create or replace function public.caja_abrir(p_efectivo numeric)
returns public.th_caja_turnos language plpgsql security definer set search_path = '' as $$
declare v_usuario text; v_turno public.th_caja_turnos;
begin
  v_usuario := public.caja_actor();
  if p_efectivo is null or p_efectivo < 0 or p_efectivo > 1000000
     or round(p_efectivo,2) <> p_efectivo then
    raise exception 'Efectivo inicial inválido';
  end if;
  perform pg_advisory_xact_lock(17382841);
  select * into v_turno from public.th_caja_turnos where estado = 'abierto' limit 1;
  if found then raise exception 'Ya hay un turno abierto; primero debe cerrarse'; end if;
  insert into public.th_caja_turnos(abierto_por, abierto_usuario, efectivo_apertura)
    values(auth.uid(), v_usuario, p_efectivo) returning * into v_turno;
  return v_turno;
end $$;

create or replace function public.caja_movimiento(
  p_turno uuid, p_tipo text, p_monto numeric, p_destinatario text, p_motivo text,
  p_reversa_de uuid default null
) returns public.th_caja_movimientos language plpgsql security definer set search_path = '' as $$
declare v_usuario text; v_turno public.th_caja_turnos; v_original public.th_caja_movimientos; v_mov public.th_caja_movimientos;
begin
  v_usuario := public.caja_actor();
  select * into v_turno from public.th_caja_turnos where id = p_turno for update;
  if not found or v_turno.estado <> 'abierto' then raise exception 'Turno no abierto'; end if;
  if p_tipo not in ('retiro','aporte') or p_monto is null or p_monto <= 0
     or p_monto > 1000000 or round(p_monto,2) <> p_monto
     or nullif(trim(p_destinatario),'') is null or nullif(trim(p_motivo),'') is null then
    raise exception 'Movimiento inválido';
  end if;
  if p_reversa_de is not null then
    select * into v_original from public.th_caja_movimientos where id = p_reversa_de and turno_id = p_turno;
    if not found or v_original.reversa_de is not null or v_original.tipo = p_tipo
       or v_original.monto <> p_monto then raise exception 'Reversa inválida'; end if;
  end if;
  insert into public.th_caja_movimientos(turno_id,tipo,monto,destinatario,motivo,creado_por,creado_usuario,reversa_de)
    values(p_turno,p_tipo,p_monto,trim(p_destinatario),trim(p_motivo),auth.uid(),v_usuario,p_reversa_de)
    returning * into v_mov;
  return v_mov;
end $$;

create or replace function public.caja_resumen(p_turno uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_turno public.th_caja_turnos; v_ventas jsonb; v_mov jsonb; v_efectivo numeric; v_aportes numeric; v_retiros numeric;
begin
  perform public.caja_actor();
  select * into v_turno from public.th_caja_turnos where id = p_turno;
  if not found then raise exception 'Turno inexistente'; end if;
  select jsonb_build_object(
    'cantidad', count(*), 'total', coalesce(sum(total),0),
    'efectivo', coalesce(sum(efectivo),0), 'qr', coalesce(sum(qr),0),
    'tarjeta', coalesce(sum(tarjeta),0), 'giftcard', coalesce(sum(gc_usado),0)
  ) into v_ventas from public.ventas
   where caja_turno_id = p_turno and coalesce(anulada,false) = false;
  select coalesce(sum(monto) filter (where tipo='aporte'),0),
         coalesce(sum(monto) filter (where tipo='retiro'),0), count(*)
    into v_aportes,v_retiros,v_efectivo
    from public.th_caja_movimientos where turno_id = p_turno;
  v_mov := jsonb_build_object('aportes',v_aportes,'retiros',v_retiros,'cantidad',v_efectivo);
  return jsonb_build_object('turno_id',p_turno,'apertura',v_turno.efectivo_apertura,
    'ventas',v_ventas,'movimientos',v_mov,
    'esperado',v_turno.efectivo_apertura + (v_ventas->>'efectivo')::numeric + v_aportes - v_retiros);
end $$;

create or replace function public.caja_cerrar(p_turno uuid, p_contado numeric)
returns public.th_caja_turnos language plpgsql security definer set search_path = '' as $$
declare v_usuario text; v_turno public.th_caja_turnos; v_resumen jsonb;
begin
  v_usuario := public.caja_actor();
  if p_contado is null or p_contado < 0 or p_contado > 1000000
     or round(p_contado,2) <> p_contado then raise exception 'Efectivo contado inválido'; end if;
  select * into v_turno from public.th_caja_turnos where id = p_turno for update;
  if not found or v_turno.estado <> 'abierto' then raise exception 'Turno no abierto'; end if;
  v_resumen := public.caja_resumen(p_turno);
  v_resumen := v_resumen || jsonb_build_object('contado',p_contado,
    'diferencia', p_contado - (v_resumen->>'esperado')::numeric);
  update public.th_caja_turnos set estado='cerrado', cerrado_por=auth.uid(),
    cerrado_usuario=v_usuario, cerrado_at=now(), efectivo_contado=p_contado,
    cierre_resumen=v_resumen where id=p_turno returning * into v_turno;
  return v_turno;
end $$;

revoke all on function public.caja_abrir(numeric), public.caja_movimiento(uuid,text,numeric,text,text,uuid),
  public.caja_resumen(uuid), public.caja_cerrar(uuid,numeric) from public, anon;
grant execute on function public.caja_abrir(numeric), public.caja_movimiento(uuid,text,numeric,text,text,uuid),
  public.caja_resumen(uuid), public.caja_cerrar(uuid,numeric) to authenticated;

-- Archivo histórico privado: un PDF por turno cerrado. El cliente crea el PDF
-- desde el resumen inmutable del cierre y lo sube sin sobrescribirlo.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('caja-cierres','caja-cierres',false,1048576,array['application/pdf'])
on conflict (id) do nothing;
create policy caja_pdf_leer on storage.objects for select to authenticated
  using (bucket_id='caja-cierres' and public.caja_actor() is not null);
create policy caja_pdf_subir on storage.objects for insert to authenticated
  with check (
    bucket_id='caja-cierres' and public.caja_actor() is not null
    and name ~ '^[0-9a-f-]{36}[.]pdf$'
    and exists (select 1 from public.th_caja_turnos t
      where t.id::text || '.pdf' = name and t.estado='cerrado')
  );
