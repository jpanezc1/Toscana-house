-- GATE MANUAL para estados operativos. No ejecutar como migración automática.
-- Requiere staging aprobado, outbox vacío y los flags listados en transactional.

begin;

do $$
declare
  v_operacion text;
  v_operaciones text[]:=array[
    'CIERRE_MENSUAL','VERIFICAR_CARGA','AUDITORIA_INVENTARIO','CONFIG_MARCAS',
    'DESCUENTO_MARCA','DESCUENTO_CODIGO','IMPORTACION','RECEPCION','REVERSO_CARGA',
    'LIQUIDACION_CONFIG','LIQUIDACION_GASTOS','ALQUILER_ESTADO','CAJA_TURNO'
  ];
begin
  if exists(select 1 from public.usuarios where estado='activo' and auth_id is null) then
    raise exception 'No se puede activar RLS operativo: hay usuarios activos sin auth_id';
  end if;
  foreach v_operacion in array v_operaciones loop
    if public.th_resolver_feature_flag('production',v_operacion,'__rls_gate__','__rls_gate__')<>'transactional' then
      raise exception 'No se puede activar RLS operativo: % no está en transactional para toda producción',v_operacion;
    end if;
  end loop;
end $$;

alter table public.cierres enable row level security;
alter table public.cargas_inventario enable row level security;
alter table public.auditorias_inventario enable row level security;
alter table public.marcas enable row level security;
alter table public.config_descuentos enable row level security;
alter table public.descuentos_codigo enable row level security;
alter table public.th_verif_sesion enable row level security;

grant select on public.cierres,public.cargas_inventario,public.auditorias_inventario,
  public.marcas,public.config_descuentos,public.descuentos_codigo,public.th_verif_sesion to authenticated;
revoke insert,update,delete on public.cierres,public.cargas_inventario,public.auditorias_inventario,
  public.marcas,public.config_descuentos,public.descuentos_codigo,public.th_verif_sesion from authenticated;
revoke all on public.cierres,public.cargas_inventario,public.auditorias_inventario,
  public.marcas,public.config_descuentos,public.descuentos_codigo,public.th_verif_sesion from anon;

-- Eliminar políticas abiertas de la versión legacy antes de crear las de rol.
drop policy if exists public_all on public.cierres;
drop policy if exists "allow all cargas_inventario" on public.cargas_inventario;
drop policy if exists "allow all auditorias_inventario" on public.auditorias_inventario;
drop policy if exists marcas_anon_all on public.marcas;
drop policy if exists config_descuentos_todo on public.config_descuentos;
drop policy if exists descuentos_codigo_todo on public.descuentos_codigo;
drop policy if exists "allow all th_verif_sesion" on public.th_verif_sesion;
drop policy if exists th_verif_sesion_all on public.th_verif_sesion;

drop policy if exists cierres_lectura_operativa on public.cierres;
create policy cierres_lectura_operativa on public.cierres for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol in ('admin','caja') or (p.rol='marca' and p.marca_id=cierres.marca_id)));

drop policy if exists cargas_lectura_operativa on public.cargas_inventario;
create policy cargas_lectura_operativa on public.cargas_inventario for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol='admin' or (p.rol='marca' and p.marca_id=cargas_inventario.marca_id)));

drop policy if exists auditorias_lectura_operativa on public.auditorias_inventario;
create policy auditorias_lectura_operativa on public.auditorias_inventario for select to authenticated
using (exists(select 1 from public.th_current_profile() p
  where p.rol='admin' or (p.rol='marca' and p.marca_id=auditorias_inventario.marca_id)));

drop policy if exists marcas_lectura on public.marcas;
create policy marcas_lectura on public.marcas for select to authenticated
using (exists(select 1 from public.th_current_profile()));

drop policy if exists descuentos_marca_lectura on public.config_descuentos;
create policy descuentos_marca_lectura on public.config_descuentos for select to authenticated
using (exists(select 1 from public.th_current_profile()));

drop policy if exists descuentos_codigo_lectura on public.descuentos_codigo;
create policy descuentos_codigo_lectura on public.descuentos_codigo for select to authenticated
using (exists(select 1 from public.th_current_profile()));

drop policy if exists th_verif_sesion_lectura_admin on public.th_verif_sesion;
create policy th_verif_sesion_lectura_admin on public.th_verif_sesion for select to authenticated
using (exists(select 1 from public.th_current_profile() p where p.rol='admin'));

commit;
