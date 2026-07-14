-- Prueba de integración: venta, idempotencia, sobreventa y anulación.
-- No conserva datos.

begin;

do $$
declare
  v_product_id bigint;
  v_sale_op uuid:=gen_random_uuid();
  v_reject_op uuid:=gen_random_uuid();
  v_annul_op uuid:=gen_random_uuid();
  v_sale_id text:='TEST-SALE-'||replace(gen_random_uuid()::text,'-','');
  v_code text:='TEST-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_payload jsonb;
  v_items jsonb;
  v_result jsonb;
  v_stock integer;
  v_count integer;
  v_ctx jsonb:='{"usuario":"test-admin","nombre":"Test Admin","rol":"admin","deviceId":"sql-test","clientVersion":"test"}'::jsonb;
begin
  insert into public.inventario(codigo,marca_id,marca_nombre,nombre,categoria,precio,stock,stock_inicial,fecha)
  values(v_code,9999,'TEST','Producto transaccional','TEST',100,5,5,to_char(current_date,'YYYY-MM-DD'))
  returning id into v_product_id;

  v_payload:=jsonb_build_object(
    'id',v_sale_id,'fecha',to_char(current_date,'YYYY-MM-DD'),'hora','12:00',
    'mk','9999-'||extract(year from current_date)::text||'-'||extract(month from current_date)::text,
    'mes',extract(month from current_date)::integer,'anio',extract(year from current_date)::integer,
    'total',200,'subtotal',200,'descPct',0,'metodoPago','Efectivo','vendedor','Test Admin'
  );
  v_items:=jsonb_build_array(jsonb_build_object(
    'prodId',v_product_id,'codigo',v_code,'nombre','Producto transaccional','marcaId',9999,
    'marcaNombre','TEST','cantidad',2,'precioUnit',100,'subtotal',200,'lineKey','line-1'
  ));

  v_result:=public.th_registrar_venta(v_sale_op,v_payload,v_items,v_ctx);
  if not coalesce((v_result->>'ok')::boolean,false) then
    raise exception 'Venta de prueba rechazada: %',v_result;
  end if;
  select stock into v_stock from public.inventario where id=v_product_id;
  if v_stock<>3 then raise exception 'Stock esperado 3, obtenido %',v_stock; end if;

  -- Mismo operationId y payload: devuelve el mismo resultado sin volver a descontar.
  v_result:=public.th_registrar_venta(v_sale_op,v_payload,v_items,v_ctx);
  select stock into v_stock from public.inventario where id=v_product_id;
  select count(*) into v_count from public.venta_items where venta_id=v_sale_id;
  if v_stock<>3 or v_count<>1 then
    raise exception 'Reintento duplicó efectos: stock %, líneas %',v_stock,v_count;
  end if;

  -- Sobreventa: toda la operación debe rechazarse sin cabecera, línea ni movimiento parcial.
  v_result:=public.th_registrar_venta(
    v_reject_op,
    v_payload||jsonb_build_object('id',v_sale_id||'-REJECT'),
    jsonb_build_array(jsonb_build_object('prodId',v_product_id,'codigo',v_code,'cantidad',99,'precioUnit',100,'subtotal',9900)),
    v_ctx
  );
  if coalesce((v_result->>'ok')::boolean,false) then raise exception 'La sobreventa fue aceptada'; end if;
  select stock into v_stock from public.inventario where id=v_product_id;
  if v_stock<>3 then raise exception 'La sobreventa alteró stock: %',v_stock; end if;
  if exists(select 1 from public.ventas where id=v_sale_id||'-REJECT') then
    raise exception 'La sobreventa dejó una cabecera parcial';
  end if;
  if exists(select 1 from public.movimientos_inventario where operation_id=v_reject_op) then
    raise exception 'La sobreventa dejó movimientos parciales';
  end if;

  v_result:=public.th_anular_venta(v_annul_op,v_sale_id,'Prueba de reversión',v_ctx);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Anulación rechazada: %',v_result; end if;
  select stock into v_stock from public.inventario where id=v_product_id;
  if v_stock<>5 then raise exception 'La anulación no restauró stock: %',v_stock; end if;

  -- Reintento de la misma anulación no vuelve a incrementar stock.
  v_result:=public.th_anular_venta(v_annul_op,v_sale_id,'Prueba de reversión',v_ctx);
  select stock into v_stock from public.inventario where id=v_product_id;
  if v_stock<>5 then raise exception 'Reintento de anulación duplicó stock: %',v_stock; end if;

  raise notice 'PASS 001_transactional_sale_test';
end $$;

rollback;
