-- ═══════════════════════════════════════════════════════════════════════════
-- Toscana House × Loop · núcleo seguro de stock (15/10/2026)
--
-- Toscana es la ÚNICA fuente de stock. Este archivo agrega:
--   1. th_mover_stock: la caja suma o resta unidades en la base (en lugar de
--      escribir el número final calculado en el navegador). Con referencia para
--      que un reintento del outbox no descuente dos veces.
--   2. reservas_canal: Loop aparta prendas 15 min mientras el cliente paga.
--      "Disponible" = stock − reservas activas.
--   3. Ventas del canal Loop dentro de ventas/venta_items (canal = 'loop'). La plata
--      la cobra Loop, NO Toscana: la venta queda en Bs 0 para Toscana (no suma a la
--      caja, a los métodos ni a la liquidación que paga Toscana) y la prenda figura
--      como "Vendida por Loop". El precio de Loop queda en total_loop / precio_loop,
--      solo de referencia. Toscana es el depósito, el custodio y la base de datos.
--   4. Funciones canal_* para el servidor de Loop (solo service_role).
--
-- Se puede correr más de una vez. No borra ni cambia datos existentes.
-- Correr en Supabase → SQL Editor del proyecto uqphxiixdulqscbfyxhz.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Columnas de canal en ventas ─────────────────────────────────────────
alter table public.ventas add column if not exists canal text not null default 'local';
alter table public.ventas add column if not exists pedido_loop text;
alter table public.ventas add column if not exists total_loop numeric;
alter table public.venta_items add column if not exists precio_loop numeric;
create unique index if not exists ventas_pedido_loop_unico on public.ventas (pedido_loop) where pedido_loop is not null;

-- ── 2. Tablas de apoyo ─────────────────────────────────────────────────────
-- Referencias de movimientos ya aplicados (idempotencia del outbox de la caja).
create table if not exists public.th_stock_refs (
  ref text primary key,
  creado_at timestamptz not null default now()
);

-- Prendas apartadas por un canal (Loop) mientras el cliente paga.
create table if not exists public.reservas_canal (
  id uuid primary key default gen_random_uuid(),
  canal text not null default 'loop',
  pedido text not null,
  codigo text not null,
  cantidad integer not null check (cantidad > 0),
  estado text not null default 'activa' check (estado in ('activa','consumida','liberada','vencida')),
  vence_en timestamptz not null,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now(),
  unique (pedido, codigo)
);
create index if not exists reservas_canal_activas on public.reservas_canal (codigo) where estado = 'activa';

-- Cuando una venta del local deja el stock por debajo de lo reservado por Loop.
-- La venta física siempre gana; esto avisa para que Loop resuelva el pedido.
create table if not exists public.th_canal_conflictos (
  id bigserial primary key,
  codigo text not null,
  detalle text,
  creado_at timestamptz not null default now(),
  resuelto boolean not null default false
);

alter table public.th_stock_refs enable row level security;
alter table public.reservas_canal enable row level security;
alter table public.th_canal_conflictos enable row level security;
-- Sin políticas: anon no lee ni escribe estas tablas directamente; solo las funciones.

-- ── 3. Reservado y disponible ──────────────────────────────────────────────
create or replace function public.th_reservado(p_codigo text)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(cantidad), 0)::integer from public.reservas_canal
   where codigo = p_codigo and estado = 'activa' and vence_en > now();
$$;

create or replace view public.inventario_canal as
  select i.id, i.codigo, i.marca_id, i.marca_nombre, i.nombre, i.categoria, i.subcat, i.descripcion,
         i.precio, i.stock,
         coalesce(r.reservado, 0)::integer as reservado,
         greatest(0, i.stock - coalesce(r.reservado, 0))::integer as disponible
    from public.inventario i
    left join (select codigo, sum(cantidad) as reservado from public.reservas_canal
                where estado = 'activa' and vence_en > now() group by codigo) r on r.codigo = i.codigo;
revoke all on public.inventario_canal from public, anon, authenticated;
grant select on public.inventario_canal to service_role;

