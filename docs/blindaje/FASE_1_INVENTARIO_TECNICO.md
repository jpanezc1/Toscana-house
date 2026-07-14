# Toscana House — Blindaje sin pérdida funcional

## Fase 1: inventario técnico y línea base

Fecha de levantamiento: 2026-07-14  
Estado: línea base conservada; implementación de blindaje local completada, sin despliegue ni cambios en Supabase de producción.

## 1. Objetivo

Conservar íntegramente la operación actual de Toscana House y reforzar su implementación para que toda operación sensible sea autenticada, transaccional, idempotente, auditable y conciliable.

Esta fase no cambia reglas comerciales, pantallas ni datos. Define la línea base contra la que se verificará la paridad funcional de todas las fases posteriores.

## 2. Fuente activa y proceso de construcción

- `App.jsx` es la fuente activa de React y contiene la aplicación completa.
- `build.js` lee `App.jsx`, elimina sus imports y genera `main.jsx`.
- Esbuild genera `bundle-<timestamp>.js`.
- El build reescribe `index.html`, `sw.js`, `manifest.json` y `version.json`.
- Vercel ejecuta `node build.js` y sirve el directorio raíz.
- Un push a `main` puede desplegar producción; por tanto, ningún trabajo de blindaje debe empujarse a `main` sin aprobación explícita.

Archivos generados que no deben editarse como fuente:

- `main.jsx`
- `bundle-*.js`
- `index.html`
- `sw.js`
- `version.json`
- `manifest.json`

Archivos históricos o alternativos que no son la fuente activa:

- `App.js`
- `toscana-house.jsx`
- `toscana-house-new.jsx`
- `main_fixed.jsx`
- `bundle.js`
- `toscana-house.html`
- `theme-preview.html`
- `src/`

Antes de retirarlos se deberá comprobar que no participen en ningún proceso externo o recuperación manual.

## 3. Capas de datos actuales

### 3.1 Supabase

Supabase almacena la parte compartida entre dispositivos:

- inventario;
- ventas y líneas;
- retiros;
- cargas y evidencias;
- auditorías de inventario;
- auditoría forense;
- cierres;
- usuarios y marcas;
- descuentos;
- sesiones compartidas de conteo.

La escritura se realiza principalmente mediante funciones `sb*`. Muchas operaciones de negocio se dividen actualmente en varias escrituras independientes.

### 3.2 localStorage

El navegador conserva copias u orígenes locales de:

- `th_inv`;
- `th_ventas`;
- `th_retiros_v1`;
- `th_cargas`;
- `th_auditorias`;
- `th_audit_v2`;
- `th_cierres`;
- `th_alq`;
- `th_marcas`;
- `th_usuarios`;
- `th_descuentos`;
- `th_desc_codigos`;
- `th_gc_v1`;
- `th_cajas_v1`;
- configuración de liquidaciones, facturación, QR y Drive;
- borradores y conteos de verificación;
- `th_sync_outbox`.

Gift Cards, cajas por turno, parte de la facturación y varias configuraciones dependen hoy principalmente de almacenamiento local. Deben incorporarse al plan de persistencia compartida sin cambiar su flujo visible.

### 3.3 Outbox

`syncConRespaldo` intenta escribir inmediatamente y encola el payload si falla. El outbox preserva operaciones pendientes, pero no garantiza por sí mismo idempotencia de negocio. La operación `venta`, por ejemplo, hace `upsert` de cabecera y `insert` de líneas; un reintento puede repetir las líneas.

### 3.4 Realtime

Realtime difunde ventas, inventario, retiros, cargas, descuentos, marcas, auditorías y conteos. Debe conservarse para actualizar la interfaz, pero no puede decidir el resultado contable de una operación.

### 3.5 Integraciones

- Google Apps Script/Drive: respaldo opcional de ventas, productos y cierres.
- CUCU/SIAT: emisión y anulación de facturas.
- Supabase Storage: evidencias de cargas y notas PDF.
- JsBarcode y ZXing: etiquetas y lectura de códigos.
- jsPDF: notas de venta.
- WhatsApp: envío de notas, liquidaciones y facturas.
- XLSX: importaciones, evidencias, reportes y respaldos.

