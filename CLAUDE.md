# Toscana House OS — Guía técnica (fuente de verdad)

Sistema de inventario, ventas y liquidaciones para Toscana House (casa de moda multimarca, Bolivia). Web app PWA. Última auditoría integral: 2026-06-28.

> El `README.md` es boilerplate viejo de Create React App y **no aplica** — el build real es esbuild (ver abajo). Ignorarlo.

## Stack y build

- **React 19** en un único archivo gigante: `App.jsx` (~21.000 líneas). No hay módulos; todo vive ahí.
- **Bundler: esbuild** vía `node build.js` (NO Create React App, NO webpack).
- `npm run build` → `build.js`:
  1. Lee `App.jsx`, le quita los `import`, genera `main.jsx` con el entrypoint.
  2. esbuild → `bundle-<timestamp>.js` (borra los bundles anteriores).
  3. Reescribe `index.html`, `sw.js` y `version.json` con el nuevo timestamp.
  4. Imprime `Build OK — v<timestamp>`.
- **Deploy: Vercel** (`toscana-house.vercel.app`), repo `github.com/jpanezc1/Toscana-house`, branch `main`. Push a main = deploy.

### Workflow obligatorio en cada cambio
Editar `App.jsx` → `npm run build` → `git add` (App.jsx + bundle nuevo + index.html + sw.js + version.json, y `git rm` del bundle viejo) → commit → push. El usuario recarga con "Reinicia para actualizar" (el service worker sirve el bundle nuevo).
**Excepción:** cambios de SQL/RLS en Supabase = acción manual del usuario (no los puedo aplicar yo desde el código).

## Capa de datos

- **Supabase** (Postgres + realtime): `https://uqphxiixdulqscbfyxhz.supabase.co`. La **anon key va embebida en el bundle** (`bundle-*.js`). El modelo de seguridad es "anon key + login a nivel app", NO Supabase Auth.
- **localStorage** espeja todo el estado (`th_inv`, `th_ventas`, `th_cargas`, etc.) → la app funciona offline.
- **Drive sync** opcional (respaldo).

### Sincronización (clave)
- `syncConRespaldo(tipo, payload, fnDirecto)`: intenta escribir a Supabase; si falla o no hay red, encola en el **outbox** (localStorage) para reintento automático. `procesarOutbox()` drena la cola. `ejecutarOpOutbox` mapea cada `tipo` a su función `sb*`.
- **Regla:** toda escritura importante debe ir por `syncConRespaldo` para tener reintento. (El import masivo de productos nuevos NO lo hacía → causaba pérdida silenciosa de códigos; arreglado 2026-06-28, ahora los fallos del batch van al outbox como tipo `"producto"`.)
- **Realtime:** canales en `inventario` y `ventas` propagan cambios a todas las sesiones (caja, marca, otra Mac).

### Tablas Supabase
| Tabla | Contenido | Notas |
|---|---|---|
| `inventario` | productos | campos: `id` (bigint serial), `codigo` (clave única real), `nombre`, `marca_id`, `marca_nombre`, `categoria`, `descripcion`, `subcat`, `precio`, `stock`, `stock_inicial`, `fecha` |
| `ventas` | ventas | `id` (string `V<ts>`), `total`, `subtotal`, `desc_pct`, `metodo_pago`, `mk`, `anulada` |
| `venta_items` | líneas de venta | `venta_id`, `prod_id`, `codigo`, `marca_id`, `cantidad`, `precio_unit`, `subtotal` |
| `retiros` | bajas/retiros | `codigo`, `prod_id`, `cantidad`, `motivo` |
| `cargas_inventario` | registro de cargas/imports | items embebidos |
| `marcas` | marcas custom | **casi vacía por bug RLS — ver abajo** |
| `auditorias`, sesiones de verif | auditoría de inventario | |

> El estado local usa **camelCase** (`stockInicial`), las columnas Supabase usan **snake_case** (`stock_inicial`). `sbActualizarStock` solo escribe `stock`; para `stock_inicial` usar `sbActualizarProductoPatch`.

## Reglas de negocio (NO romper)

