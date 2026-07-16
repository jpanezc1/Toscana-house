# Toscana House — implementación y runbook sin interrupción

Fecha: 2026-07-14  
Rama: `codex/blindaje-transaccional`  
Producción: **blindaje interno activo; modo global `transactional`, RLS por rol y Storage privado**

## 1. Estado real

El blindaje interno está desplegado y activo en producción. Las mutaciones operativas pasan por RPC transaccionales, RLS limita la lectura por rol y los documentos se entregan mediante enlaces firmados. El kill switch `legacy` se conserva únicamente para recuperación controlada.

Producción ejecutada el 2026-07-14:

- respaldo lógico PostgreSQL, SQL público y 55 objetos Storage cifrado y restaurado con éxito;
- backup: `/Users/Apple/Documents/TOSCANA HOUSE/backups/toscana-production-logical-2026-07-14T18-30Z.tar.gz.enc`;
- clave del backup: macOS Keychain, servicio `toscana-house-production-backup`;
- 23 migraciones aplicadas y sincronizadas; 022 cerró los buckets y 023 retiró políticas anónimas heredadas;
- 23 de 23 perfiles migrados a Supabase Auth y comprobados con sus credenciales actuales;
- contraseñas legacy purgadas de `public.usuarios`: 23/23 perfiles conservan Auth y quedan `0` credenciales antiguas en la tabla operativa;
- Edge Functions `crear-usuario`, `admin-usuario` y `cucu-facturacion` activas;
- frontend productivo: `https://toscana-house.vercel.app`;
- canario aislado aprobado: venta, replay, rechazo de sobreventa, anulación y stock `225 → 224 → 225`;
- el canario `TEST_CANARY_1784055418057` se conserva en venta, ledger y auditoría, marcado `excludeFromReports=true`; el frontend lo excluye de ventas, anulaciones, liquidaciones y reportes visibles;
- canario final posterior a RLS `TEST_CANARY_FINAL_20260714` aprobado: venta y anulación, dos movimientos, delta neto `0` y dos evidencias de auditoría;
- dos ventas históricas sin líneas reconstruidas desde `audit_log`; un artefacto `TEST_` vacío retirado con auditoría;
- modo global `transactional`; RLS activo en las 13 tablas operativas auditadas y escritura directa de ventas revocada;
- pruebas de rol aprobadas: admin ve todo; caja no ve auditoría ni otros perfiles; marca no ve productos, líneas ni documentos de otra marca;
- 55/55 documentos conservados en buckets privados; acceso anónimo `0` y políticas legacy abiertas `0`;
- `th_system_health.ok = true`, sin diferencias de ledger, stock negativo, operaciones pendientes ni datos huérfanos;
- CUCU permanece `configured: false` y `sandbox` hasta recibir credenciales reales de prueba;
- organización productiva en plan Free, sin backup automático y con aviso de cuota hasta el 2026-08-11.

Staging ejecutado el 2026-07-14:

- Supabase: proyecto `Toscana House Staging`, referencia `nkpuczeyprnxqgaadqii`;
- preview protegido: `https://toscana-house-1aig8w74j-jpanezc1s-projects.vercel.app`;
- 21 migraciones aplicadas y sincronizadas en staging;
- Edge Functions `crear-usuario`, `admin-usuario` y `cucu-facturacion` activas;
- RLS activado únicamente en staging, con flags transaccionales de staging;
- depósitos privados `cargas-evidencia` y `notas`, con acceso autenticado y enlaces firmados;
- staging permanece aislado de producción.

Comando de verificación local:

```bash
npm run check
```

Resultado de la validación final:

- 23 migraciones con estructura válida y aplicadas en producción;
- 20 pruebas automáticas aprobadas;
- compilación de `App.jsx` aprobada;
- `git diff --check` sin errores;
- venta UI transaccional confirmada con ledger y stock `5 → 4`;
- reintento idempotente, sobreventa rechazada y anulación con restitución única aprobados;
- alta/edición/desactivación/baja de usuario y protección del último administrador aprobadas;
- lectura anónima de evidencias y notas rechazada; enlace firmado autenticado aprobado;
- `th_system_health.ok = true`, sin diferencias de ledger ni operaciones pendientes;
- preview verificado sin referencia al proyecto Supabase de producción;
- despliegue productivo verificado contra la referencia Supabase de producción y modo global `transactional`.

CUCU está desplegado contra el endpoint sandbox, pero reporta `configured: false` porque todavía no se proporcionaron `CUCU_API_KEY` y `CUCU_POINT_OF_SALE_ID` de pruebas. La función se mantiene bloqueada de forma segura y no reutiliza credenciales de producción.

## 2. Qué quedó blindado

