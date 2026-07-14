-- Toscana House — precheck de migración aditiva
-- Solo lectura. Es seguro tanto sobre producción existente como sobre una
-- instalación vacía de staging; los hallazgos se emiten como NOTICE.

begin;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

do $$
declare
  r record;
begin
  if to_regclass('public.inventario') is null then
    raise notice 'precheck: public.inventario todavía no existe (bootstrap limpio)';
  else
    for r in execute $sql$
      select check_name, affected from (
        select 'inventario_id_nulo'::text as check_name, count(*)::bigint as affected
        from public.inventario where id is null
        union all
        select 'inventario_codigo_vacio', count(*)::bigint
        from public.inventario where nullif(btrim(codigo), '') is null
        union all
        select 'inventario_stock_negativo', count(*)::bigint
        from public.inventario where stock < 0
        union all
        select 'inventario_stock_inicial_negativo', count(*)::bigint
        from public.inventario where stock_inicial < 0
        union all
        select 'inventario_precio_negativo', count(*)::bigint
        from public.inventario where precio < 0
      ) q
    $sql$ loop
      raise notice 'precheck: % = %', r.check_name, r.affected;
    end loop;

    for r in execute $sql$
      select upper(btrim(codigo)) as codigo_normalizado,
             count(*)::bigint as repeticiones,
             array_agg(id order by id) as ids
      from public.inventario
      where nullif(btrim(codigo), '') is not null
      group by upper(btrim(codigo))
      having count(*) > 1
    $sql$ loop
      raise notice 'precheck: código duplicado %, repeticiones %, ids %',
        r.codigo_normalizado, r.repeticiones, r.ids;
    end loop;
  end if;

  if to_regclass('public.ventas') is null or to_regclass('public.venta_items') is null then
    raise notice 'precheck: ventas/venta_items todavía no existen (bootstrap limpio)';
  else
    for r in execute $sql$
      select check_name, affected from (
        select 'venta_items_sin_venta'::text as check_name, count(*)::bigint as affected
        from public.venta_items vi
        left join public.ventas v on v.id = vi.venta_id
        where v.id is null
        union all
        select 'venta_items_cantidad_invalida', count(*)::bigint
        from public.venta_items where cantidad is null or cantidad <= 0
        union all
        select 'venta_items_precio_negativo', count(*)::bigint
        from public.venta_items where precio_unit < 0
        union all
        select 'ventas_total_negativo', count(*)::bigint
        from public.ventas where total < 0
      ) q
    $sql$ loop
      raise notice 'precheck: % = %', r.check_name, r.affected;
    end loop;

    for r in execute $sql$
      select venta_id, prod_id, codigo, cantidad, precio_unit, subtotal,
             count(*)::bigint as repeticiones,
             array_agg(id order by id) as ids
      from public.venta_items
      group by venta_id, prod_id, codigo, cantidad, precio_unit, subtotal
      having count(*) > 1
    $sql$ loop
      raise notice 'precheck: línea duplicada venta %, producto %, repeticiones %, ids %',
        r.venta_id, r.prod_id, r.repeticiones, r.ids;
    end loop;

    for r in execute $sql$
      select v.id, v.fecha, v.total, count(vi.id)::bigint as lineas
      from public.ventas v
      left join public.venta_items vi on vi.venta_id = v.id
      group by v.id, v.fecha, v.total
      having count(vi.id) = 0
    $sql$ loop
      raise notice 'precheck: venta sin líneas %, fecha %, total %', r.id, r.fecha, r.total;
    end loop;
  end if;
end $$;

with required_tables(name) as (
  values
    ('inventario'), ('ventas'), ('venta_items'), ('cierres'), ('retiros'),
    ('cargas_inventario'), ('auditorias_inventario'), ('usuarios'), ('marcas'),
    ('config_descuentos'), ('descuentos_codigo'), ('audit_log'), ('th_verif_sesion')
)
select name as table_name,
       to_regclass('public.' || name) is not null as exists
from required_tables
order by name;

rollback;
