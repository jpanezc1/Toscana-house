-- Kill switch operativo: vuelve a legacy y reabre únicamente las tablas que el motor legacy necesita.
begin;
insert into public.th_feature_flags(ambiente,operacion,usuario,device_id,modo,enabled,updated_by,updated_at,metadata)
values('production','*','*','*','legacy',true,'emergency-rollback',now(),jsonb_build_object('reason','emergency kill switch'))
on conflict (ambiente,operacion,usuario,device_id) do update set
  modo='legacy',enabled=true,updated_by='emergency-rollback',updated_at=now(),metadata=excluded.metadata;

-- Si el gate RLS ya fue activado, cambiar sólo el flag dejaría la app sin escritura.
-- No se toca usuarios ni las entidades nuevas: conservan su protección.
alter table public.inventario disable row level security;
alter table public.ventas disable row level security;
alter table public.venta_items disable row level security;
alter table public.retiros disable row level security;
alter table public.cierres disable row level security;
alter table public.cargas_inventario disable row level security;
alter table public.auditorias_inventario disable row level security;
alter table public.marcas disable row level security;
alter table public.config_descuentos disable row level security;
alter table public.descuentos_codigo disable row level security;
alter table public.audit_log disable row level security;
alter table public.th_verif_sesion disable row level security;
grant select,insert,update,delete on public.inventario,public.ventas,public.venta_items,public.retiros,
  public.cierres,public.cargas_inventario,public.auditorias_inventario,public.marcas,
  public.config_descuentos,public.descuentos_codigo,public.audit_log,public.th_verif_sesion to authenticated;
commit;

select public.th_resolver_feature_flag('production','*','*','*') as production_mode;