- Ventas, anulaciones, cambios, retiros, bajas, reposiciones, recepciones, importaciones, ajustes y reversos ejecutan RPC atómicas e idempotentes.
- Cada movimiento de stock conserva `stock_antes`, delta, `stock_despues`, operación, usuario, dispositivo y fecha de servidor en un ledger inmutable.
- Gift Cards se crean, migran y canjean con bloqueo de saldo en servidor.
- Conteo físico multi-dispositivo suma con bloqueo de fila y conserva un movimiento inmutable por escaneo.
- Usuarios sólo usan Supabase Auth; altas, bajas, cambios de rol/estado y reset de contraseña pasan por Edge Functions administrativas idempotentes.
- No se puede retirar el último administrador activo.
- CUCU usa secreto de servidor, `X-API-Key`, reserva de emisión/anulación y estado de revisión ante respuestas inciertas.
- Configuración de comisión, tarjeta, alquiler y gastos deja de depender únicamente de un navegador.
- El cierre mensual congela ventas incluidas, medios de pago, descuentos, comisión, alquiler, gastos y neto. Un cierre histórico se vuelve a leer desde ese snapshot.
- Turnos de caja quedaron preparados con un solo turno abierto por caja, idempotencia y auditoría; la pantalla sigue oculta porque ya estaba fuera de navegación.
- El arranque ya no reinyecta ventas, retiros, usuarios o auditorías antiguas sólo por existir en `localStorage`.
- Factory Reset remoto y la subida ciega de inventario quedan bloqueados en modo seguro.
- El carrito se conserva durante actualizaciones de la PWA.
- Evidencias Excel y notas PDF nuevas se guardan en buckets privados; la aplicación entrega enlaces temporales en vez de URLs públicas permanentes.
- Producción opera en `transactional`; el rollback a `legacy` permanece documentado y reversible.

## 3. Condiciones de no interrupción

No desplegar nuevamente un frontend antiguo sobre la base protegida. El cliente productivo actual requiere las migraciones 001–023, Supabase Auth, RPC transaccionales y enlaces firmados.

Orden obligatorio:

1. respaldo verificable;
2. staging separado;
3. migraciones aditivas;
4. Edge Functions y secretos de prueba;
5. frontend de staging;
6. pruebas y conciliación;
7. frontend de producción con kill switch en `legacy` durante la adopción;
8. modo sombra;
9. canario por dispositivo;
10. expansión operación por operación;
11. RLS al final.

## 4. Preparación

Antes de tocar Supabase:

- exportar inventario, ventas, líneas, retiros, cargas, auditorías, usuarios, descuentos, cierres y Gift Cards;
- tomar backup nativo de la base;
- registrar conteos de filas y hash/fecha del respaldo;
- exportar el outbox de cada dispositivo y dejarlo vacío mediante reintento controlado;
- anotar los `deviceId` del equipo canario;
- confirmar que todos los usuarios activos tengan acceso a Supabase Auth;
- identificar un único dispositivo administrativo como fuente autorizada para configuraciones financieras locales históricas;
- rotar la antigua API key de CUCU, porque anteriormente podía residir en el navegador.

No guardar ninguna clave real en Git, documentación, Vercel ni `localStorage`.

## 5. Staging

### 5.1 Base de datos

Ejecutar en orden los archivos de `supabase/migrations/001_precheck.sql` a `023_storage_policy_cleanup.sql` sobre una copia de staging.

Después ejecutar:

1. `supabase/validation/001_post_migration_checks.sql`;
2. corregir únicamente datos de staging si aparece algún `ERROR`;
3. `supabase/validation/002_validate_constraints.sql` sólo cuando todos los datos sean compatibles;
4. las pruebas de `supabase/tests/` dentro de una transacción de prueba y con datos sintéticos.

Las tres puertas RLS se activaron después de aprobar migraciones e identidad Auth. En producción también fueron aplicadas y validadas simulando perfiles admin, caja y marca.

### 5.2 Edge Functions

Desplegar en staging:

- `crear-usuario`;
- `admin-usuario`;
- `cucu-facturacion`.

Configurar CUCU sólo contra sandbox:

```bash
supabase secrets set \
  CUCU_API_KEY='<clave-test-rotada>' \
  CUCU_POINT_OF_SALE_ID='<punto-venta-test>' \
  CUCU_ENDPOINT='https://sandbox.cucu.bo/api/v1/invoices' \
  CUCU_CODIGO_ACTIVIDAD='<codigo-validado>' \
  CUCU_CODIGO_PRODUCTO_SIN='<codigo-validado>' \
  CUCU_UNIDAD_MEDIDA='58' \
  CUCU_DOCUMENTO_ANONIMO='99001'
```

Verificar que `health` indique `configured: true` y `environment: sandbox`.

### 5.3 Frontend

Desplegar la rama como preview. El build inyecta explícitamente el entorno `staging`; el dominio comercial se compila como `production`.

Staging y producción resuelven las operaciones protegidas en:

```text
production/* = transactional
```

## 6. Pruebas obligatorias de aceptación

Ejecutar la matriz completa de `PLAN_PRUEBAS_Y_DESPLIEGUE.md`. Como mínimo:

