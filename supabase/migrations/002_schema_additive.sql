-- Toscana House — esquema completo, aditivo e idempotente
-- No elimina tablas, columnas ni datos históricos.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tablas legacy mínimas. CREATE IF NOT EXISTS mantiene instalaciones actuales.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.inventario (
  id bigint primary key,
  codigo text not null,
  marca_id integer not null,
  marca_nombre text,
  nombre text not null,
  categoria text default 'General',
  descripcion text default '',
  subcat text default '',
  precio numeric not null,
  stock integer not null,
  stock_inicial integer not null,
  fecha text,
  created_at timestamptz default now()
);

create sequence if not exists public.inventario_id_seq;
alter sequence public.inventario_id_seq owned by public.inventario.id;
alter table public.inventario alter column id set default nextval('public.inventario_id_seq');
select setval(
  'public.inventario_id_seq',
  greatest(coalesce((select max(id) from public.inventario), 0) + 1, 1),
  false
);

alter table public.inventario
  add column if not exists descripcion text default '',
  add column if not exists subcat text default '',
  add column if not exists activo boolean not null default true,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists row_version bigint not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.ventas (
  id text primary key,
  fecha text,
  hora text,
  mk text,
  mes integer,
  anio integer,
  total numeric,
  subtotal numeric,
  desc_pct numeric default 0,
  metodo_pago text,
  vendedor text,
  etiqueta_img text,
  created_at timestamptz default now()
);

alter table public.ventas
  add column if not exists anulada boolean not null default false,
  add column if not exists fecha_anulacion text,
  add column if not exists anulada_at timestamptz,
  add column if not exists anulada_por text,
  add column if not exists motivo_anulacion text,
  add column if not exists cliente_nombre text,
  add column if not exists cliente_telefono text,
  add column if not exists origen text,
  add column if not exists canal text,
  add column if not exists efectivo numeric,
  add column if not exists qr numeric,
  add column if not exists tarjeta numeric,
  add column if not exists gc_id text,
  add column if not exists gc_usado numeric,
  add column if not exists gc_allocations jsonb,
  add column if not exists operation_id uuid,
  add column if not exists engine text not null default 'legacy',
  add column if not exists device_id text,
  add column if not exists client_version text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists server_created_at timestamptz default now();

create table if not exists public.venta_items (
  id bigserial primary key,
  venta_id text references public.ventas(id),
  prod_id bigint,
  codigo text,
  nombre text,
  marca_id integer,
  marca_nombre text,
  cantidad integer,
  precio_unit numeric,
  subtotal numeric
);

alter table public.venta_items
  add column if not exists line_key text,
  add column if not exists desc_pct numeric default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz default now();

create table if not exists public.cierres (
  id text primary key,
  marca_id integer,
  mk text,
  cerrado boolean default false,
  fecha text,
  created_at timestamptz default now()
);

alter table public.cierres
  add column if not exists usuario text,
  add column if not exists device_id text,
  add column if not exists operation_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz default now();

create table if not exists public.retiros (
  id text primary key,
  fecha text,
  hora text,
  prod_id bigint,
  codigo text,
  nombre text,
  marca_id integer,
  marca_nombre text,
  cantidad integer,
  destinatario text,
  motivo text,
  created_at timestamptz default now()
);

alter table public.retiros
  add column if not exists operation_id uuid,
  add column if not exists usuario text,
  add column if not exists device_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.cargas_inventario (
  id text primary key,
  ts bigint,
  fecha text,
  hora text,
  tipo text,
  usuario text,
  nombre text,
  rol text,
  marca_id integer,
  marca_nombre text,
  resumen text,
  total_items integer,
  nuevos integer default 0,
  actualizados integer default 0,
  detalle jsonb,
  created_at timestamptz default now()
);

alter table public.cargas_inventario
  add column if not exists verificado boolean not null default false,
  add column if not exists verificado_ts timestamptz,
  add column if not exists verificado_por text,
  add column if not exists archivo_nombre text,
  add column if not exists archivo_url text,
  add column if not exists operation_id uuid,
  add column if not exists revertida boolean not null default false,
  add column if not exists revertida_at timestamptz,
  add column if not exists revertida_por text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.auditorias_inventario (
  id text primary key,
  mk text,
  mes integer,
  anio integer,
  fecha text,
  hora text,
  usuario text,
  marca_id integer,
  total_productos integer,
  ok integer,
  faltantes integer,
  sobrantes integer,
  valor_fuga numeric,
  valor_sobrante numeric,
  detalle jsonb,
  created_at timestamptz default now()
);

alter table public.auditorias_inventario
  add column if not exists marcado_ok_por text,
  add column if not exists marcado_ok_ts timestamptz,
  add column if not exists operation_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.usuarios (
  usuario text primary key,
  password text,
  nombre text not null,
  rol text not null default 'caja',
  marca_id integer,
  estado text not null default 'activo',
  created_at timestamptz default now()
);

