-- Toscana House — idempotencia para emisión/anulación de facturas vía Edge Function.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

alter table public.facturas_venta add column if not exists provider_invoice_id text;

create unique index if not exists facturas_venta_operation_uidx
  on public.facturas_venta(operation_id)
  where operation_id is not null;

commit;
