-- Toscana House — núcleo transaccional e idempotente
-- Las funciones quedan instaladas, pero el flag production continúa en legacy.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Identidad, autorización e idempotencia
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.th_actor(p_context jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_auth_id uuid;
  v_usuario public.usuarios%rowtype;
  v_jwt_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  v_auth_id := auth.uid();

  if v_auth_id is not null then
    select * into v_usuario
    from public.usuarios
    where auth_id = v_auth_id and estado = 'activo'
    limit 1;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'La sesión no tiene un perfil activo de Toscana House';
    end if;

    return jsonb_build_object(
      'authId', v_auth_id,
      'usuario', v_usuario.usuario,
      'nombre', v_usuario.nombre,
      'rol', v_usuario.rol,
      'marcaId', v_usuario.marca_id,
      'deviceId', nullif(p_context->>'deviceId',''),
      'clientVersion', nullif(p_context->>'clientVersion','')
    );
  end if;

  -- Solo SQL Editor/service role puede usar identidad explícita para pruebas,
  -- migraciones y recuperación. anon/authenticated nunca pueden autoasignarse rol.
  if session_user in ('postgres','service_role','supabase_admin') or v_jwt_role = 'service_role' then
    return jsonb_build_object(
      'authId', null,
      'usuario', coalesce(nullif(p_context->>'usuario',''), 'service'),
      'nombre', coalesce(nullif(p_context->>'nombre',''), 'Servicio Toscana'),
      'rol', coalesce(nullif(p_context->>'rol',''), 'admin'),
      'marcaId', p_context->'marcaId',
      'deviceId', nullif(p_context->>'deviceId',''),
      'clientVersion', nullif(p_context->>'clientVersion','')
    );
  end if;

  raise exception using
    errcode = '42501',
    message = 'Autenticación requerida para el motor transaccional';
end;
$$;

create or replace function public.th_require_roles(p_actor jsonb, p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not ((p_actor->>'rol') = any(p_roles)) then
    raise exception using
      errcode = '42501',
      message = format('Rol %s no autorizado para esta operación', coalesce(p_actor->>'rol','—'));
  end if;
end;
$$;

create or replace function public.th_payload_hash(p_payload jsonb)
returns text
language sql
immutable
as $$
  select encode(
    extensions.digest(coalesce(p_payload, '{}'::jsonb)::text, 'sha256'::text),
    'hex'
  );
$$;

create or replace function public.th_prepare_operation(
  p_operation_id uuid,
  p_tipo text,
  p_payload jsonb,
  p_actor jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := public.th_payload_hash(p_payload);
  v_op public.th_operaciones%rowtype;
  v_inserted integer := 0;
begin
  if p_operation_id is null then
    raise exception using errcode = '22023', message = 'operationId es obligatorio';
  end if;

  insert into public.th_operaciones(
    id, tipo, payload_hash, estado, usuario, auth_id, rol,
    device_id, client_version, engine, metadata
  ) values (
    p_operation_id, p_tipo, v_hash, 'procesando',
    p_actor->>'usuario', nullif(p_actor->>'authId','')::uuid, p_actor->>'rol',
    p_actor->>'deviceId', p_actor->>'clientVersion', 'transactional', coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_op
  from public.th_operaciones
  where id = p_operation_id
  for update;

  if v_op.tipo <> p_tipo or v_op.payload_hash <> v_hash then
    raise exception using
      errcode = '23505',
      message = 'La clave idempotente ya existe con un payload diferente';
  end if;

  if v_inserted = 0 then
    update public.th_operaciones
    set intentos = intentos + 1, updated_at = now()
    where id = p_operation_id;

    if v_op.estado in ('confirmada','rechazada') then
      return jsonb_build_object(
        'replay', true,
        'estado', v_op.estado,
        'resultado', coalesce(v_op.resultado, '{}'::jsonb)
      );
    end if;

    return jsonb_build_object(
      'replay', true,
      'estado', 'procesando',
      'resultado', jsonb_build_object(
        'ok', false,
        'code', 'OPERATION_IN_PROGRESS',
        'message', 'La operación todavía está siendo procesada'
      )
    );
  end if;

  return jsonb_build_object('replay', false, 'estado', 'procesando');
end;
$$;

create or replace function public.th_confirm_operation(p_operation_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.th_operaciones
  set estado = 'confirmada', resultado = p_result, error_code = null,
      error_message = null, completed_at = now(), updated_at = now()
  where id = p_operation_id;
  return p_result;
end;
$$;

create or replace function public.th_reject_operation(
  p_operation_id uuid,
  p_code text,
  p_message text,
  p_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb := jsonb_build_object(
    'ok', false,
    'operationId', p_operation_id,
    'code', coalesce(p_code, 'BUSINESS_ERROR'),
    'message', coalesce(p_message, 'Operación rechazada'),
    'detail', coalesce(p_detail, '{}'::jsonb)
  );
begin
  update public.th_operaciones
  set estado = 'rechazada', resultado = v_result,
      error_code = coalesce(p_code, 'BUSINESS_ERROR'),
      error_message = p_message, completed_at = now(), updated_at = now()
  where id = p_operation_id;
  return v_result;
end;
$$;

create or replace function public.th_append_audit(
  p_operation_id uuid,
  p_tipo text,
  p_actor jsonb,
  p_detalle jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_id text := 'EVT_' || replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.audit_log(
    id, ts, fecha, hora, tipo, usuario, nombre, rol, detalle,
    operation_id, auth_id, device_id, client_version, server_created_at
  ) values (
    v_id,
    floor(extract(epoch from v_now) * 1000)::bigint,
    to_char(v_now at time zone 'America/La_Paz', 'DD/MM/YYYY'),
    to_char(v_now at time zone 'America/La_Paz', 'HH24:MI:SS'),
    p_tipo, p_actor->>'usuario', p_actor->>'nombre', p_actor->>'rol',
    coalesce(p_detalle, '{}'::jsonb), p_operation_id,
    nullif(p_actor->>'authId','')::uuid, p_actor->>'deviceId',
    p_actor->>'clientVersion', v_now
  );
  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Venta: cabecera + líneas + Gift Card + stock + ledger + auditoría
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.th_registrar_venta(
  p_operation_id uuid,
  p_venta jsonb,
  p_items jsonb default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb := public.th_actor(p_context);
  v_payload jsonb := coalesce(p_venta, '{}'::jsonb) || jsonb_build_object('items', coalesce(p_items, p_venta->'items', '[]'::jsonb));
  v_prepared jsonb;
  v_items jsonb := coalesce(p_items, p_venta->'items', '[]'::jsonb);
  v_item jsonb;
  v_ord bigint;
  v_prod public.inventario%rowtype;
  v_prod_id bigint;
  v_qty integer;
  v_sale_id text;
  v_line_key text;
  v_stock_before integer;
  v_stock_after integer;
  v_gc public.gift_cards%rowtype;
  v_gc_used numeric := coalesce(nullif(p_venta->>'gcUsado','')::numeric, 0);
  v_result jsonb;
  v_sqlstate text;
  v_message text;
  v_detail text;
begin
  perform public.th_require_roles(v_actor, array['admin','caja']);
  v_prepared := public.th_prepare_operation(p_operation_id, 'VENTA', v_payload, v_actor, p_context);
  if (v_prepared->>'replay')::boolean then
    return v_prepared->'resultado';
  end if;

  begin
    if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
      raise exception using errcode = '22023', message = 'La venta debe tener al menos un ítem';
    end if;

    v_sale_id := coalesce(nullif(p_venta->>'id',''), 'V' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text);

    if v_gc_used > 0 then
      if nullif(p_venta->>'gcId','') is null then
        raise exception using errcode = '22023', message = 'Falta el código de Gift Card';
      end if;
      select * into v_gc
      from public.gift_cards
      where upper(btrim(codigo)) = upper(btrim(p_venta->>'gcId'))
      for update;
      if not found then
        raise exception using errcode = 'P0002', message = 'Gift Card no encontrada';
      end if;
      if v_gc.estado <> 'vigente' or (v_gc.vencimiento is not null and v_gc.vencimiento < current_date) then
        raise exception using errcode = 'P0001', message = 'Gift Card vencida o inactiva';
      end if;
      if v_gc.saldo < v_gc_used then
        raise exception using errcode = 'P0001', message = 'Saldo insuficiente en Gift Card';
      end if;
    end if;

    insert into public.ventas(
      id, fecha, hora, mk, mes, anio, total, subtotal, desc_pct,
      metodo_pago, vendedor, etiqueta_img, cliente_nombre, cliente_telefono,
      origen, canal, efectivo, qr, tarjeta, gc_id, gc_usado, gc_allocations,
      operation_id, engine, device_id, client_version, metadata, server_created_at
    ) values (
      v_sale_id,
      coalesce(nullif(p_venta->>'fecha',''), to_char(current_date, 'YYYY-MM-DD')),
      coalesce(nullif(p_venta->>'hora',''), to_char(clock_timestamp() at time zone 'America/La_Paz', 'HH24:MI')),
      p_venta->>'mk', nullif(p_venta->>'mes','')::integer, nullif(p_venta->>'anio','')::integer,
      coalesce(nullif(p_venta->>'total','')::numeric, 0),
      coalesce(nullif(p_venta->>'subtotal','')::numeric, 0),
      coalesce(nullif(p_venta->>'descPct','')::numeric, 0),
      p_venta->>'metodoPago', coalesce(nullif(p_venta->>'vendedor',''), v_actor->>'nombre'),
      nullif(p_venta->>'etiquetaImg',''), nullif(p_venta->>'clienteNombre',''),
      nullif(p_venta->>'clienteTelefono',''), nullif(p_venta->>'origen',''),
      nullif(p_venta->>'canal',''), nullif(p_venta->>'efectivo','')::numeric,
      nullif(p_venta->>'qr','')::numeric, nullif(p_venta->>'tarjeta','')::numeric,
      nullif(p_venta->>'gcId',''), nullif(p_venta->>'gcUsado','')::numeric,
      p_venta->'gcAllocations', p_operation_id, 'transactional',
      v_actor->>'deviceId', v_actor->>'clientVersion',
      p_venta - 'items' - 'etiquetaImg', clock_timestamp()
    );

    for v_item, v_ord in
      select value, ordinality
      from jsonb_array_elements(v_items) with ordinality
    loop
      v_qty := coalesce(nullif(v_item->>'cantidad','')::integer, 0);
      if v_qty <= 0 then
        raise exception using errcode = '22023', message = 'Cantidad de venta inválida';
      end if;

      v_prod_id := case
        when coalesce(v_item->>'prodId','') ~ '^[0-9]+$' then (v_item->>'prodId')::bigint
        else null
      end;

      select * into v_prod
      from public.inventario i
      where i.activo
        and ((v_prod_id is not null and i.id = v_prod_id)
          or upper(btrim(i.codigo)) = upper(btrim(v_item->>'codigo')))
      order by (i.id = v_prod_id) desc nulls last
      limit 1
      for update;

      if not found then
        raise exception using errcode = 'P0002', message = format('Producto %s no encontrado', coalesce(v_item->>'codigo','—'));
      end if;
      if v_prod.stock < v_qty then
        raise exception using
          errcode = 'P0001',
          message = format('Stock insuficiente para %s: solicitado %s, disponible %s', v_prod.codigo, v_qty, v_prod.stock);
      end if;

      v_line_key := coalesce(nullif(v_item->>'lineKey',''), p_operation_id::text || ':' || v_ord::text);
      insert into public.venta_items(
        venta_id, prod_id, codigo, nombre, marca_id, marca_nombre,
        cantidad, precio_unit, subtotal, desc_pct, line_key, metadata
      ) values (
        v_sale_id, v_prod.id, v_prod.codigo,
        coalesce(nullif(v_item->>'nombre',''), v_prod.nombre),
        coalesce(nullif(v_item->>'marcaId','')::integer, v_prod.marca_id),
        coalesce(nullif(v_item->>'marcaNombre',''), v_prod.marca_nombre),
        v_qty, coalesce(nullif(v_item->>'precioUnit','')::numeric, v_prod.precio),
        coalesce(nullif(v_item->>'subtotal','')::numeric, v_prod.precio * v_qty),
        coalesce(nullif(v_item->>'descPct','')::numeric, 0), v_line_key,
        v_item - 'lineKey'
      );

      v_stock_before := v_prod.stock;
      v_stock_after := v_stock_before - v_qty;
      update public.inventario
      set stock = v_stock_after, row_version = row_version + 1, updated_at = now()
      where id = v_prod.id;

      insert into public.movimientos_inventario(
        operation_id, line_key, producto_id, codigo, tipo, cantidad_delta,
        stock_antes, stock_despues, stock_inicial_antes, stock_inicial_despues,
        venta_id, motivo, usuario, auth_id, rol, device_id, client_version, metadata
      ) values (
        p_operation_id, 'VENTA:' || v_line_key, v_prod.id, v_prod.codigo, 'VENTA', -v_qty,
        v_stock_before, v_stock_after, v_prod.stock_inicial, v_prod.stock_inicial,
        v_sale_id, 'Venta ' || v_sale_id, v_actor->>'usuario',
        nullif(v_actor->>'authId','')::uuid, v_actor->>'rol', v_actor->>'deviceId',
        v_actor->>'clientVersion', jsonb_build_object('lineKey', v_line_key)
      );
    end loop;

    if v_gc_used > 0 then
      update public.gift_cards
      set saldo = saldo - v_gc_used,
          estado = case when saldo - v_gc_used <= 0 then 'agotada' else estado end,
          row_version = row_version + 1,
          updated_at = now()
      where id = v_gc.id;

      insert into public.gift_card_usos(
        gift_card_id, venta_id, operation_id, monto, saldo_antes, saldo_despues,
        nota, usuario
      ) values (
        v_gc.id, v_sale_id, p_operation_id, v_gc_used, v_gc.saldo,
        v_gc.saldo - v_gc_used, 'Venta POS', v_actor->>'usuario'
      );
    end if;

    perform public.th_append_audit(
      p_operation_id, 'VENTA', v_actor,
      jsonb_build_object(
        'resumen', format('Venta %s · Bs %s · %s ítem(s)', v_sale_id, p_venta->>'total', jsonb_array_length(v_items)),
        'ventaId', v_sale_id, 'total', p_venta->'total', 'items', v_items,
        'metodoPago', p_venta->'metodoPago', 'engine', 'transactional'
      )
    );

    v_result := jsonb_build_object(
      'ok', true,
      'operationId', p_operation_id,
      'ventaId', v_sale_id,
      'engine', 'transactional',
      'serverTime', clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
    return public.th_reject_operation(
      p_operation_id, v_sqlstate, v_message,
      jsonb_build_object('detail', coalesce(v_detail,''), 'tipo', 'VENTA')
    );
  end;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Anulación: marca venta + devuelve cada ítem + ledger + auditoría una sola vez
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.th_anular_venta(
  p_operation_id uuid,
  p_venta_id text,
  p_motivo text default '',
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb := public.th_actor(p_context);
  v_payload jsonb := jsonb_build_object('ventaId', p_venta_id, 'motivo', coalesce(p_motivo,''));
  v_prepared jsonb;
  v_sale public.ventas%rowtype;
  v_item public.venta_items%rowtype;
  v_prod public.inventario%rowtype;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor, array['admin','caja']);
  v_prepared := public.th_prepare_operation(p_operation_id, 'ANULACION', v_payload, v_actor, p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    select * into v_sale from public.ventas where id = p_venta_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Venta no encontrada'; end if;

    if v_sale.anulada then
      raise exception using errcode = 'P0001', message = 'La venta ya estaba anulada';
    end if;

    for v_item in select * from public.venta_items where venta_id = p_venta_id order by id loop
      if v_item.prod_id is null then continue; end if;
      select * into v_prod from public.inventario where id = v_item.prod_id for update;
      if not found then
        raise exception using errcode = 'P0002', message = format('Producto de línea %s no encontrado', v_item.id);
      end if;

      update public.inventario
      set stock = stock + v_item.cantidad, row_version = row_version + 1,
          updated_at = now(), activo = true
      where id = v_prod.id;

      insert into public.movimientos_inventario(
        operation_id, line_key, producto_id, codigo, tipo, cantidad_delta,
        stock_antes, stock_despues, stock_inicial_antes, stock_inicial_despues,
        venta_id, motivo, usuario, auth_id, rol, device_id, client_version, metadata
      ) values (
        p_operation_id, 'ANULACION:' || v_item.id::text, v_prod.id, v_prod.codigo, 'ANULACION', v_item.cantidad,
        v_prod.stock, v_prod.stock + v_item.cantidad,
        v_prod.stock_inicial, v_prod.stock_inicial, p_venta_id,
        coalesce(nullif(p_motivo,''), 'Anulación de venta'), v_actor->>'usuario',
        nullif(v_actor->>'authId','')::uuid, v_actor->>'rol', v_actor->>'deviceId',
        v_actor->>'clientVersion', jsonb_build_object('ventaItemId', v_item.id)
      );
    end loop;

    update public.ventas
    set anulada = true,
        fecha_anulacion = to_char(current_date, 'YYYY-MM-DD'),
        anulada_at = clock_timestamp(),
        anulada_por = v_actor->>'usuario',
        motivo_anulacion = nullif(p_motivo,'')
    where id = p_venta_id;

    perform public.th_append_audit(
      p_operation_id, 'ANULACION', v_actor,
      jsonb_build_object('ventaId', p_venta_id, 'motivo', p_motivo, 'total', v_sale.total, 'engine', 'transactional')
    );

    v_result := jsonb_build_object(
      'ok', true, 'operationId', p_operation_id, 'ventaId', p_venta_id,
      'anulada', true, 'engine', 'transactional', 'serverTime', clock_timestamp()
    );
    return public.th_confirm_operation(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    return public.th_reject_operation(p_operation_id, v_sqlstate, v_message, jsonb_build_object('ventaId',p_venta_id));
  end;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cambio: devolución y salida nuevas en la misma transacción
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.th_registrar_cambio(
  p_operation_id uuid,
  p_cambio jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb := public.th_actor(p_context);
  v_prepared jsonb;
  v_change_id text;
  v_item jsonb;
  v_ord bigint;
  v_prod public.inventario%rowtype;
  v_prod_id bigint;
  v_qty integer;
  v_price numeric;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  perform public.th_require_roles(v_actor, array['admin','caja']);
  v_prepared := public.th_prepare_operation(p_operation_id, 'CAMBIO', p_cambio, v_actor, p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    if not exists (
      select 1 from public.ventas
      where id = p_cambio->>'ventaOriginalId' and not anulada
    ) then
      raise exception using errcode = 'P0002', message = 'Venta original no encontrada o anulada';
    end if;

    v_change_id := coalesce(nullif(p_cambio->>'id',''), 'CAM' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text);
    insert into public.cambios(
      id, venta_original_id, fecha, hora, total_devuelto, total_nuevo,
      diferencia, metodo_pago, vendedor, notas, usuario, operation_id,
      engine, metadata
    ) values (
      v_change_id, p_cambio->>'ventaOriginalId',
      coalesce(nullif(p_cambio->>'fecha',''), to_char(current_date,'YYYY-MM-DD')),
      coalesce(nullif(p_cambio->>'hora',''), to_char(clock_timestamp() at time zone 'America/La_Paz','HH24:MI')),
      coalesce(nullif(p_cambio->>'totalDevuelto','')::numeric,0),
      coalesce(nullif(p_cambio->>'totalNuevo','')::numeric,0),
      coalesce(nullif(p_cambio->>'diferencia','')::numeric,0),
      p_cambio->>'metodoPago', p_cambio->>'vendedor', p_cambio->>'notas',
      v_actor->>'usuario', p_operation_id, 'transactional', p_cambio - 'itemsDevueltos' - 'itemsNuevos'
    );

    for v_item, v_ord in
      select value, ordinality from jsonb_array_elements(coalesce(p_cambio->'itemsDevueltos','[]'::jsonb)) with ordinality
    loop
      v_qty := coalesce(nullif(v_item->>'cantidad','')::integer,0);
      if v_qty <= 0 then raise exception using errcode='22023', message='Cantidad devuelta inválida'; end if;
      v_prod_id := nullif(v_item->>'prodId','')::bigint;
      select * into v_prod from public.inventario where id=v_prod_id for update;
      if not found then raise exception using errcode='P0002', message='Producto devuelto no encontrado'; end if;
      v_price := coalesce(nullif(v_item->>'precioUnit','')::numeric,v_prod.precio);

      insert into public.cambio_items(cambio_id,direccion,prod_id,codigo,nombre,marca_id,marca_nombre,cantidad,precio_unit,line_key,metadata)
      values(v_change_id,'ENTRADA',v_prod.id,v_prod.codigo,coalesce(v_item->>'nombre',v_prod.nombre),v_prod.marca_id,v_prod.marca_nombre,v_qty,v_price,p_operation_id::text||':IN:'||v_ord,v_item);

      update public.inventario set stock=stock+v_qty,row_version=row_version+1,updated_at=now(),activo=true where id=v_prod.id;
      insert into public.movimientos_inventario(
        operation_id,line_key,producto_id,codigo,tipo,cantidad_delta,stock_antes,stock_despues,
        stock_inicial_antes,stock_inicial_despues,cambio_id,motivo,usuario,auth_id,rol,device_id,client_version,metadata
      ) values(
        p_operation_id,'CAMBIO_ENTRADA:'||v_ord::text,v_prod.id,v_prod.codigo,'CAMBIO_ENTRADA',v_qty,v_prod.stock,v_prod.stock+v_qty,
        v_prod.stock_inicial,v_prod.stock_inicial,v_change_id,'Prenda devuelta',v_actor->>'usuario',
        nullif(v_actor->>'authId','')::uuid,v_actor->>'rol',v_actor->>'deviceId',v_actor->>'clientVersion',v_item
      );
    end loop;

    for v_item, v_ord in
      select value, ordinality from jsonb_array_elements(coalesce(p_cambio->'itemsNuevos','[]'::jsonb)) with ordinality
    loop
      v_qty := coalesce(nullif(v_item->>'cantidad','')::integer,0);
      if v_qty <= 0 then raise exception using errcode='22023', message='Cantidad nueva inválida'; end if;
      v_prod_id := nullif(v_item->>'prodId','')::bigint;
      select * into v_prod from public.inventario where id=v_prod_id and activo for update;
      if not found then raise exception using errcode='P0002', message='Producto nuevo no encontrado'; end if;
      if v_prod.stock < v_qty then raise exception using errcode='P0001', message=format('Stock insuficiente para %s',v_prod.codigo); end if;
      v_price := coalesce(nullif(v_item->>'precioUnit','')::numeric,v_prod.precio);

      insert into public.cambio_items(cambio_id,direccion,prod_id,codigo,nombre,marca_id,marca_nombre,cantidad,precio_unit,line_key,metadata)
      values(v_change_id,'SALIDA',v_prod.id,v_prod.codigo,coalesce(v_item->>'nombre',v_prod.nombre),v_prod.marca_id,v_prod.marca_nombre,v_qty,v_price,p_operation_id::text||':OUT:'||v_ord,v_item);

      update public.inventario set stock=stock-v_qty,row_version=row_version+1,updated_at=now() where id=v_prod.id;
      insert into public.movimientos_inventario(
        operation_id,line_key,producto_id,codigo,tipo,cantidad_delta,stock_antes,stock_despues,
        stock_inicial_antes,stock_inicial_despues,cambio_id,motivo,usuario,auth_id,rol,device_id,client_version,metadata
      ) values(
        p_operation_id,'CAMBIO_SALIDA:'||v_ord::text,v_prod.id,v_prod.codigo,'CAMBIO_SALIDA',-v_qty,v_prod.stock,v_prod.stock-v_qty,
        v_prod.stock_inicial,v_prod.stock_inicial,v_change_id,'Prenda entregada',v_actor->>'usuario',
        nullif(v_actor->>'authId','')::uuid,v_actor->>'rol',v_actor->>'deviceId',v_actor->>'clientVersion',v_item
      );
    end loop;

    perform public.th_append_audit(p_operation_id,'CAMBIO',v_actor,p_cambio||jsonb_build_object('cambioId',v_change_id,'engine','transactional'));
    v_result:=jsonb_build_object('ok',true,'operationId',p_operation_id,'cambioId',v_change_id,'engine','transactional','serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo','CAMBIO'));
  end;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Movimiento simple: retiro, baja, reposición, recepción y ajuste autorizado
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.th_aplicar_movimiento_simple(
  p_operation_id uuid,
  p_tipo text,
  p_data jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor jsonb:=public.th_actor(p_context);
  v_prepared jsonb;
  v_prod public.inventario%rowtype;
  v_prod_id bigint;
  v_qty integer;
  v_delta integer;
  v_target integer;
  v_initial_after integer;
  v_entity_id text;
  v_retiro_id text;
  v_baja_id text;
  v_auditoria_id text;
  v_result jsonb;
  v_sqlstate text;
  v_message text;
begin
  if p_tipo in ('RETIRO') then perform public.th_require_roles(v_actor,array['admin','caja']);
  else perform public.th_require_roles(v_actor,array['admin']); end if;
  if p_tipo not in ('RETIRO','BAJA','REPOSICION','RECEPCION','AJUSTE_AUDITORIA','CORRECCION_ADMIN') then
    raise exception using errcode='22023',message='Tipo de movimiento no permitido';
  end if;

  v_prepared:=public.th_prepare_operation(p_operation_id,p_tipo,p_data,v_actor,p_context);
  if (v_prepared->>'replay')::boolean then return v_prepared->'resultado'; end if;

  begin
    v_prod_id:=case when coalesce(p_data->>'prodId','')~'^[0-9]+$' then (p_data->>'prodId')::bigint else null end;
    select * into v_prod from public.inventario i
    where (v_prod_id is not null and i.id=v_prod_id)
       or upper(btrim(i.codigo))=upper(btrim(p_data->>'codigo'))
    order by (i.id=v_prod_id) desc nulls last limit 1 for update;
    if not found then raise exception using errcode='P0002',message='Producto no encontrado'; end if;

    if p_tipo in ('AJUSTE_AUDITORIA','CORRECCION_ADMIN') then
      v_target:=nullif(p_data->>'stockObjetivo','')::integer;
      if v_target is null or v_target<0 then raise exception using errcode='22023',message='Stock objetivo inválido'; end if;
      v_delta:=v_target-v_prod.stock;
      if v_delta=0 then raise exception using errcode='P0001',message='El producto ya tiene el stock objetivo'; end if;
    else
      v_qty:=coalesce(nullif(p_data->>'cantidad','')::integer,0);
      if v_qty<=0 then raise exception using errcode='22023',message='Cantidad inválida'; end if;
      v_delta:=case when p_tipo in ('REPOSICION','RECEPCION') then v_qty else -v_qty end;
    end if;

    if v_prod.stock+v_delta<0 then
      raise exception using errcode='P0001',message=format('Stock insuficiente para %s',v_prod.codigo);
    end if;
    v_initial_after:=v_prod.stock_inicial+case when p_tipo in ('REPOSICION','RECEPCION') then v_delta else 0 end;
    v_entity_id:=coalesce(nullif(p_data->>'id',''),p_tipo||'-'||replace(p_operation_id::text,'-',''));

    if p_tipo='RETIRO' then
      v_retiro_id:=v_entity_id;
      insert into public.retiros(id,fecha,hora,prod_id,codigo,nombre,marca_id,marca_nombre,cantidad,destinatario,motivo,operation_id,usuario,device_id,metadata)
      values(v_retiro_id,coalesce(p_data->>'fecha',to_char(current_date,'YYYY-MM-DD')),coalesce(p_data->>'hora',to_char(clock_timestamp() at time zone 'America/La_Paz','HH24:MI')),v_prod.id,v_prod.codigo,v_prod.nombre,v_prod.marca_id,v_prod.marca_nombre,-v_delta,p_data->>'destinatario',p_data->>'motivo',p_operation_id,v_actor->>'usuario',v_actor->>'deviceId',p_data);
    elsif p_tipo='BAJA' then
      v_baja_id:=v_entity_id;
      insert into public.bajas_inventario(id,prod_id,codigo,cantidad,motivo,usuario,operation_id,metadata)
      values(v_baja_id,v_prod.id,v_prod.codigo,-v_delta,p_data->>'motivo',v_actor->>'usuario',p_operation_id,p_data);
    elsif p_tipo='AJUSTE_AUDITORIA' then
      v_auditoria_id:=nullif(p_data->>'auditoriaId','');
    end if;

    update public.inventario set stock=stock+v_delta,stock_inicial=v_initial_after,row_version=row_version+1,updated_at=now(),activo=true where id=v_prod.id;
    insert into public.movimientos_inventario(
      operation_id,line_key,producto_id,codigo,tipo,cantidad_delta,stock_antes,stock_despues,
      stock_inicial_antes,stock_inicial_despues,retiro_id,baja_id,auditoria_id,motivo,
      usuario,auth_id,rol,device_id,client_version,metadata
    ) values(
      p_operation_id,p_tipo||':'||v_prod.id::text,v_prod.id,v_prod.codigo,p_tipo,v_delta,v_prod.stock,v_prod.stock+v_delta,
      v_prod.stock_inicial,v_initial_after,v_retiro_id,v_baja_id,v_auditoria_id,p_data->>'motivo',
      v_actor->>'usuario',nullif(v_actor->>'authId','')::uuid,v_actor->>'rol',v_actor->>'deviceId',v_actor->>'clientVersion',p_data
    );
    perform public.th_append_audit(p_operation_id,p_tipo,v_actor,jsonb_build_object('codigo',v_prod.codigo,'cantidadDelta',v_delta,'stockAntes',v_prod.stock,'stockDespues',v_prod.stock+v_delta,'motivo',p_data->>'motivo','engine','transactional'));
    v_result:=jsonb_build_object('ok',true,'operationId',p_operation_id,'tipo',p_tipo,'productoId',v_prod.id,'codigo',v_prod.codigo,'stockAntes',v_prod.stock,'stockDespues',v_prod.stock+v_delta,'stockInicial',v_initial_after,'entityId',v_entity_id,'engine','transactional','serverTime',clock_timestamp());
    return public.th_confirm_operation(p_operation_id,v_result);
  exception when others then
    get stacked diagnostics v_sqlstate=returned_sqlstate,v_message=message_text;
    return public.th_reject_operation(p_operation_id,v_sqlstate,v_message,jsonb_build_object('tipo',p_tipo));
  end;
end;
$$;

create or replace function public.th_registrar_retiro(p_operation_id uuid,p_data jsonb,p_context jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public.th_aplicar_movimiento_simple(p_operation_id,'RETIRO',p_data,p_context);
$$;
create or replace function public.th_registrar_baja(p_operation_id uuid,p_data jsonb,p_context jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public.th_aplicar_movimiento_simple(p_operation_id,'BAJA',p_data,p_context);
$$;
create or replace function public.th_registrar_reposicion(p_operation_id uuid,p_data jsonb,p_context jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public.th_aplicar_movimiento_simple(p_operation_id,'REPOSICION',p_data,p_context);
$$;
create or replace function public.th_registrar_recepcion(p_operation_id uuid,p_data jsonb,p_context jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public.th_aplicar_movimiento_simple(p_operation_id,'RECEPCION',p_data,p_context);
$$;
create or replace function public.th_ajustar_inventario(p_operation_id uuid,p_data jsonb,p_context jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path=public as $$
  select public.th_aplicar_movimiento_simple(p_operation_id,'AJUSTE_AUDITORIA',p_data,p_context);
$$;

-- Helpers internos no deben poder invocarse directamente desde anon/authenticated.
revoke all on function public.th_actor(jsonb) from public, anon, authenticated;
revoke all on function public.th_require_roles(jsonb,text[]) from public, anon, authenticated;
revoke all on function public.th_prepare_operation(uuid,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.th_confirm_operation(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.th_reject_operation(uuid,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.th_append_audit(uuid,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.th_aplicar_movimiento_simple(uuid,text,jsonb,jsonb) from public, anon, authenticated;

-- RPC públicas únicamente para usuarios autenticados. th_actor verifica perfil/rol.
revoke all on function public.th_registrar_venta(uuid,jsonb,jsonb,jsonb) from public, anon;
revoke all on function public.th_anular_venta(uuid,text,text,jsonb) from public, anon;
revoke all on function public.th_registrar_cambio(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.th_registrar_retiro(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.th_registrar_baja(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.th_registrar_reposicion(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.th_registrar_recepcion(uuid,jsonb,jsonb) from public, anon;
revoke all on function public.th_ajustar_inventario(uuid,jsonb,jsonb) from public, anon;

grant execute on function public.th_registrar_venta(uuid,jsonb,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.th_anular_venta(uuid,text,text,jsonb) to authenticated, service_role;
grant execute on function public.th_registrar_cambio(uuid,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.th_registrar_retiro(uuid,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.th_registrar_baja(uuid,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.th_registrar_reposicion(uuid,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.th_registrar_recepcion(uuid,jsonb,jsonb) to authenticated, service_role;
grant execute on function public.th_ajustar_inventario(uuid,jsonb,jsonb) to authenticated, service_role;

commit;
