# Toscana House — Plan de pruebas y despliegue seguro

## 1. Estrategia

El sistema seguirá operando con el motor actual mientras se construye y valida el motor seguro. La transición será por operación y por caja, no mediante una sustitución completa.

Estados previstos:

- `legacy`: comportamiento actual.
- `shadow`: comportamiento actual más registro/conciliación paralela sin decidir stock.
- `transactional`: el servidor confirma cabecera, detalles, stock, movimiento y auditoría conjuntamente.

## 2. Orden de implementación

### Hito A — staging reproducible

1. Crear Supabase y Vercel de staging.
2. Configurar variables separadas.
3. Cargar datos sintéticos representativos.
4. Simular admin, dos cajas y dos marcas.
5. Instalar la PWA de staging en dos dispositivos.

Criterio de salida: el build y el catálogo funcional pueden ejercitarse sin contactar producción.

### Hito B — esquema aditivo

1. Escribir prechecks de datos.
2. Completar contrato SQL existente.
3. Agregar libro mayor, operaciones idempotentes y feature flags.
4. Agregar índices y restricciones compatibles.
5. Preparar validación y rollback no destructivo.

Criterio de salida: la aplicación legacy funciona sin cambios sobre el esquema ampliado.

### Hito C — modo sombra

1. Registrar movimientos sombra.
2. Reconstruir stock esperado.
3. Comparar contra inventario actual.
4. Detectar duplicados, huérfanos y operaciones parciales.
5. No corregir diferencias automáticamente.

Criterio de salida: varios días de operación simulada sin diferencias inexplicadas.

### Hito D — ventas transaccionales

1. RPC idempotente de venta.
2. Adaptador frontend bajo feature flag.
3. Pruebas de pagos, descuentos, Gift Card, documentos e integraciones.
4. Canario en una caja.

Criterio de salida: venta, líneas, stock, pago, movimiento y auditoría quedan confirmados una sola vez.

### Hito E — resto de mutaciones

Orden:

1. anulaciones;
2. cambios;
3. retiros y bajas;
4. reposiciones y recepción manual;
5. ajustes de auditoría;
6. importaciones;
7. reversión de cargas;
8. Gift Cards;
9. cajas y facturación compartida.

Cada operación debe completar su canario antes de continuar.

### Hito F — Auth y RLS

1. Crear perfiles Auth compatibles.
2. Probar sesiones y roles.
3. Migrar usuarios sin retirar el acceso anterior.
4. Activar RLS tabla por tabla.
5. Retirar passwords/fallback solo después de verificar todas las cuentas.

## 3. Casos de prueba críticos

### 3.1 Ventas y concurrencia

| ID | Escenario | Resultado esperado |
|---|---|---|
| T-VEN-001 | Venta normal de un SKU | una venta, sus líneas y un descuento exacto de stock |
| T-VEN-002 | Venta de varios SKU | todos los ítems se confirman o ninguno |
| T-VEN-003 | Venta multimarca | totales y liquidaciones por marca cuadran exactamente |
| T-VEN-004 | Dos cajas venden la última unidad | una confirma y la otra recibe stock insuficiente |
| T-VEN-005 | Doble clic en cobrar | una sola operación y un solo movimiento |
| T-VEN-006 | Timeout después de confirmar servidor | reintento devuelve el resultado original |
| T-VEN-007 | Fallo al guardar una línea | rollback total |
| T-VEN-008 | Cliente pierde conexión antes de recibir respuesta | reintento con la misma clave, sin duplicación |
| T-VEN-009 | Venta mientras se repone el mismo SKU | serialización correcta de ambos deltas |
| T-VEN-010 | Venta mientras se da de baja el mismo SKU | nunca queda stock negativo ni se pierde una operación |

### 3.2 Precios, descuentos y pagos

| ID | Escenario | Resultado esperado |
|---|---|---|
| T-PAG-001 | Efectivo, QR y tarjeta | el cliente paga el mismo total actual |
| T-PAG-002 | Pago mixto | suma por métodos igual al total con tolerancia de 0,01 |
| T-PAG-003 | Descuento por marca | se aplica únicamente a los ítems de esa marca |
| T-PAG-004 | Descuento por SKU y marca simultáneos | SKU conserva precedencia actual |
| T-PAG-005 | Descuento manual por marca | cada marca absorbe el descuento correspondiente |
| T-PAG-006 | Venta tarjeta histórica previa al 23-jun-2026 | compatibilidad mediante `getManualDescPct` |
| T-PAG-007 | Gift Card total | venta y saldo confirman juntos |
| T-PAG-008 | Gift Card parcial + complemento | asignación y método complementario se conservan |
| T-PAG-009 | Dos cajas usan el mismo saldo GC | solo se consume saldo disponible una vez |

### 3.3 Anulaciones, cambios y salidas

