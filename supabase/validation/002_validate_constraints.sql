-- GATE MANUAL. Ejecutar únicamente cuando 001_post_migration_checks no reporte datos incompatibles.
begin;
set local statement_timeout='180s';
set local lock_timeout='5s';

alter table public.inventario validate constraint inventario_stock_no_negativo_chk;
alter table public.inventario validate constraint inventario_codigo_no_vacio_chk;
alter table public.venta_items validate constraint venta_items_cantidad_positiva_chk;
alter table public.retiros validate constraint retiros_cantidad_positiva_chk;
alter table public.bajas_inventario validate constraint bajas_cantidad_positiva_chk;
alter table public.gift_cards validate constraint gift_cards_saldo_valido_chk;
alter table public.config_descuentos validate constraint descuentos_pct_valido_chk;
alter table public.descuentos_codigo validate constraint descuentos_codigo_pct_valido_chk;
alter table public.cambio_items validate constraint cambio_items_direccion_chk;

commit;