- **"Vendidas" SIEMPRE sale del registro de ventas** (`mapVendidasPorCodigo(ventas)`, suma `it.cantidad`, ignora `v.anulada`). **NUNCA** usar `stockInicial - stock` como vendidas (las bajas/reposiciones cambian stock sin ser ventas).
- **`stockInicial` = total histórico recibido** = carga inicial + reposiciones + reimportaciones. Sube en `reponerStock` y en la rama `update` de `handleImportarExcel`.
- **Identidad que debe cuadrar:** `stockInicial = stock + vendidas + bajas`.
- **Roles:** `admin` (todo), `caja` (vende; no da de baja ni repone ni edita/elimina), `marca` (portal de su marca).
- **Import de Excel:** plantilla oficial (MARCA, DESCRIPCIÓN, PRECIO, STOCK, TALLA, CATEGORÍA, COLOR, SKU/CÓDIGO). Código repetido → **suma stock** (no duplica). Mismo código con **categoría distinta** → **bloquea** hasta confirmación. Filas con error → **bloquea** la importación (todo o nada). Verificación post-carga consulta **Supabase** (`sbExistenCodigos`), no el estado local.
- **Etiquetas:** 50×25mm, CODE128 (JsBarcode). Stock N → N etiquetas con el mismo código. Botones: "1 por código" y "1 por unidad".
- **Liquidaciones** (`calcLiqMarca`): prorratea ventas multimarca por `pct = sub/vTot`; el `pct` suma exactamente 1 por venta → cuadre exacto. El dinero sale de `ventas[]`, no de stock.
- **Comisión tarjeta 1.8% = SOLO a la marca, NUNCA al cliente.** El cliente paga subtotal − descuento manual, sin importar el método de pago. La comisión se descuenta en la liquidación de la marca (`descTJ` con `cfg.pctTarjeta`). `descPct` guarda únicamente el descuento manual. Ventas con tarjeta ANTERIORES al 23-jun-2026 llevan el 1.8 embebido en `descPct` (modelo viejo) → `getManualDescPct(v)` maneja la compatibilidad; usarlo SIEMPRE en vez de leer `descPct` directo para mostrar/calcular descuentos.
- **MARCAS** vienen de `MARCAS_SEED` (hardcoded, ids 1-19 + custom) + localStorage, NO de la tabla `marcas` de Supabase.

## Bugs conocidos / gotchas

- **Bug RLS marcas:** la tabla `marcas` de Supabase exige `authenticated` pero la app escribe como `anon` → queda casi vacía. NO afecta liquidaciones (la app usa `MARCAS_SEED`). Fix pendiente = SQL manual: `CREATE POLICY ... FOR ALL USING(true) WITH CHECK(true)`. Toda tabla nueva debe usar RLS permisivo igual que el resto.
- **SistemaTab / Factory Reset:** NO poner `useState`/`useEffect` dentro de IIFEs en `renderIdle` de SistemaTab — rompe el reset (orden de hooks).
- **17 productos "sobra inicial" pendientes de revisión** (unidades que salieron sin registro; ver `toscana house DATA/reconciliacion_stockinicial/DRYRUN_SOBRA_revisar_*.csv`). No bajar `stock_inicial` a ciegas: registrarlas como baja si se confirma pérdida.

## Auditoría 2026-06-28 (resumen)

- **H1/H3:** unificada la definición de "vendidas" (6 sitios que usaban `stockInicial-stock` → ahora `mapVendidasPorCodigo`).
- **H2:** `stockInicial` ahora sube al reponer/reimportar (persistido).
- **Import:** garantía de entrega (fallos → outbox), id robusto (`nextLocalId()`), verificación contra la nube.
- **Eje 3:** anulación restaura stock (ya estaba OK); `vendidosPorProd` ahora excluye anuladas.
- **Eje 4:** liquidaciones cuadran exacto.
- **Eje 5:** sin más bugs de inflado de sumas.
- **Eje 6:** identidad por marca verificada; 14 productos con `stockInicial` roto corregidos (incl. uno en -4); 17 pendientes de revisión.