- dos cajas intentan vender la última unidad;
- doble clic y reintento después de timeout;
- venta multimarca con efectivo, QR, tarjeta, mixto y Gift Card;
- anulación simultánea y restitución única;
- cambio, retiro, baja y reposición concurrentes;
- importación válida, inválida, repetida y reverso;
- conteo físico desde dos dispositivos;
- auditoría y cuadre con movimientos exactos;
- edición de producto y desactivación con ventas históricas;
- alta, edición, desactivación, reset y baja de usuarios;
- rechazo al intentar retirar el último admin;
- configuración financiera, gastos, cierre, reapertura y snapshot histórico;
- factura CUCU sandbox, reintento, timeout, anulación y estado de revisión;
- actualización PWA con carrito abierto;
- lectura de marca limitada a su propia marca;
- notas, etiquetas, WhatsApp, Excel, Drive y reportes con los mismos totales y formato operativo.

Después de cada bloque ejecutar `public.th_system_health(...)` como administrador. `ok` debe ser `true`; `shadowDifferences` puede ser informativo durante sombra, pero toda diferencia debe explicarse antes de avanzar.

## 7. Activación progresiva

Usar `public.th_configurar_feature_flag(...)`; no editar flags sin auditoría.

### 7.1 Sombra

Activar primero `shadow` en staging y luego en producción para un solo dispositivo. Mantenerlo varios días operativos y comparar diariamente el ledger con stock.

### 7.2 Canario transaccional

Orden recomendado:

1. `VENTA`;
2. `ANULACION`;
3. `CAMBIO`;
4. `RETIRO` y `BAJA`;
5. `REPOSICION`, `RECEPCION` e `IMPORTACION`;
6. `REVERSO_CARGA` y `AJUSTE_AUDITORIA`;
7. `EDICION_PRODUCTO` y `DESACTIVAR_PRODUCTO`;
8. ventas históricas e importaciones libres;
9. Gift Cards;
10. auditoría, cargas, descuentos y marcas;
11. configuración financiera y cierres;
12. turnos de caja si se decide reactivar su pestaña.

Cada paso inicia con un `deviceId` canario. Sólo expandir a todos los dispositivos después de cuadrar inventario, ventas, movimientos, auditoría, documentos y reportes.

Toda venta canario debe usar `origen=PRUEBA_CANARIO` y metadata `testRecord=true`, `excludeFromReports=true`. La evidencia se conserva en base de datos y ledger; nunca se elimina ni se muestra en reportes operativos.

### 7.3 RLS

RLS se activa al final y en tres puertas separadas:

1. `supabase/rls/activate_legacy_rls.sql` para inventario, ventas, líneas, retiros y usuarios;
2. `supabase/rls/activate_operational_rls.sql` para cierres, cargas, auditorías, marcas, descuentos y sesiones de conteo;
3. `supabase/rls/activate_audit_rls.sql` para `audit_log`.

Cada gate se niega a ejecutar si faltan perfiles Auth o flags globales requeridos. Antes de cada gate:

- outbox vacío en todos los equipos;
- salud integral en verde;
- cero operaciones antiguas “procesando”;
- cero facturas o usuarios en “revisión” sin conciliar;
- pruebas de rol aprobadas desde navegador y API.

## 8. CUCU: conciliación de estados inciertos

Estados `revision` o `revision_anulacion` significan que no es seguro repetir una llamada externa. No cambiar esos estados manualmente sin consultar primero CUCU por CUF/ID y contrastar la factura con `facturas_venta` y `audit_log`.

Procedimiento:

1. congelar nuevas acciones sobre esa venta;
2. consultar CUCU desde backend;
3. verificar CUF, número, estado e ID del proveedor;
4. registrar evidencia de la consulta;
5. corregir mediante una operación administrativa auditada;
6. volver a ejecutar salud integral.

## 9. Kill switch

Ante cualquier diferencia inexplicable:

1. detener la expansión del canario;
2. cambiar los flags afectados a `legacy` mediante `th_configurar_feature_flag`;
3. si RLS ya estaba activado, ejecutar `supabase/rollback/001_emergency_legacy_mode.sql`;
4. conservar tablas, ledger y auditoría para investigar;
5. no borrar ni “arreglar” movimientos históricos;
6. exportar salud, operaciones, outbox y diferencias;
7. reanudar sólo después de reproducir y aprobar la corrección en staging.

El rollback no elimina estructuras nuevas ni evidencia. Vuelve a habilitar las escrituras que necesita el motor anterior para mantener la tienda operativa.

## 10. Criterio final de “resuelto”

Estado al 2026-07-14: **blindaje interno y despliegue productivo resueltos**. La integración externa automática con CUCU queda deliberadamente deshabilitada hasta recibir credenciales sandbox del proveedor; la facturación manual permanece disponible y CUCU falla de forma cerrada sin alterar ventas.

Sólo marcar completado cuando se cumpla todo:

- backup restaurado exitosamente en una prueba;
- staging aprobado por usuarios reales de caja, administración y marca;
- CUCU sandbox aprobado y secretos de producción rotados (pendiente externo, no bloquea el blindaje interno);
- al menos un ciclo canario sin diferencias;
- inventario conciliado a cero;
- liquidaciones y documentos iguales a la línea base;
- outbox vacío;
- `th_system_health.ok = true`;
- RLS aprobado por rol;
- kill switch ensayado;
- despliegue de producción aprobado explícitamente.