alter table public.usuarios
  add column if not exists auth_id uuid,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.marcas (
  id integer primary key,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.config_descuentos (
  marca_id integer primary key,
  marca_nombre text,
  activo boolean not null default false,
  pct numeric not null default 0,
  hasta date,
  updated_by text,
  updated_at timestamptz default now()
);

create table if not exists public.descuentos_codigo (
  codigo text primary key,
  marca_id integer,
  marca_nombre text,
  nombre text,
  activo boolean not null default false,
  pct numeric not null default 0,
  hasta date,
  updated_by text,
  updated_at timestamptz default now()
);

create table if not exists public.audit_log (
  id text primary key,
  ts bigint,
  fecha text,
  hora text,
  tipo text,
  usuario text,
  nombre text,
  rol text,
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.audit_log
  add column if not exists operation_id uuid,
  add column if not exists auth_id uuid,
  add column if not exists device_id text,
  add column if not exists client_version text,
  add column if not exists server_created_at timestamptz default now();

create table if not exists public.th_verif_sesion (
  id text primary key,
  mk text not null,
  marca_id integer,
  base_ts timestamptz not null,
  conteo jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Entidades antes locales que deben poder compartirse sin cambiar su UI.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  monto numeric not null,
  saldo numeric not null,
  emision date not null default current_date,
  vencimiento date,
  nota text,
  estado text not null default 'vigente',
  created_by text,
  updated_at timestamptz not null default now(),
  row_version bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.gift_card_usos (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references public.gift_cards(id),
  venta_id text references public.ventas(id),
  operation_id uuid,
  monto numeric not null,
  saldo_antes numeric not null,
  saldo_despues numeric not null,
  nota text,
  usuario text,
  created_at timestamptz not null default now()
);

create table if not exists public.cajas (
  id bigint generated by default as identity primary key,
  codigo text not null,
  nombre text not null,
  activa boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.caja_turnos (
  id uuid primary key default gen_random_uuid(),
  caja_id bigint not null references public.cajas(id),
  abierta_at timestamptz not null default now(),
  abierta_por text,
  cerrada_at timestamptz,
  cerrada_por text,
  balance_apertura numeric,
  balance_cierre numeric,
  operation_id uuid,
  device_id text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.facturas_venta (
  id uuid primary key default gen_random_uuid(),
  venta_id text not null references public.ventas(id),
  proveedor text not null default 'CUCU',
  numero text,
  cuf text,
  estado text not null default 'emitida',
  nombre_comprador text,
  nit_comprador text,
  telefono text,
  pdf_url text,
  qr_url text,
  emitida_at timestamptz not null default now(),
  anulada_at timestamptz,
  operation_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.cambios (
  id text primary key,
  venta_original_id text references public.ventas(id),
  fecha text,
  hora text,
  total_devuelto numeric not null default 0,
  total_nuevo numeric not null default 0,
  diferencia numeric not null default 0,
  metodo_pago text,
  vendedor text,
  notas text,
  usuario text,
  operation_id uuid,
  engine text not null default 'legacy',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cambio_items (
  id bigint generated by default as identity primary key,
  cambio_id text not null references public.cambios(id),
  direccion text not null,
  prod_id bigint references public.inventario(id),
  codigo text,
  nombre text,
  marca_id integer,
  marca_nombre text,
  cantidad integer not null,
  precio_unit numeric not null,
  line_key text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.bajas_inventario (
  id text primary key,
  prod_id bigint references public.inventario(id),
  codigo text,
  cantidad integer not null,
  motivo text,
  usuario text,
  operation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Índices no únicos y de bajo riesgo.
create index if not exists inventario_marca_idx on public.inventario(marca_id);
create index if not exists inventario_codigo_lookup_idx on public.inventario(upper(btrim(codigo)));
create index if not exists ventas_mk_idx on public.ventas(mk);
create index if not exists ventas_fecha_idx on public.ventas(fecha);
create index if not exists ventas_operation_idx on public.ventas(operation_id);
create index if not exists venta_items_venta_idx on public.venta_items(venta_id);
create index if not exists venta_items_prod_idx on public.venta_items(prod_id);
create index if not exists cargas_created_idx on public.cargas_inventario(created_at desc);
create index if not exists audit_log_ts_idx on public.audit_log(ts desc);
create index if not exists auditorias_created_idx on public.auditorias_inventario(created_at desc);

-- Índices únicos solo cuando los datos actuales ya son compatibles.
do $$
begin
  if not exists (
    select 1
    from public.inventario
    where nullif(btrim(codigo), '') is not null
    group by upper(btrim(codigo))
    having count(*) > 1
  ) then
    create unique index if not exists inventario_codigo_norm_uidx
      on public.inventario(upper(btrim(codigo)))
      where nullif(btrim(codigo), '') is not null;
  else
    raise warning 'No se creó inventario_codigo_norm_uidx: existen códigos duplicados';
  end if;
end $$;

create unique index if not exists venta_items_line_key_uidx
  on public.venta_items(venta_id, line_key);
create unique index if not exists ventas_operation_uidx
  on public.ventas(operation_id)
  where operation_id is not null;
create unique index if not exists gift_cards_codigo_norm_uidx
  on public.gift_cards(upper(btrim(codigo)));
create unique index if not exists gift_card_usos_operation_uidx
  on public.gift_card_usos(operation_id)
  where operation_id is not null;
create unique index if not exists cajas_codigo_uidx on public.cajas(codigo);
create unique index if not exists cambio_items_line_key_uidx
  on public.cambio_items(cambio_id, line_key)
  where line_key is not null;
create unique index if not exists usuarios_auth_id_uidx
  on public.usuarios(auth_id)
  where auth_id is not null;
create unique index if not exists facturas_venta_venta_uidx
  on public.facturas_venta(venta_id)
  where estado <> 'anulada';

commit;
