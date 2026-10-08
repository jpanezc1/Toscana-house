# Caja Toscana House — dos turnos, una caja física

Estado: el libro de turnos está en producción. La revisión visual/operativa al
estilo ReKids y la migración `caja_flujo_rekids_toscana_20261008.sql` están
preparadas y probadas solo con datos sintéticos; no deben activarse en medio
de un turno abierto. La activación pública se confirma únicamente al verificar
la versión de Vercel después del cierre de tienda.
No usar el registro antiguo `caja_turnos` como si fuera este libro nuevo
(`th_caja_turnos`).

## Flujo operativo

1. Después de iniciar sesión, el personal de caja ve primero la pantalla de turno. Si no hay turno abierto, debe completar la apertura con fecha/hora, usuario y efectivo inicial contado antes de acceder al cobro. Cerrar y volver a abrir la app no crea un turno nuevo.
2. Si ya existe un turno abierto, la pantalla muestra quién lo abrió, el horario y el efectivo inicial. La trabajadora puede continuar en ese mismo turno; no puede abrir una segunda caja física en paralelo. El cambio de turno exige cierre y arqueo del anterior antes de abrir el siguiente.
3. Cada venta nueva se vincula al turno y registra el dinero realmente recibido por efectivo, QR y tarjeta. Un pago mixto se separa en sus componentes; la gift card se muestra aparte porque no vuelve a entrar dinero en ese momento.
4. Anotar cada salida o entrada en el momento: gasto, retiro, depósito o aporte;
   indicar si fue por efectivo o QR. Los movimientos QR quedan fuera del cajón.
   En retiro y depósito se identifica quién recibió el dinero. Se puede adjuntar
   comprobante privado; los retiros de efectivo generan nota por duplicado.
   No se borra un movimiento: una corrección queda como reversa auditada.
5. Antes del cierre se muestran tarjetas de ventas/métodos, arqueo y PDF
   preliminar. La caja sigue abierta. El cierre definitivo requiere contar el
   efectivo y confirmar que las ventas del turno llegaron completas a la nube.
   Si el resumen cambia antes de confirmar, se exige revisarlo de nuevo.
6. Tarde: abrir un turno nuevo con el fondo que efectivamente recibió. El cierre de mañana no se mezcla con el de tarde.
7. Cada cierre se conserva para volver a abrir y descargar el mismo PDF.
   En dispositivos que admiten compartir archivos se puede enviar el PDF con
   la hoja de compartir; en escritorio se descarga y se adjunta manualmente
   a WhatsApp. El enlace de WhatsApp lleva solo el resumen, no adjunta por sí
   mismo el archivo.
8. El PDF del cierre se guarda en un bucket privado. El historial permite buscar
   cierres anteriores por páginas y abrir el archivo guardado. Si la subida falla,
   el resumen inmutable del cierre permite regenerar y reintentar el PDF.

## Arqueo

`efectivo esperado = apertura + ventas efectivo + aportes efectivo − retiros efectivo − gastos efectivo − devoluciones efectivo`

`diferencia = efectivo contado − efectivo esperado`

El PDF debe mostrar apertura, responsable, horario, cantidad y total de ventas
válidas, prendas, anuladas por separado, efectivo, QR, tarjeta, gift card por
separado, movimientos de efectivo y QR fuera de ventas, esperado, contado,
diferencia y firmas de entrega/recepción. QR, tarjeta y gift card no se suman
al efectivo esperado.

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

## Despliegue seguro de la revisión ReKids

1. Confirmar por lectura que no hay turno abierto y que la cola de ventas está
   sincronizada. No probar ventas, movimientos ni stock reales.
2. Aplicar la migración versionada y verificar columnas, RPC y bucket privado.
   La RPC anterior permanece para equipos que aún no se actualizaron.
3. Publicar la interfaz desde `main`, verificar HTML/bundle/version públicos y
   la pestaña visible en escritorio y móvil, sin confirmar un cierre real de prueba.
4. La primera apertura/cierre real del nuevo flujo debe validarse con las
   cajeras y su arqueo físico. Si hay ventas pendientes, pueden seguir
   cobrando; el cierre espera a que se sincronicen.

## Pruebas obligatorias

- Apertura mañana → venta efectivo → retiro parcial → cierre → apertura tarde con fondo recibido → venta mixta → cierre.
- Venta anulada antes y después del retiro; gift card; tarjeta; QR; devolución; reintento de sincronización sin duplicación.
- Dos equipos intentando abrir la misma caja; cierre con venta pendiente; reconexión; reimpresión de PDF histórico idéntico.
