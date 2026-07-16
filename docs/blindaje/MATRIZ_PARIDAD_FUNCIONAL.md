# Toscana House — Matriz de paridad funcional

Esta matriz es el contrato de conservación operativa. Una función no puede migrarse al motor seguro hasta que sus entradas, salidas, efectos, consumidores y pruebas estén cubiertos.

Estado de implementación local: las rutas operativas diarias de F-001 a F-060 fueron preservadas o encapsuladas por adaptadores seguros. F-010 (Factory Reset remoto) quedó deliberadamente bloqueada hasta disponer de respaldo verificado y ejecución servidor con doble autorización. F-054 (turnos de caja) continúa fuera de la navegación, tal como estaba en la fuente auditada, pero su backend transaccional quedó preparado. La aceptación remota y operativa sigue pendiente según `IMPLEMENTACION_Y_RUNBOOK.md`; “implementado” no significa “desplegado”.

Leyenda de inventario:

- `0`: no altera stock.
- `+`: aumenta stock.
- `-`: disminuye stock.
- `±`: puede aumentar o disminuir.
- `D`: puede eliminar el registro de producto.

## 1. Acceso, roles y configuración

| ID | Función actual | Roles/UI | Persistencia actual | Inventario | Consumidores y paridad obligatoria |
|---|---|---|---|---|---|
| F-001 | Inicio de sesión y restauración de sesión | todos, Login | Supabase Auth con fallback a `usuarios`/credenciales locales | 0 | conservar usuario, nombre, rol, marca, estado y continuidad de sesión |
| F-002 | Cierre de sesión | todos, Config/portal | Supabase Auth y estado local | 0 | cerrar sesión sin borrar datos operativos pendientes |
| F-003 | Cambio de contraseña propia | todos, Seguridad | Auth y/o columna `usuarios.password` | 0 | conservar flujo visible; migrar internamente a Auth |
| F-004 | Alta, edición, activación, reset y baja de usuarios | admin, Equipo | `usuarios`, Auth/Edge Function, localStorage | 0 | conservar roles admin/caja/marca y auditoría de acciones |
| F-005 | Configuración de facturación CUCU | usuarios con acceso a Config | localStorage `th_cucu_cfg` | 0 | conservar URL/API key/sucursal/modalidad sin exponer secretos |
| F-006 | Configuración de carpeta, Drive y QR bancario | Config/POS | localStorage, File System Access, Apps Script | 0 | conservar respaldo, descargas organizadas y QR de cobro |
| F-007 | Cola de sincronización: ver, reintentar y exportar | admin, Sistema | `th_sync_outbox` | según operación | conservar visibilidad y recuperación; hacer reintentos idempotentes |
| F-008 | Recargar desde Supabase y subir inventario local | Config/Sistema | snapshot local/nube | ± | conservar como herramienta de recuperación, agregando precheck y protección contra sobrescritura |
| F-009 | Limpiar caché local | Config/Sistema | elimina claves locales | 0/indirecto | conservar, impedir pérdida de operaciones pendientes |
| F-010 | Factory Reset | admin, Sistema | DELETE remoto y limpieza local | D | conservar la capacidad administrativa, pero exigir autorización fuerte, respaldo y ejecución servidor |

## 2. Ventas, pagos y documentos