-- Lo que Loop tiene apartado ahora (para que la caja lo muestre). Solo códigos y
-- cantidades: ningún dato del cliente de Loop.
create or replace function public.th_reservas_loop()
returns table (codigo text, reservado integer, vence_en timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.codigo, sum(r.cantidad)::integer, min(r.vence_en)
    from public.reservas_canal r
   where r.estado = 'activa' and r.vence_en > now()
   group by r.codigo;
$$;
revoke all on function public.th_reservas_loop() from public;
grant execute on function public.th_reservas_loop() to anon, authenticated, service_role;

-- ── 4. Caja: mover stock de forma relativa ─────────────────────────────────
-- Devuelve el stock resultante. Si el producto no existe devuelve nada (la cola
-- de la caja lo da por hecho, igual que hoy). Nunca deja stock negativo.
create or replace function public.th_mover_stock(p_id bigint, p_delta integer,
  p_delta_inicial integer default 0, p_ref text default null)
returns table (stock integer, stock_inicial integer)
language plpgsql security definer set search_path = '' as $$
declare v_codigo text; v_stock integer; v_reservado integer;
begin
  if p_ref is not null then
    insert into public.th_stock_refs(ref) values (p_ref) on conflict do nothing;
    if not found then
      -- ya aplicado: devolver el valor actual sin volver a mover
      return query select i.stock, i.stock_inicial from public.inventario i where i.id = p_id;
      return;
    end if;
  end if;

  update public.inventario i
     set stock = greatest(0, i.stock + coalesce(p_delta, 0)),
         stock_inicial = greatest(0, coalesce(i.stock_inicial, 0) + coalesce(p_delta_inicial, 0))
   where i.id = p_id
  returning i.codigo, i.stock into v_codigo, v_stock;

  if v_codigo is null then return; end if;

  if coalesce(p_delta, 0) < 0 then
    v_reservado := public.th_reservado(v_codigo);
    if v_stock < v_reservado then
      insert into public.th_canal_conflictos(codigo, detalle)
      values (v_codigo, 'La caja dejó ' || v_stock || ' unidad(es) y Loop tenía ' || v_reservado || ' reservada(s).');
    end if;
  end if;

  return query select i.stock, i.stock_inicial from public.inventario i where i.id = p_id;
end $$;
revoke all on function public.th_mover_stock(bigint, integer, integer, text) from public;
grant execute on function public.th_mover_stock(bigint, integer, integer, text) to anon, authenticated, service_role;

-- ── 5. Funciones del canal Loop (solo el servidor de Loop) ──────────────────

-- Vence reservas pasadas de hora.
create or replace function public.canal_vencer()
returns integer language sql security definer set search_path = '' as $$
  with v as (
    update public.reservas_canal set estado = 'vencida', actualizado_at = now()
     where estado = 'activa' and vence_en <= now() returning 1)
  select count(*)::integer from v;
$$;

-- Aparta todas las prendas de un pedido o ninguna.
-- p_items: [{"codigo":"DON-T/U-377","cantidad":1}, ...]
create or replace function public.canal_reservar(p_pedido text, p_items jsonb, p_minutos integer default 15)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_stock integer; v_reservado integer; v_vence timestamptz;
begin
  if p_pedido is null or length(p_pedido) = 0 then raise exception 'falta el pedido'; end if;
  perform public.canal_vencer();

  -- Idempotente: si el pedido ya tiene reservas activas, devolverlas.
  select min(vence_en) into v_vence from public.reservas_canal where pedido = p_pedido and estado = 'activa';
  if v_vence is not null then
    return jsonb_build_object('ok', true, 'ya', true, 'vence_en', v_vence);
  end if;

  v_vence := now() + make_interval(mins => greatest(1, least(coalesce(p_minutos, 15), 60)));
  for r in
    select upper(trim(x->>'codigo')) as codigo, sum((x->>'cantidad')::integer) as cantidad
      from jsonb_array_elements(p_items) x
     group by 1 order by 1          -- orden fijo: evita bloqueos cruzados entre dos pedidos
  loop
    if r.cantidad is null or r.cantidad <= 0 then raise exception 'cantidad inválida para %', r.codigo; end if;
    select i.stock into v_stock from public.inventario i where upper(i.codigo) = r.codigo for update;
    if v_stock is null then raise exception 'sin_producto:%', r.codigo; end if;
    v_reservado := public.th_reservado(r.codigo);
    if v_stock - v_reservado < r.cantidad then raise exception 'sin_stock:%', r.codigo; end if;
    insert into public.reservas_canal(pedido, codigo, cantidad, vence_en)
    values (p_pedido, r.codigo, r.cantidad, v_vence)
    on conflict (pedido, codigo) do update
      set cantidad = excluded.cantidad, estado = 'activa', vence_en = excluded.vence_en, actualizado_at = now();
  end loop;
  return jsonb_build_object('ok', true, 'vence_en', v_vence);
end $$;

-- Suelta las reservas de un pedido (cancelado o vencido en Loop).
create or replace function public.canal_liberar(p_pedido text)
returns integer language sql security definer set search_path = '' as $$
  with v as (
    update public.reservas_canal set estado = 'liberada', actualizado_at = now()
     where pedido = p_pedido and estado = 'activa' returning 1)
  select count(*)::integer from v;
$$;

-- Pago confirmado en Loop: descuenta stock, consume la reserva y registra la
-- venta con canal 'loop'. Repetirla no vende dos veces.
-- p_venta: {"fecha":"2026-10-15","hora":"10:30","total":511,"subtotal":493,
--           "metodo_pago":"QR","cliente_nombre":"...","cliente_telefono":"...",
--           "items":[{"codigo":"...","cantidad":1,"precio_unit":383,"subtotal":383}]}
create or replace function public.canal_confirmar_venta(p_pedido text, p_venta jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id text := 'LOOP-' || p_pedido;
  v_fecha date := coalesce((p_venta->>'fecha')::date, (now() at time zone 'America/La_Paz')::date);
  it record; p record; v_res integer;
begin
  if p_pedido is null or length(p_pedido) = 0 then raise exception 'falta el pedido'; end if;
  if exists (select 1 from public.ventas where pedido_loop = p_pedido) then
    return jsonb_build_object('ok', true, 'ya', true, 'venta_id', v_id);
  end if;

  for it in
    select upper(trim(x->>'codigo')) as codigo, sum((x->>'cantidad')::integer) as cantidad
      from jsonb_array_elements(p_venta->'items') x group by 1 order by 1
  loop
    select i.id, i.stock into p from public.inventario i where upper(i.codigo) = it.codigo for update;
    if p.id is null then raise exception 'sin_producto:%', it.codigo; end if;
    -- Lo reservado por ESTE pedido ya está apartado para él; lo de otros no.
    select coalesce(sum(cantidad), 0) into v_res from public.reservas_canal
     where codigo = it.codigo and estado = 'activa' and vence_en > now() and pedido <> p_pedido;
    if p.stock - v_res < it.cantidad then raise exception 'sin_stock:%', it.codigo; end if;
    update public.inventario set stock = stock - it.cantidad where id = p.id;
    update public.reservas_canal set estado = 'consumida', actualizado_at = now()
     where pedido = p_pedido and codigo = it.codigo and estado in ('activa','vencida');
  end loop;

  insert into public.ventas (id, fecha, hora, mk, mes, anio, total, subtotal, desc_pct, metodo_pago,
                             efectivo, qr, tarjeta, gc_usado, vendedor, cliente_nombre, cliente_telefono,
                             canal, pedido_loop, total_loop)
  values (v_id, to_char(v_fecha, 'YYYY-MM-DD'), coalesce(p_venta->>'hora', to_char(now() at time zone 'America/La_Paz', 'HH24:MI')),
          to_char(v_fecha, 'YYYY-MM'), extract(month from v_fecha)::integer - 1, extract(year from v_fecha)::integer,
          0, 0, 0,                                   -- para Toscana la venta es Bs 0: la cobró Loop
          'Loop',
          0, 0, 0, 0, 'Loop', p_venta->>'cliente_nombre', p_venta->>'cliente_telefono',
          'loop', p_pedido, coalesce((p_venta->>'total')::numeric, 0));

  insert into public.venta_items (venta_id, prod_id, codigo, nombre, marca_id, marca_nombre, cantidad, precio_unit, subtotal, precio_loop)
  select v_id, i.id, i.codigo, coalesce(x->>'nombre', i.nombre), i.marca_id, i.marca_nombre,
         (x->>'cantidad')::integer, 0, 0, (x->>'precio_unit')::numeric
    from jsonb_array_elements(p_venta->'items') x
    join public.inventario i on upper(i.codigo) = upper(trim(x->>'codigo'));

  return jsonb_build_object('ok', true, 'venta_id', v_id);
end $$;

-- Devolución aprobada en Loop: el stock vuelve y la venta queda anulada.
create or replace function public.canal_devolver_venta(p_pedido text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id text; v_anulada boolean; it record;
begin
  select id, coalesce(anulada, false) into v_id, v_anulada from public.ventas where pedido_loop = p_pedido for update;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'no hay venta de ese pedido'); end if;
  if v_anulada then return jsonb_build_object('ok', true, 'ya', true); end if;
  for it in select codigo, sum(cantidad) as cantidad from public.venta_items where venta_id = v_id group by codigo loop
    update public.inventario set stock = stock + it.cantidad where upper(codigo) = upper(it.codigo);
  end loop;
  update public.ventas set anulada = true where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.canal_vencer() from public, anon, authenticated;
revoke all on function public.canal_reservar(text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.canal_liberar(text) from public, anon, authenticated;
revoke all on function public.canal_confirmar_venta(text, jsonb) from public, anon, authenticated;
revoke all on function public.canal_devolver_venta(text) from public, anon, authenticated;
revoke all on function public.th_reservado(text) from public, anon, authenticated;
grant execute on function public.canal_vencer(), public.canal_reservar(text, jsonb, integer), public.canal_liberar(text),
  public.canal_confirmar_venta(text, jsonb), public.canal_devolver_venta(text), public.th_reservado(text) to service_role;
