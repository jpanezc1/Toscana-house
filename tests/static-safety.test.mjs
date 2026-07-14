import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const app=fs.readFileSync(path.join(root,"App.jsx"),"utf8");
const migrations=fs.readdirSync(path.join(root,"supabase","migrations"))
  .filter(name=>name.endsWith(".sql")).sort()
  .map(name=>fs.readFileSync(path.join(root,"supabase","migrations",name),"utf8"))
  .join("\n");
const cucuEdge=fs.readFileSync(path.join(root,"supabase","functions","cucu-facturacion","index.ts"),"utf8");
const adminEdge=fs.readFileSync(path.join(root,"supabase","functions","admin-usuario","index.ts"),"utf8");
const createUserEdge=fs.readFileSync(path.join(root,"supabase","functions","crear-usuario","index.ts"),"utf8");
const operationalRls=fs.readFileSync(path.join(root,"supabase","rls","activate_operational_rls.sql"),"utf8");
const privateStorageMigration=fs.readFileSync(path.join(root,"supabase","migrations","021_private_storage_buckets.sql"),"utf8");
const activatePrivateStorage=fs.readFileSync(path.join(root,"supabase","migrations","022_activate_private_storage.sql"),"utf8");
const storagePolicyCleanup=fs.readFileSync(path.join(root,"supabase","migrations","023_storage_policy_cleanup.sql"),"utf8");

