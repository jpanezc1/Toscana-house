# Caja Toscana House — dos turnos, una caja física

Estado: tablas de turnos y archivo privado de PDF creados en Supabase el 8/10/2026;
interfaz y apertura obligatoria implementadas y probadas con datos sintéticos.
La activación pública se confirma únicamente al verificar la versión de Vercel.
No usar el registro antiguo `caja_turnos` como si fuera este libro nuevo
(`th_caja_turnos`).

## Flujo operativo

1. Después de iniciar sesión, el personal de caja ve primero la pantalla de turno. Si no hay turno abierto, debe completar la apertura con fecha/hora, usuario y efectivo inicial contado antes de acceder al cobro. Cerrar y volver a abrir la app no crea un turno nuevo.
2. Si ya existe un turno abierto, la pantalla muestra quién lo abrió, el horario y el efectivo inicial. La trabajadora puede continuar en ese mismo turno; no puede abrir una segunda caja física en paralelo. El cambio de turno exige cierre y arqueo del anterior antes de abrir el siguiente.
3. Cada venta nueva se vincula al turno y registra el dinero realmente recibido por efectivo, QR y tarjeta. Un pago mixto se separa en sus componentes; la gift card se muestra aparte porque no vuelve a entrar dinero en ese momento.
4. Si Carolina retira efectivo, registrar monto, destinataria, motivo, fecha/hora, usuario y saldo calculado que queda como caja chica. Se permite más de un retiro en el mismo turno. No se borra un retiro: una corrección queda como reversa auditada.
5. Antes del cierre se muestran el resumen y el PDF preliminar. El cierre definitivo requiere contar el efectivo y confirmar que las ventas del turno llegaron a la nube.
6. Tarde: abrir un turno nuevo con el fondo que efectivamente recibió. El cierre de mañana no se mezcla con el de tarde.
7. Cada cierre se conserva para volver a abrir y descargar el mismo PDF; el envío por WhatsApp es descarga y adjunto manual, no una promesa de envío automático del archivo.
8. El PDF del cierre se guarda en un bucket privado. El historial permite buscar
   cierres anteriores por páginas y abrir el archivo guardado. Si la subida falla,
   el resumen inmutable del cierre permite regenerar y reintentar el PDF.

## Arqueo

`efectivo esperado = apertura + ventas efectivo + aportes efectivo − retiros efectivo − gastos efectivo − devoluciones efectivo`

`diferencia = efectivo contado − efectivo esperado`

El PDF debe mostrar apertura, responsable, horario, cantidad y total de ventas válidas, anuladas por separado, efectivo, QR, tarjeta, desglose de mixtos, gift card por separado, movimientos del cajón (incluidos retiros de Carolina y caja chica resultante), esperado, contado, diferencia y cierre.

## Diferencias verificadas respecto a Re Kids

- La pantalla `CajasTab` actual de Toscana solo guarda dos indicadores de abierto/cerrado en `kv_sync`; no está en el menú principal ni vincula ventas al turno. No es un arqueo.
- Las ventas de Toscana se guardan con reintento diferido. Un cierre hecho solo con datos de nube mientras haya ventas pendientes produciría un faltante aparente. Debe impedirse el cierre definitivo, no el cobro, hasta confirmar la sincronización.
- Las tres cuentas activas de caja ya tienen `auth_id` en `usuarios`, pero el inicio
  de sesión conserva rutas heredadas por contraseña local. La caja nueva exige
  sesión Supabase Auth; se deben probar esas credenciales sin operar datos reales.
- Re Kids calcula el cierre con registros de caja en base de datos y funciones transaccionales. Toscana necesita un registro equivalente, con una sola caja abierta a la vez y un turno por sesión, en lugar de copiar solo la pantalla.
- El asesor de seguridad de Supabase todavía marca `ventas` y `usuarios` con RLS
  desactivado. Las tablas y PDF nuevos sí exigen Auth/RLS, y un trigger protege
  monto, método y turno de ventas ya vinculadas. Queda pendiente migrar la
  seguridad de todas las ventas y cuentas de marca heredadas; no presentar el
  sistema entero como inviolable hasta cerrar esa deuda.

## Despliegue seguro

1. Crear tablas y funciones de caja con permisos y auditoría, sin bloquear ventas existentes. Añadir asociación de venta a turno y desglose por método en la escritura nueva; los registros anteriores se mantienen intactos.
2. Migrar y probar las cuentas de caja a Supabase Auth. No eliminar el acceso actual hasta confirmar que ambas usuarias pueden entrar.
3. Activar modo observación: aperturas, movimientos, cierres y PDF sin obligatoriedad de apertura; conciliar al menos ambos turnos completos contra el libro de ventas y el efectivo.
4. Solo después habilitar la obligación de caja abierta para cobrar. Si hay ventas pendientes de sincronización, permitir seguir cobrando y advertir que no se puede cerrar todavía.

## Pruebas obligatorias

- Apertura mañana → venta efectivo → retiro parcial → cierre → apertura tarde con fondo recibido → venta mixta → cierre.
- Venta anulada antes y después del retiro; gift card; tarjeta; QR; devolución; reintento de sincronización sin duplicación.
- Dos equipos intentando abrir la misma caja; cierre con venta pendiente; reconexión; reimpresión de PDF histórico idéntico.