## 4. Reglas operativas que son invariantes

Estas reglas deben conservarse antes y después del blindaje:

1. Las unidades vendidas se calculan desde ventas no anuladas, nunca como `stockInicial - stock`.
2. `stockInicial` representa el total histórico recibido y aumenta con reposiciones y reimportaciones.
3. La identidad operativa esperada es `stockInicial = stock + vendidas + bajas`, ampliable con movimientos explícitos cuando se incorpore el libro mayor.
4. Las liquidaciones salen de `ventas[]`, no del stock.
5. La comisión de tarjeta del 1,8 % corresponde a la liquidación de la marca y no incrementa el precio al cliente.
6. Las ventas anteriores al 23-jun-2026 conservan el modelo histórico de descuento y deben pasar por `getManualDescPct`.
7. Una venta multimarca debe conservar exactamente su distribución actual por ítems y el prorrateo debe cuadrar.
8. Un SKU repetido en importación suma stock; no crea otro producto.
9. Un SKU con categoría conflictiva debe detener la importación hasta confirmación.
10. La importación conserva el comportamiento todo-o-nada de validación de filas.
11. El stock importado o repuesto debe incrementar también el histórico recibido.
12. Una venta anulada no cuenta en ventas, liquidaciones ni unidades vendidas y restituye inventario una sola vez.
13. La verificación física es un control y no modifica stock hasta que un administrador ejecute el cuadre explícito.
14. Las etiquetas mantienen tamaño 50×25 mm, formato CODE128 y opción por código o por unidad.
15. Caja conserva ventas, retiros, consulta de ventas, cambios e inventario según la navegación actual.
16. Marca conserva su portal, sus métricas, inventario, ventas, retiros, cargas, liquidación y configuración de descuentos autorizada.
17. Administrador conserva todas las funciones actuales.

## 5. Esquema requerido por el código

El código utiliza al menos los siguientes recursos:

- `inventario`
- `ventas`
- `venta_items`
- `cierres`
- `retiros`
- `cargas_inventario`
- `auditorias_inventario`
- `usuarios`
- `marcas`
- `config_descuentos`
- `descuentos_codigo`
- `audit_log`
- `th_verif_sesion`
- función `incrementar_conteo_verif`
- función `admin_eliminar_usuario`
- Edge Function `crear-usuario`
- bucket `cargas-evidencia`
- bucket `notas`

`supabase-setup.sql` no representa actualmente todo ese contrato. También omite columnas utilizadas por la aplicación, restricciones únicas y funciones. No debe emplearse todavía como migración de producción.

## 6. Riesgos priorizados

### P0 — integridad, pérdida o acceso indebido

| ID | Riesgo | Efecto operativo | Evidencia principal |
|---|---|---|---|
| P0-01 | Venta, líneas, stock y auditoría se guardan por separado | venta parcial, stock sin venta o venta sin stock | `handleVenta`, `sbGuardarVenta` |
| P0-02 | Stock calculado en cliente y escrito como valor absoluto | actualización perdida y sobreventa entre cajas | `sbActualizarStock` y mutadores de inventario |
| P0-03 | Reintento de venta inserta nuevamente las líneas | unidades vendidas y liquidaciones duplicadas | `venta_items.insert(items)` |
| P0-04 | Anulación y restitución de stock no son una transacción idempotente | devolución doble o anulación sin devolución | `handleAnularVenta` |
| P0-05 | Las políticas SQL entregadas permiten todas las operaciones | modificación directa de datos fuera de la interfaz | `supabase-setup.sql` |
| P0-06 | Existen credenciales alternativas y passwords en texto plano | suplantación de usuarios y pérdida del control por rol | `useAuth`, tabla `usuarios` |
| P0-07 | Gift Cards se descuentan localmente antes de confirmar la venta | saldo perdido o doble uso entre dispositivos | flujo Gift Card en `POS` |
| P0-08 | Factory Reset ejecuta borrados directos desde el navegador | pérdida total irreversible si se compromete un admin | `SistemaTab.runFactoryReset` |

