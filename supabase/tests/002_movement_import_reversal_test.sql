-- Prueba de integración: baja, reposición, importación y reverso compensatorio.
-- No conserva datos.

begin;

do $$
declare
  v_product_id bigint;
  v_code text:='TEST-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_import_code text:='IMP-'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_carga_id text:='TEST-LOAD-'||replace(gen_random_uuid()::text,'-','');
  v_op uuid;
  v_result jsonb;
  v_stock integer;
  v_active boolean;
  v_ctx jsonb:='{"usuario":"test-admin","nombre":"Test Admin","rol":"admin","deviceId":"sql-test","clientVersion":"test"}'::jsonb;
begin
  insert into public.inventario(codigo,marca_id,marca_nombre,nombre,categoria,precio,stock,stock_inicial,fecha)
  values(v_code,9999,'TEST','Producto movimiento','TEST',100,10,10,to_char(current_date,'YYYY-MM-DD'))
  returning id into v_product_id;

  v_op:=gen_random_uuid();
  v_result:=public.th_registrar_baja(v_op,jsonb_build_object(
    'prodId',v_product_id,'cantidad',2,'motivo','Prueba controlada'
  ),v_ctx);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Baja rechazada: %',v_result; end if;

  v_op:=gen_random_uuid();
  v_result:=public.th_registrar_reposicion(v_op,jsonb_build_object(
    'prodId',v_product_id,'cantidad',3,'motivo','Prueba controlada'
  ),v_ctx);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Reposición rechazada: %',v_result; end if;
  select stock into v_stock from public.inventario where id=v_product_id;
  if v_stock<>11 then raise exception 'Stock de movimientos esperado 11, obtenido %',v_stock; end if;

  v_op:=gen_random_uuid();
  v_result:=public.th_registrar_importacion(v_op,jsonb_build_object(
    'id',v_carga_id,'tipo','TEST','resumen','Carga de prueba',
    'items',jsonb_build_array(jsonb_build_object(
      'codigo',v_import_code,'stockSumado',4,
      'producto',jsonb_build_object('codigo',v_import_code,'marcaId',9999,'marcaNombre','TEST',
        'nombre','Producto importado','categoria','TEST','precio',50,'stock',4)
    ))
  ),v_ctx);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Importación rechazada: %',v_result; end if;
  select stock into v_stock from public.inventario where codigo=v_import_code;
  if v_stock<>4 then raise exception 'Importación esperaba stock 4, obtuvo %',v_stock; end if;

  v_op:=gen_random_uuid();
  v_result:=public.th_revertir_carga(v_op,v_carga_id,'Prueba de reverso',v_ctx);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'Reverso rechazado: %',v_result; end if;
  select stock,activo into v_stock,v_active from public.inventario where codigo=v_import_code;
  if v_stock<>0 or v_active then
    raise exception 'Reverso de producto creado esperaba stock 0/inactivo, obtuvo %/%',v_stock,v_active;
  end if;

  raise notice 'PASS 002_movement_import_reversal_test';
end $$;

rollback;