test("el bundle no contiene credenciales legacy ni fallback local",()=>{
  assert.doesNotMatch(app,/casa2024|toscana2024|const\s+FALLBACK\s*=/i);
  assert.doesNotMatch(app,/from\("usuarios"\)\.select\("[^"]*password/i);
  assert.doesNotMatch(app,/from\("usuarios"\)\.update\(\{\s*password/i);
});

test("las ventas esperan confirmación y conservan idempotencia",()=>{
  assert.match(app,/const\s+vf=await\s+onVenta\(\{\.\.\.ventaData,\.\.\.op\}\)/);
  assert.match(app,/line_key:\s*it\.lineKey\|\|`\$\{venta\.operationId\|\|venta\.id\}:\$\{idx\+1\}`/);
  assert.match(app,/upsert\(items,\{onConflict:"venta_id,line_key"\}\)/);
  assert.match(app,/No se vació el carrito/);
});

test("cada salida crítica tiene ruta RPC transaccional",()=>{
  for(const rpc of [
    "th_registrar_venta","th_anular_venta","th_registrar_cambio","th_registrar_retiro",
    "th_registrar_baja","th_registrar_reposicion","th_registrar_importacion",
    "th_revertir_carga","th_ajustar_inventario_batch","th_editar_producto",
    "th_desactivar_producto","th_importar_ventas_libres",
    "th_crear_gift_card","th_canjear_gift_card","th_importar_gift_cards",
    "th_guardar_estado_operativo","th_registrar_evento_cliente",
    "th_incrementar_conteo_verificacion","th_reiniciar_sesion_verificacion",
    "th_guardar_configuracion_financiera",
    "th_cambiar_turno_caja",
  ]) assert.match(app,new RegExp(`\\b${rpc}\\b`),`falta adaptador ${rpc}`);
});

test("los turnos de caja tienen exclusión, idempotencia y auditoría",()=>{
  assert.match(migrations,/caja_turnos_un_abierto_uidx/i);
  assert.match(migrations,/th_prepare_operation\(p_operation_id,'CAJA_'\|\|v_accion/i);
  assert.match(migrations,/CAJA_'\|\|v_accion,v_actor/i);
  assert.match(operationalRls,/CAJA_TURNO/);
});

test("Gift Cards bloquean doble gasto y migran la fuente local",()=>{
  assert.match(migrations,/from public\.gift_cards[\s\S]*for update;/i);
  assert.match(migrations,/th_prepare_operation\(p_operation_id,'CANJEAR_GIFT_CARD'/i);
  assert.match(app,/GIFT_CARD_ADMIN/);
  assert.match(app,/th_gc_import_operation_v1/);
  assert.match(app,/sbBuscarGiftCardCloud\(gcCodigo\)/);
});

test("las rutas masivas del navegador están neutralizadas",()=>{
  assert.doesNotMatch(app,/method:\s*"DELETE"[\s\S]{0,500}venta_items/i);
  assert.match(app,/Factory Reset bloqueado por seguridad/);
  assert.match(app,/RECUPERACION_INVENTARIO/);
});

test("las actualizaciones conservan operaciones de caja",()=>{
  assert.match(app,/hayTrabajoProtegido\(\)/);
  assert.match(app,/th_pos_draft/);
  assert.match(app,/Actualización pendiente/);
});

test("las pruebas técnicas no contaminan reportes operativos",()=>{
  assert.match(app,/function thEsVentaTecnica\(venta\)/);
  assert.match(app,/metadata\.excludeFromReports===true/);
  assert.match(app,/origen==="PRUEBA_CANARIO"/);
  assert.match(app,/id\.startsWith\("TEST_CANARY_"\)/);
  assert.match(app,/ventasCompletas[\s\S]{0,1800}\.filter\(v=>!thEsVentaTecnica\(v\)\)/);
  assert.match(app,/localStorage\.getItem\("th_ventas"\)[\s\S]{0,120}\.filter\(v=>!thEsVentaTecnica\(v\)\)/);
});

test("producción nace en legacy y tiene kill switch",()=>{
  assert.match(migrations,/\('production',\s*'\*',\s*'\*',\s*'\*',\s*'legacy'/);
  const rollback=fs.readFileSync(path.join(root,"supabase","rollback","001_emergency_legacy_mode.sql"),"utf8");
  assert.match(rollback,/modo='legacy'/);
});

test("el ledger es inmutable y valida su ecuación",()=>{
  assert.match(migrations,/before update or delete on public\.movimientos_inventario/i);
  assert.match(migrations,/stock_antes \+ cantidad_delta = stock_despues/);
  assert.match(migrations,/unique index if not exists movimientos_operation_line_uidx/);
});

test("el conteo físico es atómico y no escribe la sesión directamente",()=>{
  assert.match(migrations,/create table if not exists public\.th_verif_movimientos/i);
  assert.match(migrations,/before update or delete on public\.th_verif_movimientos/i);
  assert.match(migrations,/from public\.th_verif_sesion where id=p_id for update/i);
  assert.doesNotMatch(app,/from\("th_verif_sesion"\)\.upsert/);
  assert.doesNotMatch(app,/from\("th_verif_sesion"\)\.update/);
});

test("las configuraciones financieras quedan compartidas y el cierre congela cifras",()=>{
  assert.match(migrations,/create table if not exists public\.liquidacion_config/i);
  assert.match(migrations,/create table if not exists public\.liquidacion_periodos/i);
  assert.match(migrations,/FINANZAS_'\|\|v_tipo/i);
  assert.match(app,/ventasIds:liq\.vMarca\.map\(v=>v\.id\)/);
  assert.match(app,/thEsperarFinanzasPendientes\(\)/);
  assert.match(app,/desdeSnapshot:true/);
  for(const flag of ["LIQUIDACION_CONFIG","LIQUIDACION_GASTOS","ALQUILER_ESTADO"])
    assert.match(operationalRls,new RegExp(flag));
});

test("CUCU usa contrato oficial y nunca expone la clave en el navegador",()=>{
  assert.doesNotMatch(app,/cfg\.apiKey|Authorization\s*:\s*`Bearer \$\{cfg\.apiKey/i);
  assert.match(cucuEdge,/"X-API-Key":apiKey/);
  assert.match(cucuEdge,/pointOfSaleId/);
  assert.match(cucuEdge,/\/cancel\?motivo=/);
  assert.match(cucuEdge,/INVOICE_REVIEW_REQUIRED/);
  assert.match(cucuEdge,/\["emitida","anulada"\]\.includes\(fac\.estado\)/);
  assert.match(cucuEdge,/estado:"anulacion_procesando"/);
  assert.match(cucuEdge,/estado:"revision_anulacion"/);
  assert.doesNotMatch(cucuEdge,/response\.status!==404/);
});

test("el arranque no reinyecta ventas, retiros, auditorías ni usuarios locales",()=>{
  assert.doesNotMatch(app,/pendientes\.forEach\(v=>sbGuardarVenta/);
  assert.doesNotMatch(app,/pendientes\.forEach\(r=>sbGuardarRetiro/);
  assert.doesNotMatch(app,/pendientes\.forEach\(e=>syncConRespaldo\("auditLog"/);
  assert.doesNotMatch(app,/sbUsers\.length===0[\s\S]{0,200}sbGuardarUsuarios/);
  assert.match(app,/\["password","usuarios"\]\.includes\(op\?\.tipo\)/);
});

test("el outbox legacy no atraviesa un flag transaccional",()=>{
  assert.match(app,/TH_OUTBOX_OPERATION_MAP/);
  assert.match(app,/bloqueadaPorModoSeguro=bloqueo/);
  assert.match(app,/sbResolverModoOperacion\(operacion,user\|\|\{\}\)===\"transactional\"/);
  assert.match(app,/default: return false; \/\/ nunca descartar una operación desconocida/);
});

test("las mutaciones administrativas tienen idempotencia y estado de revisión",()=>{
  assert.match(migrations,/create table if not exists public\.th_admin_operaciones/i);
  assert.match(migrations,/estado in \('procesando','confirmada','rechazada','revision'\)/i);
  assert.match(app,/action,operationId:payload\.operationId\|\|thUUID\(\)/);
  assert.match(app,/crear-usuario`/);
  for(const edge of [adminEdge,createUserEdge]){
    assert.match(edge,/th_admin_operaciones/);
    assert.match(edge,/payloadHash/);
    assert.match(edge,/ADMIN_REVIEW_REQUIRED/);
    assert.match(edge,/SOLICITADO/);
  }
  assert.match(adminEdge,/último administrador activo/);
});

test("las migraciones no destruyen tablas ni inventario",()=>{
  assert.doesNotMatch(migrations,/\bdrop\s+table\b/i);
  assert.doesNotMatch(migrations,/\btruncate\b/i);
  assert.doesNotMatch(migrations,/delete\s+from\s+public\.inventario/i);
});

test("los gates RLS retiran políticas legacy abiertas",()=>{
  assert.match(operationalRls,/drop policy if exists config_descuentos_todo/i);
  assert.match(operationalRls,/drop policy if exists th_verif_sesion_all/i);
  assert.match(operationalRls,/from anon/i);
  assert.match(operationalRls,/drop policy if exists marcas_anon_all/i);
  assert.match(fs.readFileSync(path.join(root,"supabase","rls","activate_legacy_rls.sql"),"utf8"),/drop policy if exists public_all on public\.ventas/i);
  assert.match(fs.readFileSync(path.join(root,"supabase","rls","activate_audit_rls.sql"),"utf8"),/drop policy if exists "allow all audit_log"/i);
});

test("la salud integral incluye conciliación, facturas e identidad",()=>{
  assert.match(migrations,/invoicesReview/i);
  assert.match(migrations,/adminOperationsReview/i);
  assert.match(migrations,/activeUsersWithoutAuth/i);
  assert.match(migrations,/invalidCountLedger/i);
});

test("evidencias y notas usan almacenamiento privado sin perder enlaces históricos",()=>{
  assert.match(migrations,/\('cargas-evidencia','cargas-evidencia',false/i);
  assert.match(migrations,/\('notas','notas',false/i);
  assert.match(migrations,/th_documentos_privados_lectura/i);
  assert.match(app,/storage:\/\/cargas-evidencia/);
  assert.match(app,/storage:\/\/notas/);
  assert.match(app,/createSignedUrl\(path,expiresIn,options\)/);
  assert.match(app,/\/storage\/v1\/object\/public\//);
  assert.doesNotMatch(app,/getPublicUrl\(/);
  assert.doesNotMatch(privateStorageMigration,/on conflict[\s\S]{0,160}public\s*=\s*false/i);
  assert.match(activatePrivateStorage,/usuarios[\s\S]*auth_id is null/i);
  assert.match(activatePrivateStorage,/DOCUMENTOS_PRIVADOS/);
  assert.match(activatePrivateStorage,/set public=false/i);
  for(const policy of ["evidencia_public_read","notas_public_read","notas_anon_insert"])
    assert.match(storagePolicyCleanup,new RegExp(`drop policy if exists ${policy}`,"i"));
  assert.match(storagePolicyCleanup,/split_part\(storage\.objects\.name,'\/',1\)/i);
  assert.match(storagePolicyCleanup,/p\.rol='marca'/i);
});