### P1 — inconsistencia operativa o contable

| ID | Riesgo | Efecto operativo |
|---|---|---|
| P1-01 | Cambios no se persisten como entidad propia | existe auditoría, pero no un registro de negocio consultable y reversible |
| P1-02 | Bajas solo existen como auditoría más escritura de stock | trazabilidad incompleta si falla una de las dos operaciones |
| P1-03 | Reposiciones/importaciones compiten con ventas | una operación puede sobrescribir a la otra |
| P1-04 | Reversión de carga elimina productos y restaura stock en pasos | reversión parcial o eliminación de producto ya utilizado |
| P1-05 | Edición/eliminación de producto no usa outbox de forma uniforme | cambio local no confirmado o eliminación no auditada |
| P1-06 | Sincronización completa sube snapshots locales | un dispositivo antiguo puede sobrescribir datos recientes |
| P1-07 | Gift Cards y cajas no son compartidas en Supabase | estados distintos por dispositivo |
| P1-08 | Facturas se vinculan principalmente por localStorage | otro dispositivo puede no conocer el estado SIAT |
| P1-09 | Auditoría local se limita a 1.000 eventos y permite `upsert` | historial incompleto o mutable |
| P1-10 | El SQL de instalación está incompleto | staging o recuperación no reproducibles |
| P1-11 | El reloj del dispositivo genera IDs y fechas comerciales | colisiones, orden incorrecto y fechas alterables |

### P2 — mantenibilidad y prevención de regresiones

| ID | Riesgo | Efecto |
|---|---|---|
| P2-01 | `App.jsx` concentra toda la aplicación | alto impacto accidental y dificultad de pruebas |
| P2-02 | No existe una suite de reglas de negocio | cambios sin garantía de paridad |
| P2-03 | Hay múltiples copias históricas y bundles | riesgo de editar o desplegar el archivo incorrecto |
| P2-04 | README no describe el sistema real | recuperación y onboarding poco confiables |
| P2-05 | Dependencias XLSX/esbuild con avisos de seguridad | exposición al procesar archivos o herramientas desactualizadas |

## 7. Principio de implementación

El blindaje debe ser aditivo y reversible:

1. staging independiente;
2. migraciones que agreguen estructuras sin retirar las actuales;
3. libro mayor en modo sombra;
4. conciliación sin modificar stock;
5. RPC transaccionales;
6. feature flags `legacy`, `shadow` y `transactional`;
7. canario en una caja;
8. expansión por operación;
9. Auth y RLS progresivos;
10. retiro del legado solo después de paridad demostrada.

## 8. Acciones que requieren aprobación explícita

- Crear o modificar un proyecto Supabase.
- Leer datos reales para una conciliación fuera de la aplicación.
- Ejecutar cualquier SQL remoto.
- Crear o cambiar Edge Functions.
- Cambiar políticas RLS.
- Rotar contraseñas o credenciales.
- Desplegar a Vercel.
- Habilitar una feature flag en producción.
- Activar el motor transaccional en una caja.
- Corregir datos históricos.
- Desactivar el modo legacy.
- Archivar o eliminar fuentes históricas.
- Cambiar el comportamiento offline.
- Cambiar Factory Reset.

## 9. Estado de esta fase y evolución

- Fuente activa identificada: sí.
- Funciones operativas catalogadas: ver `MATRIZ_PARIDAD_FUNCIONAL.md`.
- Riesgos iniciales priorizados: sí.
- Plan de pruebas y secuencia: ver `PLAN_PRUEBAS_Y_DESPLIEGUE.md`.
- Código operativo modificado: sí, únicamente en la rama `codex/blindaje-transaccional` y detrás de feature flags con producción en `legacy`.
- Producción modificada: no.
- Supabase consultado o modificado: no.
- Despliegue realizado: no.

La implementación posterior a este levantamiento está documentada en `IMPLEMENTACION_Y_RUNBOOK.md`. Este archivo conserva la evidencia de la línea base original; las menciones a fallback, contraseñas locales, CUCU en navegador y RPC antiguas describen el estado auditado antes del blindaje, no el diseño objetivo actual.