| ID | Función actual | Entradas principales | Persistencia actual | Inventario | Consumidores y paridad obligatoria |
|---|---|---|---|---|---|
| F-011 | Buscar/agregar producto al carrito | código, nombre, categoría, escáner/foto | estado React | 0 | conservar filtros, máximo por stock y lectura de etiquetas |
| F-012 | Venta normal y multimarca | ítems, cantidades, precios, cliente, vendedor | `ventas`, `venta_items`, inventario, auditoría, localStorage, Drive | - | POS, historial, marcas, liquidaciones, reportes, notas, auditoría |
| F-013 | Descuento configurado por marca | porcentaje, vigencia, responsable | `config_descuentos`, localStorage, Realtime, auditoría | 0 | conservar precedencia y vigencia |
| F-014 | Descuento por SKU | código, porcentaje, vigencia | `descuentos_codigo`, localStorage, Realtime, auditoría | 0 | el descuento por código mantiene precedencia sobre el de marca |
| F-015 | Descuento manual por marca/global en caja | porcentaje por marca/global | se incorpora a ítems/venta | 0 | conservar topes, total del cliente y absorción por marca |
| F-016 | Pago simple | efectivo, QR o tarjeta | `metodo_pago` | 0 | conservar cálculos, reportes y comisión de tarjeta en liquidación |
| F-017 | Pago mixto | montos por efectivo/QR/tarjeta | string histórico con prefijo `mixto` y desglose | 0 | conservar formato histórico y validación de suma exacta |
| F-018 | Verificación visual de pago QR | confirmación manual, sonido | UI antes de `cobrar` | 0 | conservar interacción; no interpretarla como verificación bancaria automática |
| F-019 | Pago con Gift Card y complemento | código, saldo usado, método complementario | `th_gc_v1` y venta | 0 sobre inventario; reduce saldo GC | conservar asignación por marca y saldo; transaccionar saldo GC con venta |
| F-020 | Nota de venta PNG/PDF | venta confirmada | descarga, bucket `notas` | 0 | conservar diseño, numeración, detalle, total y compatibilidad histórica |
| F-021 | Envío de nota por WhatsApp | venta, cliente/teléfono | Web Share/WhatsApp y PDF | 0 | conservar mensaje completo, PDF y ruta móvil/escritorio |
| F-022 | Comprobante 58 mm | venta | ventana de impresión | 0 | conservar datos, descuentos, método y cliente |
| F-023 | Factura SIAT/CUCU o manual | venta, NIT, razón social, teléfono | CUCU API y `th_fac_<venta>` | 0 | conservar emisión, PDF, QR, WhatsApp y vínculo con venta |
| F-024 | Anulación de factura SIAT | CUF | CUCU API y estado local | 0 | conservar relación con anulación de venta y estado visible |
| F-025 | Anulación de venta | venta original | `ventas.anulada`, stock, auditoría | + | excluir de liquidaciones/ventas; devolver stock exactamente una vez |

## 3. Inventario y trazabilidad

| ID | Función actual | Entradas principales | Persistencia actual | Inventario | Consumidores y paridad obligatoria |
|---|---|---|---|---|---|
| F-026 | Recepción manual/producto nuevo | marca, nombre, categoría, precio, stock, fecha, código | inventario, carga, evidencia XLSX, auditoría, Drive | + | conservar generación/manual de código, etiquetas y carga |
| F-027 | Importación Excel | plantilla, SKU, talla, color, categoría, stock | inventario batch, carga, evidencia, auditoría, outbox | + | SKU repetido suma stock; conflictos bloquean; filas inválidas detienen |
| F-028 | Reposición de SKU existente | código y cantidad | inventario y auditoría | + | aumentar `stock` y `stockInicial` |
| F-029 | Modificación de precio | código y precio | inventario y auditoría | 0 | conservar precio anterior/nuevo y efecto en ventas futuras, no históricas |
| F-030 | Edición de producto | nombre, código, categoría, descripción, stock/precio según rol | inventario/localStorage | ± | conservar validaciones, motivo de ajuste y referencias históricas |
| F-031 | Eliminación de producto | producto/código | inventario/localStorage/outbox parcial | D | conservar acción admin, impedir eliminar referencias históricas sin estrategia compatible |
| F-032 | Baja parcial o total | código, cantidad, motivo | stock y `audit_log` | - | no crear retiro; conservar nota de baja, motivo y conteo de bajas |
| F-033 | Retiro desde caja | código, cantidad, destinatario, motivo | `retiros`, stock, auditoría, localStorage | - | conservar separación entre retiro y baja y su aparición en portal/reportes |
| F-034 | Registro y verificación de cargas | items, evidencia, usuario, verificador | `cargas_inventario`, Storage | 0 | conservar evidencia, usuario, marca, cantidades y estado verificado |
| F-035 | Reversión/eliminación de carga | carga y sus items | inventario, carga, outbox | ±/D | restaurar exactamente el stock previo y retirar solo productos seguros |
| F-036 | Etiquetas por código o por unidad | producto, stock, marca | impresión CODE128 | 0 | conservar formato 50×25 mm y cantidad elegida |
| F-037 | Escáner por cámara, imagen y lector HID | código/imagen | UI/conteo | 0 | conservar normalización, variantes y feedback sonoro/visual |

## 4. Verificación, cambios e históricos