| ID | Escenario | Resultado esperado |
|---|---|---|
| T-MOV-001 | Anular venta | estado y stock cambian en una transacción |
| T-MOV-002 | Anular dos veces | la segunda llamada devuelve el primer resultado sin sumar stock |
| T-MOV-003 | Anular simultáneamente | una sola restitución |
| T-MOV-004 | Cambio con diferencia cero/positiva/negativa | stock y diferencia coinciden con flujo actual |
| T-MOV-005 | Cambio sin stock de prenda nueva | rechazo completo |
| T-MOV-006 | Retiro | registro y descuento atómicos |
| T-MOV-007 | Baja parcial/total | delta exacto y motivo obligatorio/registrado |
| T-MOV-008 | Reposición concurrente | incrementa `stock` y `stockInicial` sin perder ventas |

### 3.4 Cargas, auditoría e históricos

| ID | Escenario | Resultado esperado |
|---|---|---|
| T-CAR-001 | Importación válida | todas las filas, carga, evidencia y movimientos confirman |
| T-CAR-002 | Fila inválida | no se aplica ninguna fila |
| T-CAR-003 | SKU repetido | suma stock y `stockInicial`; no duplica producto |
| T-CAR-004 | Categoría conflictiva | mantiene el bloqueo/confirmación actual |
| T-CAR-005 | Reintento del mismo archivo | no aplica dos veces la misma importación |
| T-CAR-006 | Reversión de carga | compensa movimientos sin borrar historia |
| T-CAR-007 | Reversión con ventas posteriores | impide borrar productos usados y propone compensación segura |
| T-AUD-001 | Conteo compartido en dos dispositivos | suma conteos conforme a reglas actuales |
| T-AUD-002 | Venta durante conteo | ajuste en vivo correcto |
| T-AUD-003 | Carga durante conteo | ajuste en vivo correcto |
| T-AUD-004 | Guardar auditoría | no modifica stock |
| T-AUD-005 | Cuadrar auditoría | genera movimiento por cada diferencia |
| T-HIS-001 | Venta histórica con SKU | fecha/turno, stock y liquidación correctos |
| T-HIS-002 | Importación libre sin SKU | afecta ventas/liquidaciones y no stock |

### 3.5 Roles, documentos e integraciones

| ID | Escenario | Resultado esperado |
|---|---|---|
| T-ROL-001 | Caja intenta función admin por API | servidor la rechaza |
| T-ROL-002 | Marca consulta otra marca | servidor la rechaza |
| T-ROL-003 | Admin ejecuta operación permitida | confirma y audita |
| T-DOC-001 | Nota PDF/PNG/58 mm | contenido y totales coinciden con versión actual |
| T-DOC-002 | WhatsApp móvil/escritorio | mantiene rutas actuales |
| T-DOC-003 | Factura CUCU y manual | conserva emisión, vínculo, PDF, QR y anulación |
| T-REP-001 | Reportes mensuales, stock y respaldo | mismas columnas y totales que la línea base |
| T-REP-002 | Liquidación multimarca | prorrateo suma exactamente el total de venta |
| T-PWA-001 | Actualización con carrito abierto | no recarga ni pierde el carrito |
| T-PWA-002 | Volver de segundo plano | reconcilia sin sobrescribir operaciones nuevas |

## 4. Conciliación obligatoria

La validación diaria debe comparar:

```text
stock esperado
= stock de apertura
+ recepciones
+ reposiciones
+ anulaciones
+ entradas por cambios
- ventas
- retiros
- bajas
- salidas por cambios
± ajustes autorizados
```

Toda diferencia debe mostrar:

- producto y código;
- stock almacenado y esperado;
- movimientos relacionados;
- usuario y dispositivo;
- primera fecha en que apareció;
- operaciones pendientes o fallidas.

No se realizará corrección automática.

## 5. Despliegue canario sin interrupción

1. Tomar y verificar respaldo.
2. Ejecutar precheck.
3. Aplicar únicamente migración aditiva aprobada.
4. Confirmar que clientes legacy siguen operando.
5. Activar `shadow`.
6. Observar conciliación.
7. Activar `transactional` solo para una caja identificada.
8. Observar ventas, latencia, rechazos y diferencias.
9. Volver a `legacy` si un criterio falla.
10. Ampliar a las demás cajas después de aprobación.

No se forzará una actualización de PWA durante un carrito o cobro.

## 6. Rollback mínimo por hito

- La feature flag vuelve a `legacy` sin desplegar.
- Las tablas y movimientos nuevos permanecen para análisis.
- No se borran ventas confirmadas.
- No se deshacen migraciones aditivas durante horario de tienda.
- Toda operación pendiente conserva su idempotency key.
- Se documenta la última operación segura y el dispositivo que la originó.
- Si hay discrepancia, se congela solo la operación afectada, no toda la tienda.

## 7. Aprobaciones necesarias

Se solicitará autorización antes de:

1. crear staging externo;
2. copiar o anonimizar datos;
3. ejecutar SQL en Supabase;
4. desplegar una versión;
5. activar shadow o transactional;
6. rotar credenciales;
7. activar una política RLS;
8. corregir datos históricos;
9. cambiar la política offline;
10. retirar el motor legacy.

## 8. Próximo trabajo local seguro

Sin tocar producción se puede continuar con:

1. especificación SQL de staging;
2. migración aditiva versionada;
3. contratos de RPC;
4. arnés de pruebas de concurrencia;
5. adaptador de feature flags desactivado por defecto;
6. pruebas de reglas comerciales actuales.