| ID | Función actual | Entradas principales | Persistencia actual | Inventario | Consumidores y paridad obligatoria |
|---|---|---|---|---|---|
| F-038 | Conteo físico compartido | mes, marca, códigos, doble conteo | localStorage, `th_verif_sesion`, RPC, Realtime | 0 | conservar base congelada, multi-dispositivo, duplicados y ajustes durante conteo |
| F-039 | Guardar auditoría física | cruce sistema/conteo | `auditorias_inventario`, localStorage, Excel | 0 | conservar faltantes, sobrantes, valores y detalle completo |
| F-040 | Marcar auditoría revisada | auditoría y responsable | `auditorias_inventario` | 0 | conservar quién/cuándo la revisó |
| F-041 | Cuadrar inventario con auditoría | detalle contado | inventario y auditoría forense | ± | conservar confirmación explícita; registrar cada ajuste |
| F-042 | Cambio de prendas | venta, devueltas, nuevas, diferencia, pago, notas | inventario y `audit_log` | ± | conservar nota de cambio, vínculo con venta y diferencia monetaria |
| F-043 | Venta histórica con SKU | fecha, turno, pago, descuento, ítems | ventas, líneas, inventario, auditoría | - | conservar validación contra primera carga y métodos mixtos |
| F-044 | Importación histórica sin SKU | marca, fecha, turno, pago, descripción, precio | ventas/líneas `LIBRE`, auditoría | 0 | conservar liquidaciones sin tocar inventario |

## 5. Marcas, liquidaciones y portales

| ID | Función actual | Entradas principales | Persistencia actual | Inventario | Consumidores y paridad obligatoria |
|---|---|---|---|---|---|
| F-045 | Alta y edición de marca | nombre, imagen, color, estado, usuario | seed + localStorage + `marcas` | 0 | conservar IDs, logos, portal, inventario y ventas asociadas |
| F-046 | Portal de marca | usuario/marca | lectura de ventas, inventario, cargas, retiros y config | 0 | limitar a su marca sin perder dashboard, reportes, descuentos y liquidación |
| F-047 | Configuración de liquidación por marca | comisión, alquiler, tarjeta, impuestos/gastos | localStorage | 0 | conservar fórmulas y configuraciones históricas por marca/mes |
| F-048 | Cierre de liquidación | marca, mes, cifras, gastos | `cierres`, localStorage, Drive | 0 | conservar bloqueo/estado de cierre y reapertura autorizada |
| F-049 | Exportación y envío de liquidación | marca, mes | XLSX, imagen, WhatsApp, impresión | 0 | conservar cifras exactas y presentación |
| F-050 | Alquileres y estado de pago | marca, mes, pagado | `th_alq` | 0 | conservar seguimiento y planilla impresa |

## 6. Gift Cards, cajas y reportes

| ID | Función actual | Entradas principales | Persistencia actual | Inventario | Consumidores y paridad obligatoria |
|---|---|---|---|---|---|
| F-051 | Crear Gift Card | monto, vigencia, nota | `th_gc_v1` | 0 | conservar código, barcode, saldo y estado |
| F-052 | Canjear Gift Card manualmente | código, monto, nota | `th_gc_v1` | 0 | conservar historial de usos y rechazo por saldo/vencimiento |
| F-053 | Consultar, filtrar, imprimir y exportar Gift Cards | rango, estado, búsqueda | localStorage/XLSX | 0 | conservar KPIs, detalle, barcode y Excel |
| F-054 | Abrir/cerrar cajas por turno | caja, balance | `th_cajas_v1` | 0 | conservar turnos, estado y último balance |
| F-055 | Inicio y dashboard | mes, ventas, inventario | datos derivados | 0 | conservar KPIs y navegación |
| F-056 | Ventas e historial por día/mes | filtros, ventas | datos derivados | 0 | conservar anuladas visibles pero excluidas de totales correspondientes |
| F-057 | Dashboard analítico | ventas | datos derivados | 0 | conservar métodos, periodos y acceso al detalle |
| F-058 | Reportes Excel/CSV y respaldo completo | inventario, ventas, retiros, auditorías, cargas, marcas | descargas | 0 | conservar hojas, columnas, fórmulas, nombres y contenido histórico |
| F-059 | Descarga masiva de notas | ventas | archivos PDF/PNG | 0 | conservar cantidad, nombres y organización |
| F-060 | Respaldo opcional a Drive | venta, producto, cierre | Apps Script/Sheets | 0 | conservar como respaldo secundario sin convertirlo en fuente contable |

## 7. Contrato de aceptación por función

Cada fila debe pasar el siguiente checklist antes de activar el motor nuevo:

- [ ] La pantalla y acción siguen disponibles para el mismo rol.
- [ ] Las entradas y validaciones visibles se conservan.
- [ ] El resultado monetario coincide con el sistema anterior.
- [ ] El efecto de inventario coincide, pero se ejecuta atómicamente.
- [ ] Los reportes consumidores conservan sus cifras.
- [ ] Los documentos e integraciones conservan su formato y datos.
- [ ] El historial existente sigue siendo legible.
- [ ] Un reintento devuelve el resultado original y no repite efectos.
- [ ] Toda mutación genera movimiento/auditoría con usuario y fecha de servidor.
- [ ] Hay rollback por feature flag.
