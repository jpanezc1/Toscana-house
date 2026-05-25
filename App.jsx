import { useState, useMemo, useRef, useCallback, useEffect } from "react";

// ════════════════════════════════════════════════════════════
// SUPABASE — Base de datos en la nube
// Proyecto: toscana house | uqphxiixdulqscbfyxhz
// ════════════════════════════════════════════════════════════
const SUPA_URL  = "https://uqphxiixdulqscbfyxhz.supabase.co";
const SUPA_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxcGh4aWl4ZHVscXNjYmZ5eGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzc0NjQsImV4cCI6MjA5MjYxMzQ2NH0.U1EIf4JWqfrvga7CApClLl7nzBuFoPpD8BlicxvfB-w";

// ── Datos de la empresa ──────────────────────────────────
const NIT_EMPRESA   = "690053037";
const PROPIETARIA   = "SYLVIA CAROLINA GRANIER ZALLES";
const DIRECCION_EMP = "Calle La Plata 8 Oeste, Equipetrol";
const TELEFONO_EMP  = "69895217";
const CIUDAD_EMP    = "Santa Cruz, Bolivia";
const SUCURSAL_EMP  = "Casa Matriz";

// Carga Supabase SDK desde CDN
let _supabase = null;
async function getSupabase() {
  if (_supabase) return _supabase;
  if (window.supabase) {
    _supabase = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    return _supabase;
  }
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  _supabase = window.supabase.createClient(SUPA_URL, SUPA_KEY);
  return _supabase;
}

// ── Funciones de sincronización ──────────────────────────
async function sbGuardarProducto(prod) {
  try {
    const db = await getSupabase();
    await db.from("inventario").upsert({
      id: prod.id, codigo: prod.codigo, marca_id: prod.marcaId,
      marca_nombre: prod.marcaNombre, nombre: prod.nombre,
      categoria: prod.categoria, precio: prod.precio,
      stock: prod.stock, stock_inicial: prod.stockInicial, fecha: prod.fecha
    });
  } catch(e) { console.warn("Supabase save prod:", e.message); }
}

async function sbActualizarStock(prodId, nuevoStock) {
  try {
    const db = await getSupabase();
    await db.from("inventario").update({ stock: nuevoStock }).eq("id", prodId);
  } catch(e) { console.warn("Supabase update stock:", e.message); }
}

async function sbGuardarVenta(venta) {
  try {
    const db = await getSupabase();
    await db.from("ventas").upsert({
      id: venta.id, fecha: venta.fecha, hora: venta.hora,
      mk: venta.mk, mes: venta.mes, anio: venta.anio,
      total: venta.total, subtotal: venta.subtotal,
      desc_pct: venta.descPct||0, metodo_pago: venta.metodoPago,
      vendedor: venta.vendedor, etiqueta_img: venta.etiquetaImg||null
    });
    const items = venta.items.map(it => ({
      venta_id: venta.id, prod_id: it.prodId, codigo: it.codigo,
      nombre: it.nombre, marca_id: it.marcaId, marca_nombre: it.marcaNombre,
      cantidad: it.cantidad, precio_unit: it.precioUnit, subtotal: it.subtotal
    }));
    await db.from("venta_items").insert(items);
  } catch(e) { console.warn("Supabase save venta:", e.message); }
}

async function sbGuardarCierre(key, data) {
  try {
    const db = await getSupabase();
    await db.from("cierres").upsert({ id: key, ...data });
  } catch(e) { console.warn("Supabase save cierre:", e.message); }
}

async function sbGuardarRetiro(retiro) {
  try {
    const db = await getSupabase();
    await db.from("retiros").upsert({
      id: retiro.id, fecha: retiro.fecha, hora: retiro.hora,
      prod_id: retiro.prodId, codigo: retiro.codigo,
      nombre: retiro.nombre, marca_id: retiro.marcaId,
      marca_nombre: retiro.marcaNombre, cantidad: retiro.cantidad,
      destinatario: retiro.destinatario, motivo: retiro.motivo||""
    });
  } catch(e) { console.warn("Supabase retiro (tabla puede no existir):", e.message); }
}

async function sbCargarRetiros() {
  try {
    const db = await getSupabase();
    const {data} = await db.from("retiros").select("*").order("created_at");
    return (data||[]).map(r=>({
      id:r.id, fecha:r.fecha, hora:r.hora,
      prodId:r.prod_id, codigo:r.codigo, nombre:r.nombre,
      marcaId:r.marca_id, marcaNombre:r.marca_nombre,
      cantidad:r.cantidad, destinatario:r.destinatario, motivo:r.motivo
    }));
  } catch(e) { console.warn("Supabase load retiros:", e.message); return []; }
}

async function sbCargarTodo() {
  try {
    const db = await getSupabase();
    const [{ data: inv }, { data: ventas }, { data: items }, { data: cierres }] = await Promise.all([
      db.from("inventario").select("*").order("created_at"),
      db.from("ventas").select("*").order("created_at"),
      db.from("venta_items").select("*"),
      db.from("cierres").select("*"),
    ]);

    // Reconstruir ventas con sus items
    const ventasCompletas = (ventas||[]).map(v => ({
      id: v.id, fecha: v.fecha, hora: v.hora, mk: v.mk,
      mes: v.mes, anio: v.anio, total: v.total, subtotal: v.subtotal,
      descPct: v.desc_pct, metodoPago: v.metodo_pago,
      vendedor: v.vendedor, etiquetaImg: v.etiqueta_img,
      items: (items||[]).filter(i=>i.venta_id===v.id).map(i=>({
        prodId: i.prod_id, codigo: i.codigo, nombre: i.nombre,
        marcaId: i.marca_id, marcaNombre: i.marca_nombre,
        cantidad: i.cantidad, precioUnit: i.precio_unit, subtotal: i.subtotal
      }))
    }));

    // Reconstruir inventario
    const invCompleto = (inv||[]).map(p => ({
      id: p.id, codigo: p.codigo, marcaId: p.marca_id,
      marcaNombre: p.marca_nombre, nombre: p.nombre,
      categoria: p.categoria, precio: p.precio,
      stock: p.stock, stockInicial: p.stock_inicial, fecha: p.fecha
    }));

    // Reconstruir cierres
    const cierresObj = {};
    (cierres||[]).forEach(c => { cierresObj[c.id] = { cerrado: c.cerrado, fecha: c.fecha, mk: c.mk }; });

    return { inv: invCompleto, ventas: ventasCompletas, cierres: cierresObj };
  } catch(e) {
    console.warn("Supabase load error:", e.message);
    return null;
  }
}

// Hook de estado de conexión Supabase
function useSupabaseStatus() {
  var _hN100 = useState("connecting"); var status = _hN100[0]; var setStatus = _hN100[1];; // connecting | ok | error
  useEffect(() => {
    getSupabase()
      .then(db => db.from("inventario").select("id").limit(1))
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, []);
  return status;
}


// ════════════════════════════════════════════════════════════
// MOTOR DE CÓDIGOS QR — QRCode.js + ZXing Scanner
// ════════════════════════════════════════════════════════════

// Carga QRCode.js desde CDN (genera QR codes)
let _QRLoaded = false;
let _QRLib = null;
function loadQRCode() {
  return new Promise(res => {
    if (_QRLib) { res(_QRLib); return; }
    if (window.QRCode) { _QRLib = window.QRCode; res(_QRLib); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = () => { _QRLib = window.QRCode; _QRLoaded = true; res(_QRLib); };
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}

// También carga JsBarcode como fallback para impresión
let _JsBarcodeLoaded = false;
function loadJsBarcode() {
  return new Promise(res => {
    if (window.JsBarcode || _JsBarcodeLoaded) { res(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js";
    s.onload = () => { _JsBarcodeLoaded = true; res(true); };
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}

// Carga ZXing para leer códigos desde imagen
let _ZXingLoaded = false;
let _ZXingLib = null;
function loadZXing() {
  return new Promise(res => {
    if (_ZXingLib) { res(_ZXingLib); return; }
    const s = document.createElement("script");
    s.src = "https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js";
    s.onload = () => { _ZXingLib = window.ZXing; res(window.ZXing); };
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
}

// Lee código de barras/QR desde un archivo de imagen
async function leerCodigoDeImagen(file) {
  try {
    const ZXing = await loadZXing();
    if (!ZXing) return null;
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    canvas.getContext("2d").drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const hints = new Map();
    const formats = [
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.EAN_13,   ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.QR_CODE,  ZXing.BarcodeFormat.DATA_MATRIX,
      ZXing.BarcodeFormat.ITF,      ZXing.BarcodeFormat.UPC_A,
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.MultiFormatReader();
    reader.setHints(hints);
    const luminance = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const binaryBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
    const result = reader.decode(binaryBitmap);
    return result?.text || null;
  } catch (e) {
    // Intento con rotaciones si falla el primero
    return null;
  }
}

// Genera QR code como Data URL (imagen PNG)
async function generarSVGBarcode(codigo) {
  try {
    const QRCode = await loadQRCode();
    if (!QRCode) return null;
    // Crear contenedor temporal
    const div = document.createElement("div");
    div.style.display = "none";
    document.body.appendChild(div);
    const qr = new QRCode(div, {
      text: codigo,
      width: 160, height: 160,
      colorDark: "#1A2E1A",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
    // Esperar que se genere
    await new Promise(r => setTimeout(r, 100));
    const canvas = div.querySelector("canvas");
    const img = div.querySelector("img");
    let dataUrl = null;
    if (canvas) dataUrl = canvas.toDataURL("image/png");
    else if (img) dataUrl = img.src;
    document.body.removeChild(div);
    // Devolver como img tag HTML para BarcodeDisplay
    return dataUrl ? `<img src="${dataUrl}" style="width:160px;height:160px;" alt="QR ${codigo}"/>` : null;
  } catch(e) {
    return null;
  }
}

// Componente: muestra QR code inline
function BarcodeDisplay({ codigo, small }) {
  const containerRef = useRef(null);
  var _hN101 = useState(""); var qrDataUrl = _hN101[0]; var setQrDataUrl = _hN101[1];;

  useEffect(() => {
    if (!codigo || !containerRef.current) return;
    setQrDataUrl("");
    loadQRCode().then(QRCode => {
      if (!QRCode || !containerRef.current) return;
      containerRef.current.innerHTML = "";
      try {
        new QRCode(containerRef.current, {
          text: codigo,
          width: small ? 100 : 140,
          height: small ? 100 : 140,
          colorDark: "#1A2E1A",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M,
        });
      } catch(e) {}
    });
  }, [codigo, small]);

  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
      <div ref={containerRef} style={{
        width:small?100:140, height:small?100:140,
        background:"#fff", borderRadius:8, overflow:"hidden",
        display:"flex",alignItems:"center",justifyContent:"center",
      }}>
        {!codigo&&<span style={{fontSize:11,color:"#aaa"}}>QR</span>}
      </div>
      <div style={{fontFamily:"monospace",fontSize:10,color:"#5C8A5C",
        letterSpacing:1,textAlign:"center",maxWidth:small?100:140,
        wordBreak:"break-all"}}>{codigo}</div>
    </div>
  );
}

// Función de impresión de ticket con código QR
async function imprimirTicket(producto, marcaNombre) {
  const win = window.open("","_blank","width=400,height=500");
  if (!win) { alert("Activa las ventanas emergentes para imprimir"); return; }

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Ticket — ${producto.nombre}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
  <style>
    @page { size: 58mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family:'Courier New',monospace; width:58mm; padding:4mm; background:white; color:black; }
    .header { text-align:center; border-bottom:1px dashed #333; padding-bottom:3mm; margin-bottom:3mm; }
    .brand { font-size:14px; font-weight:900; letter-spacing:3px; text-transform:uppercase; }
    .sub { font-size:8px; letter-spacing:4px; color:#555; margin-top:1mm; }
    .producto { font-size:11px; font-weight:bold; text-align:center; margin:2mm 0; text-transform:uppercase; }
    .marca { font-size:9px; text-align:center; color:#444; margin-bottom:2mm; }
    .qr-wrap { display:flex; flex-direction:column; align-items:center; margin:3mm 0; }
    .qr-wrap canvas, .qr-wrap img { width:38mm!important; height:38mm!important; }
    .codigo { text-align:center; font-size:8px; color:#555; font-family:monospace; margin:1mm 0 2mm; word-break:break-all; }
    .precio { text-align:center; font-size:18px; font-weight:900; margin:2mm 0; }
    .footer { border-top:1px dashed #333; padding-top:2mm; text-align:center; font-size:8px; color:#777; letter-spacing:1px; }
    @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">TOSCANA HOUSE</div>
    <div class="sub">CASA DE MODA</div>
  </div>
  <div class="producto">${producto.nombre}</div>
  <div class="marca">${marcaNombre}</div>
  <div class="qr-wrap">
    <div id="qr"></div>
  </div>
  <div class="codigo">${producto.codigo}</div>
  <div class="precio">Bs ${Number(producto.precio).toLocaleString("es-BO")}</div>
  <div class="footer">Toscana House · ${new Date().toLocaleDateString("es-BO")}</div>
  <script>
    window.onload = function() {
      try {
        new QRCode(document.getElementById("qr"), {
          text: "${producto.codigo}",
          width: 144, height: 144,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch(e) {}
      setTimeout(function() { window.print(); }, 800);
    };
  <\/script>
</body>
</html>`);
  win.document.close();
}


// ════════════════════════════════════════════════════════════
// GOOGLE DRIVE — Apps Script integration
// ════════════════════════════════════════════════════════════

// 🔧 CONFIGURACIÓN — Pega aquí la URL de tu Google Apps Script
// Instrucciones en el panel de Configuración → Drive
const APPS_SCRIPT_URL = ""; // ← Tu URL aquí

async function drivePost(action, payload) {
  if (!APPS_SCRIPT_URL) return { ok: false, error: "URL no configurada" };
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Hook que maneja el estado de sincronización
function useDriveSync() {
  var _hN102 = useState(function(){ try{return localStorage.getItem("th_drive_url")||"";}catch{return "";} }); var url = _hN102[0]; var setUrl = _hN102[1];
  var _hN103 = useState(false); var syncing = _hN103[0]; var setSyncing = _hN103[1];;
  var _hN104 = useState(function(){
    try { return JSON.parse(localStorage.getItem("th_sync_log") || "[]"); } catch { return []; }
  }); var syncLog = _hN104[0]; var setSyncLog = _hN104[1];

  function saveUrl(u) {
    setUrl(u);
    localStorage.setItem("th_drive_url", u);
  }

  function addLog(entry) {
    setSyncLog(prev => {
      const updated = [entry, ...prev].slice(0, 50);
      localStorage.setItem("th_sync_log", JSON.stringify(updated));
      return updated;
    });
  }

  async function syncVenta(venta) {
    if (!url) return;
    setSyncing(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ action: "nueva_venta", venta }),
      });
      const data = await res.json();
      addLog({
        tipo: "venta", id: venta.id, fecha: venta.fecha, hora: venta.hora,
        ok: data.ok, marcas: data.marcas, error: data.error,
      });
    } catch (e) {
      addLog({ tipo: "venta", id: venta.id, fecha: venta.fecha, hora: venta.hora, ok: false, error: e.message });
    }
    setSyncing(false);
  }

  async function syncProducto(producto) {
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ action: "nuevo_producto", producto }),
      });
      const data = await res.json();
      addLog({ tipo: "producto", codigo: producto.codigo, fecha: hoy(), ok: data.ok, error: data.error });
    } catch (e) {
      addLog({ tipo: "producto", codigo: producto.codigo, fecha: hoy(), ok: false, error: e.message });
    }
  }

  async function syncCierre(mes, anio, ventas) {
    if (!url) return { ok: false, error: "Sin URL" };
    setSyncing(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ action: "cierre_mensual", mes, anio, ventas }),
      });
      const data = await res.json();
      addLog({ tipo: "cierre", mes, anio, fecha: hoy(), ok: data.ok, error: data.error });
      setSyncing(false);
      return data;
    } catch (e) {
      addLog({ tipo: "cierre", mes, anio, fecha: hoy(), ok: false, error: e.message });
      setSyncing(false);
      return { ok: false, error: e.message };
    }
  }

  async function testConnection() {
    if (!url) return { ok: false, error: "Ingresa la URL primero" };
    try {
      const res = await fetch(url);
      const data = await res.json();
      return data;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { url, saveUrl, syncing, syncLog, syncVenta, syncProducto, syncCierre, testConnection };
}

// Indicador de Drive en la UI
function DriveIndicator({ syncing, connected }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
      <div style={{
        width:8, height:8, borderRadius:"50%",
        background: syncing ? C.amber : connected ? C.green : C.label3,
        boxShadow: syncing ? `0 0 6px ${C.amber}` : connected ? `0 0 6px ${C.green}` : "none",
        transition:"all .3s",
        animation: syncing ? "pulse 1s infinite" : "none",
      }}/>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
      <span style={{ fontSize:11, color: syncing?C.amber:connected?C.green:C.label3, fontFamily:FONT }}>
        {syncing ? "Sync…" : connected ? "Drive ✓" : "Drive"}
      </span>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   TOSCANA HOUSE — iOS Native Design v3.0
   · Bottom Tab Bar (iPhone style)
   · Safe area insets  · 44pt tap targets
   · Sheets deslizantes · SF Pro-style typography
   · Dark mode premium  · Haptic-feel micro-animations
═══════════════════════════════════════════════════════════ */

// ── Paleta Profesional — Toscana House (iZi-style blue/white) ──
const C = {
  bg0:   "#F4F7FB",       // blue-gray page background
  bg1:   "#FFFFFF",       // white cards
  bg2:   "#F8FAFD",       // subtle card fill
  bg3:   "#EBF1F9",       // blue-tinted section bg
  label:    "#0F172A",    // slate-900
  label2:   "#334155",    // slate-700
  label3:   "#64748B",    // slate-500
  label4:   "rgba(15,23,42,0.15)",
  sep:   "rgba(100,116,139,0.14)",
  sepH:  "rgba(100,116,139,0.28)",
  gold:  "#1565C0",       // primary blue (kept key name for compat)
  goldL: "#1976D2",       // blue lighter
  goldD: "#0D47A1",       // blue darker
  accent:"#90CAF9",       // blue accent
  cream: "#F4F7FB",
  green: "#2E7D32",       // success green
  red:   "#C62828",       // error red
  blue:  "#1565C0",       // alias for gold
  amber: "#E65100",       // warning orange
  indigo:"#3949AB",       // indigo/violet
  tabPos:"#1565C0",       // Caja — blue
  tabInv:"#0277BD",       // Inventario — dark blue
  tabMar:"#6A1B9A",       // Marcas — purple
  tabVen:"#00695C",       // Ventas — teal
  tabLiq:"#AD1457",       // Liquidar — pink
  fill1: "rgba(21,101,192,0.04)",
  fill2: "rgba(21,101,192,0.09)",
  fill3: "rgba(21,101,192,0.16)",
  stockOk:  "#E8F5E9",
  stockLow: "#FFF8E1",
  stockOut: "#FFEBEE",
  stockSold:"#EDE7F6",
  greenBg:  "#E8F5E9",
  redBg:    "#FFEBEE",
  amberBg:  "#FFF8E1",
};

const ALQUILERES = {
  1:  { alquiler: 2000, comision: 0 },   // Donaire
  2:  { alquiler: 2700, comision: 0 },   // Ramona
  3:  { alquiler: 1850, comision: 0 },   // Materia
  4:  { alquiler: 1900, comision: 3 },   // Dual
  5:  { alquiler: 2000, comision: 3 },   // Sensually
  6:  { alquiler: 1500, comision: 0 },   // Glowphoria
  7:  { alquiler: 2100, comision: 0 },   // Monas
  8:  { alquiler: 2100, comision: 0 },   // Bonita
  9:  { alquiler: 2300, comision: 3 },   // She
  10: { alquiler: 800,  comision: 3 },   // Ellá
  11: { alquiler: 1950, comision: 3 },   // Magenta
  12: { alquiler: 1750, comision: 3 },   // Ikawi
  13: { alquiler: 1200, comision: 0 },   // Romero Brand
  14: { alquiler: 1950, comision: 0 },   // Minimal
  15: { alquiler: 1950, comision: 3 },   // Comfy
  16: { alquiler: 1100, comision: 3 },   // Essenza
  17: { alquiler: 1500, comision: 3 },   // Doña Mamushka
};

const LOGO_B64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAQ4BDgDASIAAhEBAxEB/8QAHgABAAMBAAMBAQEAAAAAAAAAAAcICQYEBQoDAgH/xABfEAEAAQMDAgMDBgcIDQYNBAMAAQIDBAUGBwgRCRIhEzE4FCJBdrS1FTJRYXF1syM2N1h0gZGWFhcYGUJSU5ShxdHT1CQzVYax1SU0NTlWV2Jyc4KSssFDRFRjw+Hk/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ANPQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/9k=";

const MARCAS = [
  {id:1,  nombre:"Donaire",       color:"#A8C5A0", emoji:"✨"},
  {id:2,  nombre:"Ramona",        color:"#F4A8A8", emoji:"🌸"},
  {id:3,  nombre:"Materia",       color:"#A8D4B0", emoji:"🌿"},
  {id:4,  nombre:"Dual",          color:"#A8BCD4", emoji:"◈"},
  {id:5,  nombre:"Sensually",     color:"#F4A8C8", emoji:"💫"},
  {id:6,  nombre:"Glowphoria",    color:"#F4D4A8", emoji:"✦"},
  {id:7,  nombre:"Monas",         color:"#C8A8D4", emoji:"🔮"},
  {id:8,  nombre:"Bonita",        color:"#F4BCA8", emoji:"🌺"},
  {id:9,  nombre:"She",           color:"#A8D4C4", emoji:"◎"},
  {id:10, nombre:"Ellá",          color:"#D4C4A8", emoji:"🍂"},
  {id:11, nombre:"Magenta",       color:"#D4A8BC", emoji:"◆"},
  {id:12, nombre:"Ikawi",         color:"#A8CCD4", emoji:"🌊"},
  {id:13, nombre:"Romero Brand",  color:"#C4B89A", emoji:"⚡"},
  {id:14, nombre:"Minimal",       color:"#C4C4C4", emoji:"◻"},
  {id:15, nombre:"Comfy",         color:"#C8B8A8", emoji:"☁"},
  {id:16, nombre:"Essenza",       color:"#D4C8A0", emoji:"🕊"},
  {id:17, nombre:"Doña Mamushka", color:"#F4ACA8", emoji:"🎀"},
];

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
               "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const PAGOS = [
  {id:"efectivo", label:"Efectivo", icon:"💵", desc:0,   color:"#4A9B6F"},
  {id:"qr",       label:"QR",       icon:"📱", desc:0,   color:"#5B8DB8"},
  {id:"tarjeta",  label:"Tarjeta",  icon:"💳", desc:2.5, color:"#C8922A"},
];

// ── Helpers pago mixto ────────────────────────────────────
function labelPago(mp){
  if(!mp) return "—";
  if(mp.startsWith("mixto|")) return "Mixto";
  return PAGOS.find(p=>p.id===mp)?.label||mp;
}
function colorPago(mp){
  if(!mp) return "#4A9B6F";
  if(mp.startsWith("mixto|")) return "#6C5CE7";
  return PAGOS.find(p=>p.id===mp)?.color||"#4A9B6F";
}
function iconPago(mp){
  if(!mp) return "";
  if(mp.startsWith("mixto|")) return "🔀";
  return PAGOS.find(p=>p.id===mp)?.icon||"";
}

// ── Helpers ───────────────────────────────────────────────
const $    = n => "Bs " + new Intl.NumberFormat("es-BO",{minimumFractionDigits:0,maximumFractionDigits:2}).format(n||0);
const hoy  = () => new Date().toISOString().slice(0,10);
const hora = () => new Date().toLocaleTimeString("es-BO",{hour:"2-digit",minute:"2-digit"});
const mkKey= (m,a) => `${a}-${String(m+1).padStart(2,"0")}`;
const genCod=(mid,nombre,idx)=>{
  const m=MARCAS.find(x=>x.id===mid);
  const p=(m?.nombre||"TOS").replace(/[^a-zA-Z]/g,"").toUpperCase().slice(0,3);
  const s=(nombre||"ITEM").replace(/[^a-zA-Z0-9]/g,"").toUpperCase().slice(0,4);
  return `${p}-${s}-${String(idx).padStart(4,"0")}`;
};

// ════════════════════════════════════════════════════════════
// EXCEL ENGINE — SheetJS (xlsx) generador de reportes
// Genera .xlsx real con múltiples pestañas, estilos y fórmulas
// ════════════════════════════════════════════════════════════

// Carga SheetJS dinámicamente desde CDN (una sola vez)
let _XLSXPromise = null;
function loadXLSX() {
  if (_XLSXPromise) return _XLSXPromise;
  _XLSXPromise = new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(window.XLSX); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload  = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("No se pudo cargar SheetJS"));
    document.head.appendChild(s);
  });
  return _XLSXPromise;
}

// Helper: descargar blob como archivo
function descargarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

// ── REPORTE MENSUAL COMPLETO (todas las marcas, una pestaña c/u) ──
async function generarExcelMensual(ventas, inventario, mes, anio, setGenerando) {
  setGenerando(true);
  try {
    const XLSX  = await loadXLSX();
    const MK    = mkKey(mes, anio);
    const mesNom = MESES[mes];
    const wb    = XLSX.utils.book_new();

    // ── Pestaña RESUMEN GENERAL ──────────────────────────────
    const resumenRows = [
      [`TOSCANA HOUSE — REPORTE MENSUAL ${mesNom.toUpperCase()} ${anio}`],
      [`Generado: ${new Date().toLocaleString("es-BO")}`],
      [],
      ["Marca","Ventas brutas (Bs)","Comisión 10%","Neto a pagar (Bs)","N° Ventas","Unidades vendidas","Estado"],
    ];

    let totalBruto = 0, totalNeto = 0, totalVentas = 0;
    const ventasMes = ventas.filter(v => v.mk === MK);

    MARCAS.forEach(m => {
      const vM   = ventasMes.filter(v => v.items.some(i => i.marcaId === m.id));
      const bruto= vM.reduce((s,v) => s + v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0), 0);
      const uds  = vM.reduce((s,v) => s + v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.cantidad,0), 0);
      totalBruto += bruto; totalNeto += bruto * 0.9; totalVentas += vM.length;
      resumenRows.push([
        m.nombre,
        bruto,
        +(bruto * 0.1).toFixed(2),
        +(bruto * 0.9).toFixed(2),
        vM.length,
        uds,
        bruto > 0 ? "Con ventas" : "Sin ventas",
      ]);
    });

    resumenRows.push(
      [],
      ["TOTAL GENERAL", totalBruto, +(totalBruto*0.1).toFixed(2), +(totalNeto).toFixed(2), totalVentas, "", ""]
    );

    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
    wsResumen["!cols"] = [{wch:22},{wch:20},{wch:16},{wch:20},{wch:12},{wch:18},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsResumen, "📊 Resumen");

    // ── Una pestaña por cada marca ───────────────────────────
    MARCAS.forEach(m => {
      const vMarca = ventasMes.filter(v => v.items.some(i => i.marcaId === m.id));
      
      const rows = [
        [`${m.emoji} ${m.nombre.toUpperCase()} — ${mesNom} ${anio}`],
        [],
        ["ID Venta","Fecha","Hora","Código","Producto","Categoría","Cantidad","Precio Unit. (Bs)","Subtotal (Bs)","Desc%","Método Pago","Vendedor"],
      ];

      let brutoMarca = 0;
      if (vMarca.length === 0) {
        rows.push(["Sin ventas en este período"]);
      } else {
        vMarca.forEach(v => {
          v.items.filter(i => i.marcaId === m.id).forEach(it => {
            rows.push([
              v.id, v.fecha, v.hora,
              it.codigo, it.nombre, it.categoria||"",
              it.cantidad, it.precioUnit, it.subtotal,
              v.descPct||0, v.metodoPago, v.vendedor||"Tienda"
            ]);
            brutoMarca += it.subtotal;
          });
        });
      }

      // Totales
      rows.push(
        [],
        ["","","","","","","","VENTAS BRUTAS",brutoMarca,"","",""],
        ["","","","","","","","COMISIÓN 10%",+(brutoMarca*0.1).toFixed(2),"","",""],
        ["","","","","","","","NETO A PAGAR",+(brutoMarca*0.9).toFixed(2),"","",""],
      );

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{wch:16},{wch:12},{wch:8},{wch:16},{wch:24},{wch:14},{wch:8},{wch:18},{wch:16},{wch:6},{wch:14},{wch:14}];
      
      // Nombre de pestaña max 31 chars (límite Excel)
      const tabName = m.nombre.slice(0, 28);
      XLSX.utils.book_append_sheet(wb, ws, tabName);
    });

    // ── Pestaña STOCK ACTUAL ─────────────────────────────────
    const stockRows = [
      [`TOSCANA HOUSE — REPORTE DE STOCK — ${mesNom} ${anio}`],
      [],
      ["Código","Producto","Marca","Categoría","Precio (Bs)","Stock inicial","Stock actual","Vendidas","% Vendido","Estado"],
    ];

    MARCAS.forEach(m => {
      const prods = inventario.filter(i => i.marcaId === m.id);
      prods.forEach(p => {
        const vendidas = p.stockInicial - p.stock;
        const pct = p.stockInicial > 0 ? Math.round((vendidas/p.stockInicial)*100) : 0;
        stockRows.push([
          p.codigo, p.nombre, m.nombre, p.categoria||"",
          p.precio, p.stockInicial, p.stock, vendidas,
          pct + "%",
          p.stock === 0 ? "AGOTADO" : p.stock < 3 ? "BAJO STOCK" : "OK"
        ]);
      });
    });

    const wsStock = XLSX.utils.aoa_to_sheet(stockRows);
    wsStock["!cols"] = [{wch:18},{wch:26},{wch:18},{wch:14},{wch:14},{wch:14},{wch:13},{wch:10},{wch:10},{wch:12}];
    XLSX.utils.book_append_sheet(wb, wsStock, "📦 Stock");

    // ── Generar y descargar ──────────────────────────────────
    // Aplicar bordes a todas las hojas
    wb.SheetNames.forEach(name => {
      aplicarBordesSheet(wb.Sheets[name], XLSX);
    });

    const wbOut  = XLSX.write(wb, { bookType:"xlsx", type:"array" });
    const blob   = new Blob([wbOut], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    descargarArchivo(blob, `ToscanaHouse_${mesNom}_${anio}.xlsx`);

  } catch(e) {
    alert("Error generando Excel: " + e.message);
  }
  setGenerando(false);
}

// ── Aplicar bordes solo a celdas con datos ────────────────
function aplicarBordesSheet(ws, XLSX) {
  if (!ws || !ws["!ref"]) return;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const borderStyle = {
    top:    {style:"thin", color:{rgb:"B8D4B8"}},
    bottom: {style:"thin", color:{rgb:"B8D4B8"}},
    left:   {style:"thin", color:{rgb:"B8D4B8"}},
    right:  {style:"thin", color:{rgb:"B8D4B8"}},
  };
  const headerBorder = {
    top:    {style:"medium", color:{rgb:"5C8A5C"}},
    bottom: {style:"medium", color:{rgb:"5C8A5C"}},
    left:   {style:"thin",   color:{rgb:"5C8A5C"}},
    right:  {style:"thin",   color:{rgb:"5C8A5C"}},
  };
  for (let R = range.s.r; R <= range.e.r; R++) {
    let rowHasData = false;
    for (let CC = range.s.c; CC <= range.e.c; CC++) {
      const addr = XLSX.utils.encode_cell({r:R, c:CC});
      if (ws[addr] && ws[addr].v !== undefined && ws[addr].v !== "") {
        rowHasData = true; break;
      }
    }
    if (!rowHasData) continue;
    for (let CC = range.s.c; CC <= range.e.c; CC++) {
      const addr = XLSX.utils.encode_cell({r:R, c:CC});
      if (!ws[addr]) ws[addr] = {t:"z", v:""};
      ws[addr].s = ws[addr].s || {};
      ws[addr].s.border = R === range.s.r ? headerBorder : borderStyle;
      // Header row: green background
      if (R === range.s.r || R <= 1) {
        ws[addr].s.fill = {fgColor:{rgb:"E8F5E8"}};
        ws[addr].s.font = {bold:true, color:{rgb:"3D6B3D"}};
      }
      // Total rows: light cream background
      if (ws[addr].v && String(ws[addr].v).includes("NETO") || String(ws[addr].v).includes("TOTAL") || String(ws[addr].v).includes("Bruto")) {
        ws[addr].s.fill = {fgColor:{rgb:"F5F0E8"}};
        ws[addr].s.font = {bold:true};
      }
    }
  }
}

// ── REPORTE INDIVIDUAL DE UNA MARCA ─────────────────────────
async function generarExcelMarca(marca, ventas, inventario, setGenerando) {
  setGenerando(true);
  try {
    const XLSX = await loadXLSX();
    const wb   = XLSX.utils.book_new();

    // Agrupar ventas por mes
    const porMes = {};
    ventas.forEach(v => {
      if (!v.items.some(i => i.marcaId === marca.id)) return;
      if (!porMes[v.mk]) porMes[v.mk] = { mk: v.mk, mes: v.mes, anio: v.anio, ventas: [] };
      porMes[v.mk].ventas.push(v);
    });

    const periodos = Object.values(porMes).sort((a,b) => b.mk.localeCompare(a.mk));

    if (periodos.length === 0) {
      // Hoja vacía con mensaje
      const ws = XLSX.utils.aoa_to_sheet([[`${marca.emoji} ${marca.nombre}`,],[],["Sin ventas registradas"]]);
      XLSX.utils.book_append_sheet(wb, ws, marca.nombre.slice(0,28));
    } else {
      // Una pestaña por período
      periodos.forEach(p => {
        const mesNom = MESES[p.mes];
        const rows = [
          [`${marca.emoji} ${marca.nombre} — ${mesNom} ${p.anio}`],
          [],
          ["ID Venta","Fecha","Hora","Código","Producto","Categoría","Cantidad","Precio Unit.","Subtotal","Desc%","Pago","Vendedor"],
        ];
        let bruto = 0;
        p.ventas.forEach(v => {
          v.items.filter(i => i.marcaId === marca.id).forEach(it => {
            rows.push([v.id, v.fecha, v.hora, it.codigo, it.nombre, it.categoria||"", it.cantidad, it.precioUnit, it.subtotal, v.descPct||0, v.metodoPago, v.vendedor||"Tienda"]);
            bruto += it.subtotal;
          });
        });
        rows.push([], ["","","","","","","","Bruto",bruto,"","",""], ["","","","","","","","Comisión 10%",+(bruto*.1).toFixed(2),"","",""], ["","","","","","","","Neto",+(bruto*.9).toFixed(2),"","",""]);
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = [{wch:16},{wch:12},{wch:8},{wch:16},{wch:24},{wch:14},{wch:8},{wch:16},{wch:14},{wch:6},{wch:12},{wch:14}];
        XLSX.utils.book_append_sheet(wb, ws, `${mesNom} ${p.anio}`.slice(0,31));
      });
    }

    // Pestaña stock de la marca
    const prods = inventario.filter(i => i.marcaId === marca.id);
    const stockRows = [
      [`📦 STOCK — ${marca.nombre}`],
      [],
      ["Código","Producto","Categoría","Precio (Bs)","Stock inicial","Stock actual","Vendidas","% Vendido","Estado","Fecha ingreso"],
    ];
    prods.forEach(p => {
      const vendidas = p.stockInicial - p.stock;
      const pct = p.stockInicial > 0 ? Math.round((vendidas/p.stockInicial)*100) : 0;
      stockRows.push([p.codigo, p.nombre, p.categoria||"", p.precio, p.stockInicial, p.stock, vendidas, pct+"%", p.stock===0?"AGOTADO":p.stock<3?"BAJO STOCK":"OK", p.fecha]);
    });
    if (prods.length === 0) stockRows.push(["Sin productos registrados"]);
    const wsStock = XLSX.utils.aoa_to_sheet(stockRows);
    wsStock["!cols"] = [{wch:18},{wch:26},{wch:14},{wch:14},{wch:14},{wch:13},{wch:10},{wch:10},{wch:12},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsStock, "Stock");

    wb.SheetNames.forEach(name => { aplicarBordesSheet(wb.Sheets[name], XLSX); });
    const wbOut = XLSX.write(wb, { bookType:"xlsx", type:"array" });
    const blob  = new Blob([wbOut], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    descargarArchivo(blob, `TH_${marca.nombre.replace(/ /g,"_")}_Historial.xlsx`);

  } catch(e) {
    alert("Error generando Excel: " + e.message);
  }
  setGenerando(false);
}

// ── REPORTE STOCK COMPLETO ────────────────────────────────
async function generarExcelStock(inventario, setGenerando) {
  setGenerando(true);
  try {
    const XLSX = await loadXLSX();
    const wb   = XLSX.utils.book_new();

    // Pestaña general
    const rows = [
      ["TOSCANA HOUSE — REPORTE DE STOCK COMPLETO"],
      [`Generado: ${new Date().toLocaleString("es-BO")}`],
      [],
      ["Código","Producto","Marca","Categoría","Precio (Bs)","Stock inicial","Stock actual","Vendidas","% Vendido","Estado","Fecha ingreso"],
    ];
    MARCAS.forEach(m => {
      inventario.filter(i => i.marcaId === m.id).forEach(p => {
        const vendidas = p.stockInicial - p.stock;
        const pct = p.stockInicial > 0 ? Math.round((vendidas/p.stockInicial)*100) : 0;
        rows.push([p.codigo, p.nombre, m.nombre, p.categoria||"", p.precio, p.stockInicial, p.stock, vendidas, pct+"%", p.stock===0?"AGOTADO":p.stock<3?"BAJO STOCK":"OK", p.fecha]);
      });
    });
    const wsAll = XLSX.utils.aoa_to_sheet(rows);
    wsAll["!cols"] = [{wch:18},{wch:26},{wch:18},{wch:14},{wch:14},{wch:14},{wch:13},{wch:10},{wch:10},{wch:12},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsAll, "Todo el Stock");

    // Una pestaña por marca
    MARCAS.forEach(m => {
      const prods = inventario.filter(i => i.marcaId === m.id);
      if (prods.length === 0) return;
      const mRows = [
        [`${m.emoji} ${m.nombre}`],[],
        ["Código","Producto","Categoría","Precio (Bs)","Stock inicial","Stock actual","Vendidas","Estado"],
      ];
      prods.forEach(p => {
        const vendidas = p.stockInicial - p.stock;
        mRows.push([p.codigo, p.nombre, p.categoria||"", p.precio, p.stockInicial, p.stock, vendidas, p.stock===0?"AGOTADO":p.stock<3?"BAJO":""]);
      });
      const ws = XLSX.utils.aoa_to_sheet(mRows);
      ws["!cols"] = [{wch:18},{wch:26},{wch:14},{wch:14},{wch:14},{wch:13},{wch:10},{wch:12}];
      XLSX.utils.book_append_sheet(wb, ws, m.nombre.slice(0,28));
    });

    wb.SheetNames.forEach(name => { aplicarBordesSheet(wb.Sheets[name], XLSX); });
    const wbOut = XLSX.write(wb, { bookType:"xlsx", type:"array" });
    const blob  = new Blob([wbOut], { type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    descargarArchivo(blob, `TH_Stock_${new Date().toISOString().slice(0,10)}.xlsx`);
  } catch(e) {
    alert("Error generando Excel: " + e.message);
  }
  setGenerando(false);
}

function exportCSV(marca,ventas,mes,anio){
  const MK=mkKey(mes,anio);
  const vm=ventas.filter(v=>v.mk===MK&&v.items.some(i=>i.marcaId===marca.id));
  const rows=[["ID","Fecha","Hora","Código","Producto","Cant.","Precio","Subtotal","Desc%","Pago"]];
  let bruto=0;
  vm.forEach(v=>v.items.filter(i=>i.marcaId===marca.id).forEach(it=>{
    rows.push([v.id,v.fecha,v.hora,it.codigo,it.nombre,it.cantidad,it.precioUnit,it.subtotal,v.descPct||0,v.metodoPago]);
    bruto+=it.subtotal;
  }));
  rows.push([],["Bruto","","","","","","",bruto,"",""],
               ["Comisión 10%","","","","","","",-bruto*.1,"",""],
               ["Neto","","","","","","",bruto*.9,"",""]);
  const csv=rows.map(r=>r.map(c=>String(c).includes(",")?`"${c}"`:c).join(",")).join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`TH_${marca.nombre.replace(/ /g,"_")}_${MESES[mes]}_${anio}.csv`;
  a.click();URL.revokeObjectURL(url);
}

function exportTodasCSV(ventas,mes,anio){
  const MK=mkKey(mes,anio);
  const rows=[["Marca","ID","Fecha","Hora","Código","Producto","Cant.","Precio","Subtotal","Pago"]];
  ventas.filter(v=>v.mk===MK).forEach(v=>v.items.forEach(it=>{
    const m=MARCAS.find(x=>x.id===it.marcaId);
    rows.push([m?.nombre||"",v.id,v.fecha,v.hora,it.codigo,it.nombre,it.cantidad,it.precioUnit,it.subtotal,v.metodoPago]);
  }));
  const csv=rows.map(r=>r.join(",")).join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`TH_TODAS_${MESES[mes]}_${anio}.csv`;
  a.click();URL.revokeObjectURL(url);
}

function sendWA(venta){
  const lines=venta.items.map(it=>{const m=MARCAS.find(x=>x.id===it.marcaId);return `• ${it.nombre} (${m?.nombre}) x${it.cantidad} = ${$(it.subtotal)}`;});
  const msg=[`🏡 *TOSCANA HOUSE — ${venta.id}*`,`📅 ${venta.fecha} ${venta.hora}`,`💳 ${labelPago(venta.metodoPago)}${venta.descPct?` (-${venta.descPct}%)`:""}`,"",  ...lines,"",`💰 *TOTAL: ${$(venta.total)}*`].join("\n");
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,"_blank");
}

// ── Número a letras (es-BO) ───────────────────────────────
function numeroALetras(monto){
  const entero=Math.floor(monto), cts=Math.round((monto-entero)*100);
  const un=["","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve",
    "diez","once","doce","trece","catorce","quince","dieciséis","diecisiete","dieciocho","diecinueve"];
  const de=["","","veinte","treinta","cuarenta","cincuenta","sesenta","setenta","ochenta","noventa"];
  const ct=["","ciento","doscientos","trescientos","cuatrocientos","quinientos","seiscientos","setecientos","ochocientos","novecientos"];
  function m1000(n){
    if(!n)return "";
    let r="";
    const c=Math.floor(n/100),d=n%100;
    if(c)r+=(c===1&&!d?"cien":ct[c])+(d?" ":"");
    if(d<20)r+=un[d];
    else{r+=de[Math.floor(d/10)];if(d%10)r+=" y "+un[d%10];}
    return r.trim();
  }
  function conv(n){
    if(!n)return "cero";
    let r="";
    if(n>=1000){const m=Math.floor(n/1000);r+=(m===1?"mil":m1000(m)+" mil")+" ";n%=1000;}
    if(n)r+=m1000(n);
    return r.trim();
  }
  return (conv(entero)+" "+String(cts).padStart(2,"0")+"/100 BOLIVIANOS").toUpperCase();
}

// ── Imprimir nota de venta formal ─────────────────────────
function imprimirNotaVenta(venta, numSecuencial){
  const win=window.open("","_blank","width=860,height=900");
  if(!win){alert("Activa las ventanas emergentes para imprimir");return;}
  const num=numSecuencial||venta.id.replace(/\D/g,"").slice(-4).padStart(4,"0");
  const fmt2=n=>Number(n||0).toLocaleString("es-BO",{minimumFractionDigits:2,maximumFractionDigits:2});
  const subtotalBruto=venta.items.reduce((s,i)=>s+i.precioUnit*i.cantidad,0);
  const descAdicional=subtotalBruto-venta.total;
  const rows=venta.items.map(it=>`
    <tr>
      <td>${it.codigo}</td>
      <td>${it.nombre}${it.marcaNombre?" — "+it.marcaNombre:""}</td>
      <td style="text-align:center">UNIDAD (BIENES)</td>
      <td style="text-align:center">${it.cantidad}</td>
      <td style="text-align:right">${fmt2(it.precioUnit)}</td>
      <td style="text-align:right">${venta.descPct?venta.descPct+"%":"—"}</td>
      <td style="text-align:right">${fmt2(it.subtotal)}</td>
    </tr>`).join("");
  win.document.write(`<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>Nota de Venta N° ${num}</title>
<style>
  @page{size:A4;margin:20mm 18mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;
    padding-bottom:12px;border-bottom:2px solid #111;margin-bottom:14px}
  .logo{font-size:20px;font-weight:900;letter-spacing:3px;text-transform:uppercase}
  .logo-sub{font-size:7px;letter-spacing:5px;color:#666;margin-top:2px}
  .nv-r{text-align:right}
  .nv-r h2{font-size:15px;font-weight:700;text-transform:uppercase}
  .nv-r p{font-size:11px;margin-top:3px}
  .prop{font-size:13px;font-weight:700;text-transform:uppercase;
    border-bottom:1px solid #ccc;padding-bottom:6px;margin-bottom:12px}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:4px 20px;margin-bottom:14px;font-size:11px}
  .lbl{color:#666;font-size:9px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  thead tr{background:#f0f0f0}
  th,td{padding:6px 8px;border:1px solid #ccc;font-size:10px;vertical-align:middle}
  th{font-weight:700;text-transform:uppercase;font-size:9px}
  .tots{margin-left:auto;width:280px;border-collapse:collapse}
  .tots td{padding:3px 8px;font-size:11px;border:none}
  .tots td:last-child{text-align:right;font-weight:600}
  .tots td:first-child{color:#555}
  .tf td{font-weight:800;font-size:14px;border-top:2px solid #111!important;padding-top:7px!important}
  .letras{background:#f8f8f8;border:1px solid #ccc;padding:8px 12px;border-radius:4px;
    font-size:10px;margin-bottom:14px}
  .foot{border-top:1px dashed #aaa;padding-top:8px;text-align:center;font-size:9px;color:#888;margin-top:12px}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="hdr">
  <div>
    <div class="logo">Toscana House</div>
    <div class="logo-sub">CASA DE MODA</div>
  </div>
  <div class="nv-r">
    <h2>Nota de venta</h2>
    <p>NIT &nbsp; ${NIT_EMPRESA}</p>
    <p>Nota de venta N° &nbsp; <strong>${num}</strong></p>
  </div>
</div>
<div class="prop">${PROPIETARIA}</div>
<div class="info">
  <div><div class="lbl">Sucursal</div>${SUCURSAL_EMP}</div>
  <div><div class="lbl">Lugar y fecha</div>${CIUDAD_EMP}, ${venta.fecha} ${venta.hora}</div>
  <div><div class="lbl">Dirección</div>${DIRECCION_EMP}</div>
  <div><div class="lbl">Vendedores</div>${venta.vendedor||"Tienda"}</div>
  <div><div class="lbl">Teléfono</div>${TELEFONO_EMP}</div>
  <div><div class="lbl">Método de pago</div>${labelPago(venta.metodoPago)}</div>
</div>
<table>
  <thead>
    <tr><th>Código</th><th>Descripción</th><th>Unidad</th>
    <th>Cant.</th><th>Precio Unit.</th><th>Desc.</th><th>Subtotal</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div style="display:flex;justify-content:flex-end;margin-bottom:12px">
  <table class="tots">
    <tr><td>Subtotal:</td><td>${fmt2(subtotalBruto)}</td></tr>
    ${descAdicional>0.01?`<tr><td>Descuento adicional:</td><td>- ${fmt2(descAdicional)}</td></tr>`:""}
    <tr><td>Total Valor:</td><td>${fmt2(venta.total)}</td></tr>
    <tr class="tf"><td>Monto a pagar Bs</td><td>${fmt2(venta.total)}</td></tr>
  </table>
</div>
<div class="letras">Son: <strong>${numeroALetras(venta.total)}</strong></div>
<div class="foot">Toscana House · ${SUCURSAL_EMP} · ${TELEFONO_EMP} · ${CIUDAD_EMP}</div>
<script>window.onload=function(){setTimeout(function(){window.print();},600);}<\/script>
</body></html>`);
  win.document.close();
}

// ══════════════════════════════════════════════════════════
// iOS DESIGN ATOMS
// ══════════════════════════════════════════════════════════

// Font stack — unified DM Sans for professional/clean look
const FONT = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_UI = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Logo SVG inline de Toscana House
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" fill="none">
  <text x="100" y="52" textAnchor="middle" fontFamily="Georgia,serif" fontSize="44" fontWeight="700" fill="currentColor" letterSpacing="2">TH</text>
  <text x="100" y="76" textAnchor="middle" fontFamily="Georgia,serif" fontSize="13" fontWeight="400" fill="currentColor" letterSpacing="8">TOSCANA</text>
  <text x="100" y="92" textAnchor="middle" fontFamily="Georgia,serif" fontSize="9" fontWeight="300" fill="currentColor" letterSpacing="6">CASA DE MODA</text>
  <line x1="30" y1="60" x2="170" y2="60" stroke="currentColor" strokeWidth="0.5" opacity="0.4"/>
</svg>`;

function LogoMark({size=36, color="#1565C0"}){
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center",lineHeight:1}}>
    <div style={{fontSize:size*.55,fontWeight:800,color,fontFamily:"Georgia,serif",letterSpacing:2,lineHeight:1}}
      dangerouslySetInnerHTML={{__html:"&#119947;&#119947;".replace(/&#119947;/g,"")}}
    />
    <div style={{width:size*1.2,height:1,background:color,opacity:.4,margin:"2px 0"}}/>
    <div style={{fontSize:size*.22,fontWeight:700,color,fontFamily:"Georgia,serif",letterSpacing:4,lineHeight:1}}>TOSCANA</div>
    <div style={{fontSize:size*.14,fontWeight:300,color:color+"AA",fontFamily:"Georgia,serif",letterSpacing:3,lineHeight:1.4}}>CASA DE MODA</div>
  </div>;
}

function usePress(onPress) {
  var _hN105 = useState(false); var pressed = _hN105[0]; var setPressed = _hN105[1];;
  return {
    onTouchStart: () => setPressed(true),
    onTouchEnd:   () => { setPressed(false); onPress && onPress(); },
    onMouseDown:  () => setPressed(true),
    onMouseUp:    () => { setPressed(false); onPress && onPress(); },
    onMouseLeave: () => setPressed(false),
    pressed,
  };
}

// iOS-style pill badge
function Chip({children, color=C.gold, small}){
  return <span style={{
    background:`${color}30`, color,
    border:`1px solid ${color}40`,
    borderRadius:20, padding: small?"1px 8px":"3px 10px",
    fontSize: small?10:12, fontWeight:600, fontFamily:FONT,
    letterSpacing:.2, whiteSpace:"nowrap",
  }}>{children}</span>;
}

// iOS-style grouped list cell
function Cell({icon,iconBg,label,value,chevron,onPress,danger,first,last,badge}){
  const {pressed,...handlers}=usePress(onPress);
  return (
    <div {...handlers} style={{
      background: pressed?C.fill3:C.bg2,
      padding:"14px 16px",
      borderRadius: first&&last?"14px":first?"14px 14px 0 0":last?"0 0 14px 14px":"0",
      display:"flex",alignItems:"center",gap:14,
      cursor:onPress?"pointer":"default",
      transition:"background .12s",
      borderBottom: last?"":`1px solid ${C.sep}`,
      userSelect:"none", WebkitTapHighlightColor:"transparent",
    }}>
      {icon&&<div style={{
        width:32,height:32,borderRadius:8,
        background:iconBg||`${C.gold}30`,
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:16,flexShrink:0,
      }}>{icon}</div>}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:16,fontWeight:400,color:danger?C.red:C.label,fontFamily:FONT,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</div>
      </div>
      {badge&&<Chip color={C.gold} small>{badge}</Chip>}
      {value&&<span style={{fontSize:16,color:C.label2,fontFamily:FONT}}>{value}</span>}
      {chevron&&<span style={{color:C.label3,fontSize:18,fontWeight:400}}>›</span>}
    </div>
  );
}

// iOS Navigation Bar
function NavBar({title, subtitle, back, onBack, right}){
  return (
    <div style={{
      background:"rgba(255,255,255,0.96)",
      backdropFilter:"blur(20px) saturate(180%)",
      WebkitBackdropFilter:"blur(20px) saturate(180%)",
      borderBottom:`1px solid ${C.sep}`,
      boxShadow:"0 2px 16px rgba(21,101,192,0.07)",
      padding:"0 16px",
      position:"sticky",top:0,zIndex:100,
      display:"flex",alignItems:"center",height:56,
      gap:8,
    }}>
      {back&&(
        <button onClick={onBack} style={{
          background:"none",border:"none",
          color:C.gold,fontSize:16,fontFamily:FONT,fontWeight:400,
          cursor:"pointer",padding:"8px 0",
          display:"flex",alignItems:"center",gap:4,
          WebkitTapHighlightColor:"transparent",
          minWidth:44,
        }}>
          <span style={{fontSize:22,lineHeight:1}}>‹</span>
          <span style={{fontSize:16}}>{typeof back==="string"?back:""}</span>
        </button>
      )}
      <div style={{flex:1,textAlign:"center"}}>
        <div style={{fontSize:17,fontWeight:600,color:C.label,fontFamily:FONT,lineHeight:1.2}}>{title}</div>
        {subtitle&&<div style={{fontSize:11,color:C.label2,fontFamily:FONT,marginTop:1}}>{subtitle}</div>}
      </div>
      <div style={{minWidth:back?44:0,display:"flex",justifyContent:"flex-end"}}>{right}</div>
    </div>
  );
}

// iOS Bottom Tab Bar
const TAB_COLORS = {
  inicio:        "#1565C0",
  pos:           C.tabPos,
  inventario:    C.tabInv,
  marcas:        C.tabMar,
  ventas:        C.tabVen,
  liquidaciones: C.tabLiq,
  config:        "#455A64",
  historial:     "#546E7A",
};

function TabBar({tabs, active, onChange}){
  return (
    <div style={{
      position:"fixed",bottom:0,left:0,right:0,zIndex:200,
      background:"rgba(255,255,255,0.97)",
      backdropFilter:"blur(20px) saturate(180%)",
      WebkitBackdropFilter:"blur(20px) saturate(180%)",
      borderTop:`1px solid ${C.sep}`,
      display:"flex",
      justifyContent:"center",
      alignItems:"stretch",
      paddingBottom:"env(safe-area-inset-bottom,12px)",
      boxShadow:"0 -2px 16px rgba(21,101,192,0.07)",
    }}>
      <div style={{
        display:"flex",
        width:"100%",
        maxWidth:560,
      }}>
        {tabs.map(t=>{
          const isActive=active===t.id;
          const tabColor=TAB_COLORS[t.id]||C.gold;
          return (
            <button key={t.id} onClick={()=>onChange(t.id)} style={{
              flex:1,border:"none",
              background:"transparent",
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
              padding:"8px 2px 6px",
              cursor:"pointer",
              WebkitTapHighlightColor:"transparent",
              gap:3,
              borderTop:isActive?`2px solid ${tabColor}`:"2px solid transparent",
              transition:"border-color .2s",
              minWidth:0,
            }}>
              <div style={{
                width:28,height:28,borderRadius:8,
                background:isActive?`${tabColor}18`:"transparent",
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:16,lineHeight:1,
                transform:isActive?"scale(1.1)":"scale(1)",
                transition:"all .2s cubic-bezier(.34,1.56,.64,1)",
              }}>{t.icon}</div>
              <span style={{
                fontSize:9,fontFamily:FONT_UI,fontWeight:isActive?700:500,
                color:isActive?tabColor:C.label3,
                transition:"color .2s",
                letterSpacing:.2,
                whiteSpace:"nowrap",
              }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// iOS-style large button
function IOSBtn({children,onPress,variant="primary",full,disabled,small,icon}){
  const {pressed,...handlers}=usePress();
  const bg = {
    primary: `linear-gradient(135deg,${C.gold},${C.goldD})`,
    success: `linear-gradient(135deg,${C.green},#28A047)`,
    danger:  `linear-gradient(135deg,${C.red},#C0392B)`,
    ghost:   "transparent",
    fill:    C.fill2,
  };
  return (
    <button
      disabled={disabled}
      onClick={onPress}
      {...handlers}
      style={{
        background:disabled?"#2C2C2E":bg[variant],
        border:variant==="ghost"?`1px solid ${C.gold}50`:"none",
        borderRadius:14,
        padding:small?"10px 16px":"15px 20px",
        width:full?"100%":"auto",
        cursor:disabled?"not-allowed":"pointer",
        display:"flex",alignItems:"center",justifyContent:"center",gap:8,
        fontFamily:FONT,fontWeight:600,
        fontSize:small?14:16,
        color:disabled?C.label3:variant==="ghost"?C.gold:variant==="fill"?C.label:"#000",
        transform: pressed&&!disabled?"scale(0.97)":"scale(1)",
        transition:"transform .12s cubic-bezier(.34,1.56,.64,1), opacity .12s",
        opacity:disabled?.5:pressed?.9:1,
        WebkitTapHighlightColor:"transparent",
        userSelect:"none",
      }}>
      {icon&&<span style={{fontSize:small?16:18}}>{icon}</span>}
      {children}
    </button>
  );
}

// iOS sheet (bottom modal)
function Sheet({open,onClose,title,children,tall}){
  var _hN106 = useState(false); var visible = _hN106[0]; var setVisible = _hN106[1];;
  var _hN107 = useState(false); var anim = _hN107[0]; var setAnim = _hN107[1];;
  useEffect(()=>{
    if(open){setVisible(true);setTimeout(()=>setAnim(true),10);}
    else{setAnim(false);setTimeout(()=>setVisible(false),320);}
  },[open]);
  if(!visible)return null;
  return (
    <div style={{
      position:"fixed",inset:0,zIndex:500,
      background:anim?"rgba(0,0,0,.55)":"rgba(0,0,0,0)",
      transition:"background .32s",
      display:"flex",alignItems:"flex-end",
    }} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{
        background:"#FFFFFF",
        borderRadius:"22px 22px 0 0",
        width:"100%",
        maxHeight:tall?"90vh":"80vh",
        overflowY:"auto",
        transform:anim?"translateY(0)":"translateY(100%)",
        transition:"transform .32s cubic-bezier(.32,.72,0,1)",
        paddingBottom:"env(safe-area-inset-bottom,24px)",
      }}>
        {/* Handle */}
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 4px"}}>
          <div style={{width:36,height:5,borderRadius:3,background:C.accent}}/>
        </div>
        {/* Title */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"8px 20px 16px"}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:600,color:C.label,fontFamily:FONT}}>{title}</h3>
          <button onClick={onClose} style={{
            background:C.fill2,border:"none",borderRadius:"50%",
            width:30,height:30,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",
            color:C.label2,fontSize:16,fontFamily:FONT,fontWeight:600,
            WebkitTapHighlightColor:"transparent",
          }}>✕</button>
        </div>
        <div style={{padding:"0 16px"}}>{children}</div>
      </div>
    </div>
  );
}

// iOS-style input
function IOSInput({label,prefix,style:st={},...p}){
  return (
    <div style={{marginBottom:12}}>
      {label&&<div style={{fontSize:13,fontWeight:500,color:C.label2,fontFamily:FONT,
        marginBottom:6,paddingLeft:4}}>{label}</div>}
      <div style={{position:"relative"}}>
        {prefix&&<span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",
          color:C.label3,fontSize:15,fontFamily:FONT,pointerEvents:"none"}}>{prefix}</span>}
        <input {...p} style={{
          width:"100%",padding:"13px 14px",paddingLeft:prefix?"36px":"14px",
          borderRadius:12,border:`1.5px solid ${C.sep}`,
          background:C.bg2,fontSize:16,color:C.label,
          outline:"none",fontFamily:FONT,boxSizing:"border-box",
          WebkitAppearance:"none",
          ...st
        }}
        onFocus={e=>{e.target.style.borderColor=C.gold;e.target.style.background=C.bg3;}}
        onBlur={e=>{e.target.style.borderColor=C.sep;e.target.style.background=C.bg2;}}
        />
      </div>
    </div>
  );
}

// iOS Segmented Control
function SegControl({options,value,onChange}){
  return (
    <div style={{
      background:C.bg2,borderRadius:10,padding:3,
      display:"flex",gap:3,
    }}>
      {options.map(o=>(
        <button key={o.value} onClick={()=>onChange(o.value)} style={{
          flex:1,padding:"7px 0",borderRadius:8,border:"none",
          background:value===o.value?C.bg3:"transparent",
          color:value===o.value?C.label:C.label2,
          fontFamily:FONT,fontSize:13,fontWeight:value===o.value?600:400,
          cursor:"pointer",transition:"all .2s",
          boxShadow:value===o.value?"0 1px 4px rgba(0,0,0,.3)":"none",
          WebkitTapHighlightColor:"transparent",
        }}>{o.label}</button>
      ))}
    </div>
  );
}

// iOS-style select
function IOSSel({label,children,style:st={},...p}){
  return (
    <div style={{marginBottom:12}}>
      {label&&<div style={{fontSize:13,fontWeight:500,color:C.label2,fontFamily:FONT,
        marginBottom:6,paddingLeft:4}}>{label}</div>}
      <select {...p} style={{
        width:"100%",padding:"13px 14px",borderRadius:12,
        border:`1.5px solid ${C.sep}`,background:C.bg2,
        fontSize:16,color:C.label,outline:"none",fontFamily:FONT,cursor:"pointer",
        WebkitAppearance:"none",
        ...st
      }}>{children}</select>
    </div>
  );
}

// Stat card iOS style
function StatCard({icon,label,value,sub,color=C.gold}){
  return (
    <div style={{
      background:C.bg2,borderRadius:16,padding:"16px",
      border:`1px solid ${C.sep}`,
    }}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <div style={{width:34,height:34,borderRadius:10,background:`${color}25`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>{icon}</div>
        <span style={{fontSize:13,color:C.label2,fontFamily:FONT,fontWeight:500}}>{label}</span>
      </div>
      <div style={{fontSize:24,fontWeight:700,color:C.label,fontFamily:FONT,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginTop:4}}>{sub}</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// LiqModal — liquidación como componente iOS sheet
// ══════════════════════════════════════════════════════════
function LiqModal({marcaId,ventas,mes,anio,MK,cierres,setCierres,onClose,syncCierre}){
  if(!marcaId) return null;
  const marca=MARCAS.find(x=>x.id===marcaId);
  const vMes=ventas.filter(v=>v.mk===MK);
  const vMarca=vMes.filter(v=>v.items.some(i=>i.marcaId===marcaId));
  const bruto=vMarca.reduce((s,v)=>s+v.items.filter(i=>i.marcaId===marcaId).reduce((ss,i)=>ss+i.subtotal,0),0);
  const comision=bruto*0.10;
  const neto=bruto*0.90;
  const cerrado=cierres[`${MK}-${marcaId}`]?.cerrado;

  return (
    <Sheet open={!!marcaId} onClose={onClose} title={`${marca?.emoji} ${marca?.nombre} — ${MESES[mes]}`} tall>
      {/* Financiero */}
      <div style={{background:C.bg2,borderRadius:16,overflow:"hidden",marginBottom:16}}>
        {[["Ventas brutas",$(bruto),C.label],["Comisión (10%)",`-${$(comision)}`,C.red],["Neto a liquidar",$(neto),C.green]].map(([k,v,c],i,arr)=>(
          <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"15px 16px",borderBottom:i<arr.length-1?`1px solid ${C.sep}`:""}}>
            <span style={{fontSize:16,color:C.label2,fontFamily:FONT}}>{k}</span>
            <span style={{fontSize:16,fontWeight:600,color:c,fontFamily:FONT}}>{v}</span>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"18px 16px",background:`${C.gold}12`}}>
          <span style={{fontSize:17,fontWeight:700,color:C.label,fontFamily:FONT}}>TOTAL A PAGAR</span>
          <span style={{fontSize:22,fontWeight:800,color:C.gold,fontFamily:FONT}}>{$(neto)}</span>
        </div>
      </div>

      {/* Ventas */}
      <div style={{fontSize:13,fontWeight:600,color:C.label3,fontFamily:FONT,
        textTransform:"uppercase",letterSpacing:.8,marginBottom:8,paddingLeft:4}}>
        Transacciones del período
      </div>
      {vMarca.length===0
        ? <div style={{textAlign:"center",padding:"32px 0",color:C.label3,fontFamily:FONT,fontSize:16}}>Sin ventas en {MESES[mes]}</div>
        : vMarca.map(v=>{
            const its=v.items.filter(i=>i.marcaId===marcaId);
            const sub=its.reduce((s,i)=>s+i.subtotal,0);
            return (
              <div key={v.id} style={{background:C.bg2,borderRadius:14,padding:14,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <span style={{fontFamily:"monospace",fontSize:12,color:C.gold}}>{v.id}</span>
                  <span style={{fontSize:16,fontWeight:700,color:C.gold,fontFamily:FONT}}>{$(sub)}</span>
                </div>
                <div style={{fontSize:13,color:C.label3,fontFamily:FONT,marginBottom:6}}>
                  {v.fecha} {v.hora} · {labelPago(v.metodoPago)}
                </div>
                {its.map((it,ii)=>(
                  <div key={`${v.id}-${it.prodId}-${ii}`} style={{fontSize:13,color:C.label2,fontFamily:FONT}}>
                    · {it.nombre} ×{it.cantidad} = {$(it.subtotal)}
                  </div>
                ))}
              </div>
            );
          })
      }

      <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:16}}>
        <IOSBtn onPress={()=>exportCSV(marca,ventas,mes,anio)} variant="fill" icon="⬇">
          Exportar CSV
        </IOSBtn>
        {!cerrado
          ? <IOSBtn onPress={()=>{setCierres(p=>({...p,[`${MK}-${marcaId}`]:{cerrado:true,fecha:hoy(),mk:MK}}));sbGuardarCierre(`${MK}-${marcaId}`,{cerrado:true,fecha:hoy(),mk:MK,marca_id:marcaId});onClose();}} variant="success" icon="✓">
              Confirmar Cierre Mensual
            </IOSBtn>
          : <IOSBtn onPress={()=>{setCierres(p=>({...p,[`${MK}-${marcaId}`]:{cerrado:false,mk:MK}}));onClose();}} variant="danger">
              Reabrir Liquidación
            </IOSBtn>
        }
      </div>
    </Sheet>
  );
}


// ════════════════════════════════════════════════════════════
// SISTEMA DE LOGIN — Toscana House
// Usuarios con contraseña — sesión guardada en localStorage
// ════════════════════════════════════════════════════════════

// ── Usuarios autorizados ─────────────────────────────────
// Para agregar usuarios: {usuario, password, nombre, rol}
// rol: "admin" (acceso total) | "caja" (solo POS y ventas)
const USUARIOS = [
  { usuario: "toscana",  password: "casa2024",    nombre: "Toscana House",  rol: "admin" },
  { usuario: "caja",     password: "caja2024",    nombre: "Vendedor Caja",  rol: "caja"  },
  { usuario: "tatiana",  password: "toscana2024", nombre: "Tatiana",        rol: "admin" },
];

function useAuth() {
  var _hN108 = useState(function(){ try{return JSON.parse(localStorage.getItem("th_user")||"null");}catch{return null;} }); var user = _hN108[0]; var setUser = _hN108[1];

  function login(usuario, password) {
    // Check localStorage users first, then defaults
    const listaActual = (() => {
      try { return JSON.parse(localStorage.getItem("th_usuarios")||"null") || USUARIOS; }
      catch { return USUARIOS; }
    })();
    const found = listaActual.find(u =>
      u.usuario.toLowerCase() === usuario.toLowerCase() &&
      u.password === password
    );
    if (found) {
      const session = { ...found, loginAt: Date.now() };
      localStorage.setItem("th_user", JSON.stringify(session));
      setUser(session);
      return { ok: true };
    }
    return { ok: false, error: "Usuario o contraseña incorrectos" };
  }

  function logout() {
    localStorage.removeItem("th_user");
    setUser(null);
  }

  return { user, login, logout };
}

// Pantalla de Login
function LoginScreen({ onLogin }) {
  var _hN109 = useState(""); var usuario = _hN109[0]; var setUsuario = _hN109[1];;
  var _hN110 = useState(""); var password = _hN110[0]; var setPassword = _hN110[1];;
  var _hN111 = useState(""); var error = _hN111[0]; var setError = _hN111[1];;
  var _hN112 = useState(false); var loading = _hN112[0]; var setLoading = _hN112[1];;
  var _hN113 = useState(false); var showPass = _hN113[0]; var setShowPass = _hN113[1];;

  function handleLogin() {
    if (!usuario || !password) { setError("Completa todos los campos"); return; }
    setLoading(true);
    setError("");
    setTimeout(() => {
      const result = onLogin(usuario, password);
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
      }
    }, 600);
  }

  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(160deg, #F2F7F2 0%, #E8F2E8 50%, #D8EDD8 100%)",
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      fontFamily:FONT, padding:24,
    }}>
      {/* Logo */}
      <div style={{marginBottom:40, textAlign:"center"}}>
        <div style={{fontSize:48, marginBottom:8}}>🏡</div>
        <div style={{fontSize:28, fontWeight:800, color:"#3D6B3D",
          fontFamily:"Georgia,serif", letterSpacing:3}}>TOSCANA HOUSE</div>
        <div style={{fontSize:12, color:"#7A9A7A", letterSpacing:6,
          fontFamily:"Georgia,serif", marginTop:4}}>CASA DE MODA</div>
        <div style={{width:80, height:1, background:"#A8C5A0",
          margin:"12px auto 0"}}/>
      </div>

      {/* Card login */}
      <div style={{
        background:"rgba(255,255,255,0.95)",
        borderRadius:24, padding:"32px 28px",
        width:"100%", maxWidth:380,
        boxShadow:"0 8px 40px rgba(74,107,74,0.15)",
        border:"1px solid rgba(168,197,160,0.4)",
      }}>
        <div style={{fontSize:20, fontWeight:700, color:"#1A2E1A",
          marginBottom:6, fontFamily:FONT}}>Iniciar sesión</div>
        <div style={{fontSize:14, color:"#7A9A7A", marginBottom:28, fontFamily:FONT}}>
          Ingresa tus credenciales para continuar
        </div>

        {/* Usuario */}
        <div style={{marginBottom:16}}>
          <label style={{fontSize:11, fontWeight:700, color:"#4A6B4A",
            textTransform:"uppercase", letterSpacing:.8, display:"block", marginBottom:6}}>
            Usuario
          </label>
          <input
            value={usuario}
            onChange={e=>{setUsuario(e.target.value);setError("");}}
            onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            placeholder="tu usuario"
            autoCapitalize="none"
            autoCorrect="off"
            style={{width:"100%", padding:"13px 16px", borderRadius:12,
              border:`1.5px solid ${error?"#C0504A":"rgba(168,197,160,0.6)"}`,
              background:"#F7FAF7", fontSize:16, color:"#1A2E1A",
              outline:"none", fontFamily:FONT, boxSizing:"border-box",
              WebkitAppearance:"none"}}
            onFocus={e=>e.target.style.borderColor="#5C8A5C"}
            onBlur={e=>e.target.style.borderColor=error?"#C0504A":"rgba(168,197,160,0.6)"}
          />
        </div>

        {/* Contraseña */}
        <div style={{marginBottom:24}}>
          <label style={{fontSize:11, fontWeight:700, color:"#4A6B4A",
            textTransform:"uppercase", letterSpacing:.8, display:"block", marginBottom:6}}>
            Contraseña
          </label>
          <div style={{position:"relative"}}>
            <input
              type={showPass?"text":"password"}
              value={password}
              onChange={e=>{setPassword(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              placeholder="••••••••"
              style={{width:"100%", padding:"13px 44px 13px 16px", borderRadius:12,
                border:`1.5px solid ${error?"#C0504A":"rgba(168,197,160,0.6)"}`,
                background:"#F7FAF7", fontSize:16, color:"#1A2E1A",
                outline:"none", fontFamily:FONT, boxSizing:"border-box",
                WebkitAppearance:"none"}}
              onFocus={e=>e.target.style.borderColor="#5C8A5C"}
              onBlur={e=>e.target.style.borderColor=error?"#C0504A":"rgba(168,197,160,0.6)"}
            />
            <button onClick={()=>setShowPass(p=>!p)} style={{
              position:"absolute", right:12, top:"50%",
              transform:"translateY(-50%)",
              background:"none", border:"none", cursor:"pointer",
              fontSize:18, color:"#7A9A7A",
              WebkitTapHighlightColor:"transparent",
            }}>{showPass?"🙈":"👁"}</button>
          </div>
        </div>

        {/* Error */}
        {error&&(
          <div style={{padding:"10px 14px", background:"#FFF0EE",
            borderRadius:10, border:"1px solid #F4A8A8",
            color:"#C0504A", fontSize:13, fontFamily:FONT,
            marginBottom:16, textAlign:"center"}}>
            {error}
          </div>
        )}

        {/* Botón */}
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width:"100%", padding:"15px",
            borderRadius:14, border:"none",
            background:loading?"#A8C5A0":"linear-gradient(135deg,#5C8A5C,#3D6B3D)",
            color:"white", fontSize:16, fontWeight:700,
            cursor:loading?"not-allowed":"pointer",
            fontFamily:FONT, letterSpacing:.5,
            transition:"all .2s",
            WebkitTapHighlightColor:"transparent",
          }}>
          {loading?"Verificando…":"Entrar"}
        </button>
      </div>

      <div style={{marginTop:24, fontSize:12, color:"#7A9A7A",
        fontFamily:FONT, textAlign:"center"}}>
        Toscana House © {new Date().getFullYear()}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// RETIROS — Items retirados de tienda (no ventas)
// ══════════════════════════════════════════════════════════
function RetirosTab({inv, retiros, onRetiro}){
  const [codBusq, setCodBusq] = useState("");
  const [prodEncontrado, setProdEncontrado] = useState(null);
  const [cantidad, setCantidad] = useState("1");
  const [destinatario, setDestinatario] = useState("");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState(null);
  const [busqHist, setBusqHist] = useState("");

  function buscarProd(){
    const cod = codBusq.trim().toUpperCase();
    const p = inv.find(i=>i.codigo.toUpperCase()===cod);
    if(!p){ setMsg({ok:false,txt:`Código "${cod}" no encontrado`}); setProdEncontrado(null); return; }
    if(p.stock<=0){ setMsg({ok:false,txt:`"${p.nombre}" no tiene stock disponible`}); setProdEncontrado(null); return; }
    setProdEncontrado(p);
    setMsg(null);
    setCantidad("1");
  }

  function confirmarRetiro(){
    if(!prodEncontrado) return;
    if(!destinatario.trim()){ setMsg({ok:false,txt:"Ingresa el nombre del destinatario"}); return; }
    const cant = parseInt(cantidad)||1;
    if(cant > prodEncontrado.stock){ setMsg({ok:false,txt:`Stock insuficiente (disponible: ${prodEncontrado.stock})`}); return; }
    const r = {
      id:`RET-${Date.now()}`,
      fecha:hoy(), hora:hora(),
      prodId:prodEncontrado.id, codigo:prodEncontrado.codigo,
      nombre:prodEncontrado.nombre, marcaId:prodEncontrado.marcaId,
      marcaNombre:prodEncontrado.marcaNombre,
      cantidad:cant, destinatario:destinatario.trim(), motivo:motivo.trim()
    };
    onRetiro(r);
    setMsg({ok:true,txt:`✓ "${prodEncontrado.nombre}" retirado para ${destinatario.trim()}`});
    setProdEncontrado(null); setCodBusq(""); setDestinatario(""); setMotivo(""); setCantidad("1");
  }

  const retirosFiltrados = useMemo(()=>{
    if(!busqHist.trim()) return [...retiros].reverse();
    const q=busqHist.toLowerCase();
    return [...retiros].reverse().filter(r=>
      r.codigo.toLowerCase().includes(q)||
      r.nombre.toLowerCase().includes(q)||
      r.destinatario.toLowerCase().includes(q)
    );
  },[retiros,busqHist]);

  return (
    <div>
      {/* Formulario retiro */}
      <div style={{background:C.bg1,borderRadius:16,padding:20,marginBottom:16,
        border:`1px solid ${C.sep}`,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <div style={{fontSize:16,fontWeight:700,color:C.label,fontFamily:FONT,marginBottom:16,
          display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>📤</span> Registrar Retiro
        </div>

        {/* Buscar producto */}
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <div style={{flex:1}}>
            <IOSInput
              label="Código del producto"
              value={codBusq}
              onChange={e=>{setCodBusq(e.target.value.toUpperCase());setProdEncontrado(null);setMsg(null);}}
              placeholder="Ej: DON-CREM-0001"
              style={{fontFamily:"monospace",textTransform:"uppercase"}}
            />
          </div>
          <button onClick={buscarProd} style={{
            alignSelf:"flex-end",background:C.blue,border:"none",borderRadius:10,
            padding:"12px 18px",color:"#fff",fontSize:14,fontWeight:600,
            cursor:"pointer",fontFamily:FONT,whiteSpace:"nowrap",
            WebkitTapHighlightColor:"transparent"}}>
            Buscar
          </button>
        </div>

        {/* Producto encontrado */}
        {prodEncontrado&&(
          <div style={{background:C.bg3,borderRadius:12,padding:14,marginBottom:14,
            border:`1px solid ${C.sep}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:C.label,fontFamily:FONT}}>
                  {prodEncontrado.nombre}
                </div>
                <div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>
                  {prodEncontrado.marcaNombre} · {prodEncontrado.codigo}
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,color:C.green,fontFamily:FONT,fontWeight:600}}>
                  Stock: {prodEncontrado.stock}
                </div>
                <div style={{fontSize:13,color:C.label2,fontFamily:FONT}}>
                  Bs {Number(prodEncontrado.precio).toLocaleString("es-BO")}
                </div>
              </div>
            </div>

            {/* Cantidad */}
            <div style={{marginBottom:10}}>
              <div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginBottom:6,fontWeight:500}}>
                Cantidad a retirar
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <button onClick={()=>setCantidad(p=>String(Math.max(1,parseInt(p)||1)-1))}
                  style={{width:36,height:36,borderRadius:8,border:`1px solid ${C.sep}`,
                    background:C.bg1,fontSize:18,cursor:"pointer",color:C.label,
                    display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                <input value={cantidad} onChange={e=>setCantidad(e.target.value)}
                  style={{width:60,textAlign:"center",border:`1px solid ${C.sep}`,
                    borderRadius:8,padding:"8px",fontSize:15,fontWeight:700,
                    color:C.label,background:C.bg1,fontFamily:FONT}}/>
                <button onClick={()=>setCantidad(p=>String(Math.min(prodEncontrado.stock,(parseInt(p)||1)+1)))}
                  style={{width:36,height:36,borderRadius:8,border:`1px solid ${C.sep}`,
                    background:C.bg1,fontSize:18,cursor:"pointer",color:C.label,
                    display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                <span style={{fontSize:12,color:C.label3,fontFamily:FONT}}>
                  de {prodEncontrado.stock} en stock
                </span>
              </div>
            </div>

            <IOSInput
              label="Para quién (destinatario)"
              value={destinatario}
              onChange={e=>setDestinatario(e.target.value)}
              placeholder="Nombre del destinatario"
            />
            <IOSInput
              label="Motivo (opcional)"
              value={motivo}
              onChange={e=>setMotivo(e.target.value)}
              placeholder="Muestra, préstamo, evento…"
            />
          </div>
        )}

        {/* Mensaje */}
        {msg&&(
          <div style={{padding:"10px 14px",borderRadius:10,marginBottom:12,
            background:msg.ok?`${C.green}12`:`${C.red}12`,
            border:`1px solid ${(msg.ok?C.green:C.red)}30`,
            color:msg.ok?C.green:C.red,fontSize:13,fontFamily:FONT}}>
            {msg.txt}
          </div>
        )}

        <button
          onClick={confirmarRetiro}
          disabled={!prodEncontrado||!destinatario.trim()}
          style={{
            width:"100%",background:!prodEncontrado||!destinatario.trim()?"#E0E0E0":C.amber,
            border:"none",borderRadius:12,padding:"14px",fontSize:15,fontWeight:700,
            color:!prodEncontrado||!destinatario.trim()?"#9E9E9E":"#fff",
            cursor:!prodEncontrado||!destinatario.trim()?"not-allowed":"pointer",
            fontFamily:FONT,WebkitTapHighlightColor:"transparent"}}>
          📤 Confirmar Retiro
        </button>
      </div>

      {/* Historial de retiros */}
      <div style={{background:C.bg1,borderRadius:16,padding:20,
        border:`1px solid ${C.sep}`,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <div style={{fontSize:16,fontWeight:700,color:C.label,fontFamily:FONT,marginBottom:12,
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span>📋 Historial de Retiros</span>
          <span style={{fontSize:13,color:C.label3,fontWeight:400}}>{retiros.length} registrado{retiros.length!==1?"s":""}</span>
        </div>

        {/* Buscador historial */}
        <div style={{position:"relative",marginBottom:14}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",
            fontSize:14,color:C.label3}}>🔍</span>
          <input
            value={busqHist} onChange={e=>setBusqHist(e.target.value)}
            placeholder="Buscar por código, nombre o destinatario…"
            style={{width:"100%",padding:"10px 12px 10px 36px",border:`1px solid ${C.sep}`,
              borderRadius:10,background:C.bg2,fontSize:13,color:C.label,
              fontFamily:FONT,outline:"none",boxSizing:"border-box"}}
          />
        </div>

        {retirosFiltrados.length===0
          ? <div style={{textAlign:"center",padding:30,color:C.label3,fontFamily:FONT,fontSize:13}}>
              {retiros.length===0?"Sin retiros registrados":"No se encontraron resultados"}
            </div>
          : retirosFiltrados.map(r=>{
              const marca=MARCAS.find(m=>m.id===r.marcaId);
              return (
                <div key={r.id} style={{borderBottom:`1px solid ${C.sep}`,padding:"12px 0",
                  display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:600,color:C.label,fontFamily:FONT}}>
                      {r.nombre}
                    </div>
                    <div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginTop:2}}>
                      {r.codigo} · {marca?.nombre||r.marcaNombre} · x{r.cantidad}
                    </div>
                    <div style={{fontSize:12,color:C.blue,fontFamily:FONT,marginTop:3,fontWeight:500}}>
                      Para: {r.destinatario}
                    </div>
                    {r.motivo&&<div style={{fontSize:11,color:C.label3,fontFamily:FONT,marginTop:2}}>
                      {r.motivo}
                    </div>}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:12,fontFamily:"monospace",color:C.amber,fontWeight:600}}>
                      {r.fecha}
                    </div>
                    <div style={{fontSize:11,color:C.label3,fontFamily:FONT}}>{r.hora}</div>
                    <div style={{marginTop:4}}>
                      <span style={{background:`${C.amber}18`,color:C.amber,
                        fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,fontFamily:FONT}}>
                        RETIRADO
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// NOTA DE VENTA — Modal detalle
// ══════════════════════════════════════════════════════════
function NotaVentaModal({venta, onClose, numVenta}){
  if(!venta) return null;
  const [menuOpen, setMenuOpen] = useState(false);
  const num = numVenta || venta.id.replace(/\D/g,"").slice(-4).padStart(4,"0");

  const filaInfo = (lbl, val) => (
    <div style={{borderBottom:`1px solid ${C.sep}`,padding:"10px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <span style={{fontSize:13,color:C.label3,fontFamily:FONT}}>{lbl}</span>
      <span style={{fontSize:13,fontWeight:500,color:C.label,fontFamily:FONT}}>{val}</span>
    </div>
  );

  return (
    <Sheet open={!!venta} onClose={onClose} title="Detalle de Nota de venta" tall>
      {/* Encabezado */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <span style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:C.label}}>
          # {num}
        </span>
        <Chip color={colorPago(venta.metodoPago)}>
          {iconPago(venta.metodoPago)} {labelPago(venta.metodoPago)}
        </Chip>
        <Chip color={C.green}>✓ Pagado</Chip>
      </div>

      {/* Datos de la venta */}
      <div style={{background:C.bg2,borderRadius:14,padding:"0 16px",marginBottom:16,
        border:`1px solid ${C.sep}`}}>
        {filaInfo("Fecha", `${venta.fecha} ${venta.hora}`)}
        {filaInfo("Vendedor", venta.vendedor||"Tienda")}
        {filaInfo("Sucursal", SUCURSAL_EMP)}
        {filaInfo("Referencia", venta.id)}
      </div>

      {/* Tabla de ítems */}
      <div style={{background:C.bg2,borderRadius:14,overflow:"hidden",
        border:`1px solid ${C.sep}`,marginBottom:16}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:0,
          background:C.sep,padding:"8px 14px"}}>
          <span style={{fontSize:11,fontWeight:700,color:C.label2,fontFamily:FONT,textTransform:"uppercase",letterSpacing:.5}}>Ítem</span>
          <span style={{fontSize:11,fontWeight:700,color:C.label2,fontFamily:FONT,textTransform:"uppercase",letterSpacing:.5,textAlign:"right",minWidth:60}}>P. Unit.</span>
          <span style={{fontSize:11,fontWeight:700,color:C.label2,fontFamily:FONT,textTransform:"uppercase",letterSpacing:.5,textAlign:"right",minWidth:70}}>Total</span>
        </div>
        {venta.items.map((it,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:0,
            padding:"10px 14px",borderBottom:i<venta.items.length-1?`1px solid ${C.sep}`:""}}>
            <div>
              <div style={{fontSize:13,fontWeight:500,color:C.label,fontFamily:FONT}}>{it.nombre}</div>
              <div style={{fontSize:11,color:C.label3,fontFamily:FONT}}>
                {it.marcaNombre} · x{it.cantidad}
              </div>
            </div>
            <div style={{fontSize:13,color:C.label2,fontFamily:FONT,textAlign:"right",minWidth:60,paddingLeft:8}}>
              {$(it.precioUnit)}
            </div>
            <div style={{fontSize:13,fontWeight:600,color:C.label,fontFamily:FONT,textAlign:"right",minWidth:70,paddingLeft:8}}>
              {$(it.subtotal)}
            </div>
          </div>
        ))}
        {/* Descuento si hay */}
        {venta.descPct>0&&(
          <div style={{display:"flex",justifyContent:"space-between",padding:"8px 14px",
            background:`${C.amber}10`,borderTop:`1px solid ${C.sep}`}}>
            <span style={{fontSize:13,color:C.amber,fontFamily:FONT}}>Descuento ({venta.descPct}%)</span>
            <span style={{fontSize:13,color:C.amber,fontFamily:FONT,fontWeight:600}}>
              -{$(venta.items.reduce((s,i)=>s+i.precioUnit*i.cantidad,0)-venta.total)}
            </span>
          </div>
        )}
        {/* Total */}
        <div style={{display:"flex",justifyContent:"space-between",padding:"12px 14px",
          background:`${C.gold}12`,borderTop:`2px solid ${C.sep}`}}>
          <span style={{fontSize:15,fontWeight:700,color:C.label,fontFamily:FONT}}>Total</span>
          <span style={{fontSize:18,fontWeight:800,color:C.gold,fontFamily:FONT}}>{$(venta.total)}</span>
        </div>
      </div>

      {/* Acciones */}
      <div style={{position:"relative",marginBottom:10}}>
        <button
          onClick={()=>setMenuOpen(m=>!m)}
          style={{width:"100%",background:`linear-gradient(135deg,${C.green},#28A047)`,
            border:"none",borderRadius:14,padding:"14px 20px",
            display:"flex",justifyContent:"space-between",alignItems:"center",
            cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
          <span style={{fontSize:15,fontWeight:700,color:"#fff",fontFamily:FONT}}>
            🖨 Obtener Nota de Venta
          </span>
          <span style={{fontSize:18,color:"#fff",transform:menuOpen?"rotate(180deg)":"rotate(0)",
            transition:".2s",display:"inline-block"}}>⌄</span>
        </button>
        {menuOpen&&(
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:10,
            background:C.bg1,borderRadius:14,border:`1px solid ${C.sep}`,
            boxShadow:"0 8px 32px rgba(0,0,0,0.12)",overflow:"hidden"}}>
            {[
              {icon:"🖨", label:"Imprimir PDF", fn:()=>{imprimirNotaVenta(venta,num);setMenuOpen(false);}},
              {icon:"📱", label:"Compartir por WhatsApp", fn:()=>{sendWA(venta);setMenuOpen(false);}},
            ].map((o,i,arr)=>(
              <button key={o.label} onClick={o.fn} style={{
                width:"100%",background:"none",border:"none",
                borderBottom:i<arr.length-1?`1px solid ${C.sep}`:"none",
                padding:"14px 18px",display:"flex",alignItems:"center",gap:12,
                cursor:"pointer",textAlign:"left",WebkitTapHighlightColor:"transparent"}}>
                <span style={{fontSize:18}}>{o.icon}</span>
                <span style={{fontSize:14,fontFamily:FONT,color:C.label}}>{o.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button onClick={onClose} style={{
        width:"100%",background:C.bg2,border:`1px solid ${C.sep}`,
        borderRadius:14,padding:"14px",fontSize:14,fontFamily:FONT,
        color:C.label2,cursor:"pointer",fontWeight:500,
        WebkitTapHighlightColor:"transparent",marginBottom:6}}>
        Cerrar
      </button>

      {/* Historial / pie */}
      <div style={{marginTop:8,padding:"10px 14px",background:C.bg2,borderRadius:12,
        border:`1px solid ${C.sep}`}}>
        <div style={{fontSize:11,color:C.label3,fontFamily:FONT,fontWeight:600,
          textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>
          Historial de movimientos
        </div>
        <div style={{fontSize:12,color:C.label2,fontFamily:FONT}}>
          Registrado por: {venta.vendedor||"Tienda"} — {venta.fecha} {venta.hora}
        </div>
      </div>
    </Sheet>
  );
}

// ══════════════════════════════════════════════════════════
// CAJAS — Gestión de turnos
// ══════════════════════════════════════════════════════════
function CajasTab(){
  const CAJAS_KEY = "th_cajas_v1";
  const defaultCajas = [
    {id:1,nombre:"Caja Turno en la mañana",isOpen:false,ultimoCierre:null,balanceCierre:0},
    {id:2,nombre:"Caja Turno en la tarde", isOpen:false,ultimoCierre:null,balanceCierre:0},
  ];
  const [cajas, setCajas] = useState(()=>{
    try{return JSON.parse(localStorage.getItem(CAJAS_KEY))||defaultCajas;}catch{return defaultCajas;}
  });
  const [balInput, setBalInput] = useState({});
  const [showBal, setShowBal] = useState(null);

  function saveCajas(updated){
    setCajas(updated);
    try{localStorage.setItem(CAJAS_KEY,JSON.stringify(updated));}catch{}
  }
  function abrirCaja(id){
    saveCajas(cajas.map(c=>c.id===id?{...c,isOpen:true}:c));
  }
  function cerrarCaja(id){
    const bal=parseFloat(balInput[id])||0;
    saveCajas(cajas.map(c=>c.id===id?{...c,isOpen:false,ultimoCierre:hoy(),balanceCierre:bal}:c));
    setShowBal(null);
    setBalInput(p=>({...p,[id]:""}));
  }

  const abiertas=cajas.filter(c=>c.isOpen).length;
  const porAbrir=cajas.filter(c=>!c.isOpen).length;

  return (
    <div>
      {/* Stats */}
      <div style={{background:C.bg2,borderRadius:16,padding:"18px 20px",
        display:"flex",justifyContent:"space-between",alignItems:"center",
        border:`1px solid ${C.sep}`,marginBottom:16}}>
        <div>
          <div style={{fontSize:28,fontWeight:800,color:C.gold,fontFamily:FONT,lineHeight:1}}>
            {cajas.length} cajas
          </div>
          <div style={{fontSize:13,color:C.label3,fontFamily:FONT,marginTop:4}}>
            {SUCURSAL_EMP}
          </div>
        </div>
        <div style={{display:"flex",gap:24}}>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:22,fontWeight:800,color:C.green,fontFamily:FONT}}>{abiertas}</div>
            <div style={{fontSize:11,color:C.label3,fontFamily:FONT}}>Cajas abiertas</div>
          </div>
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:22,fontWeight:800,color:C.amber,fontFamily:FONT}}>{porAbrir}</div>
            <div style={{fontSize:11,color:C.label3,fontFamily:FONT}}>Cajas por abrir</div>
          </div>
        </div>
      </div>

      <div style={{marginBottom:8,fontSize:13,fontWeight:600,color:C.label3,
        textTransform:"uppercase",letterSpacing:.8,fontFamily:FONT}}>
        Ir a Configuración de cajas →
      </div>

      {/* Lista de cajas */}
      {cajas.map((c,i)=>(
        <div key={c.id} style={{background:C.bg2,borderRadius:16,padding:20,
          marginBottom:12,border:`1px solid ${C.sep}`,
          opacity:c.isOpen?1:0.85}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:700,color:C.label,fontFamily:FONT,marginBottom:12}}>
                {c.nombre}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div>
                  <div style={{fontSize:11,color:C.label3,fontFamily:FONT,textTransform:"uppercase",
                    letterSpacing:.5,marginBottom:2}}>Último cierre</div>
                  <div style={{fontSize:14,fontWeight:500,color:c.ultimoCierre?C.label:C.label3,fontFamily:FONT}}>
                    {c.ultimoCierre||"---"}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:11,color:C.label3,fontFamily:FONT,textTransform:"uppercase",
                    letterSpacing:.5,marginBottom:2}}>Balance al Cierre</div>
                  <div style={{fontSize:14,fontWeight:500,color:c.balanceCierre>0?C.gold:C.label3,fontFamily:FONT}}>
                    {c.balanceCierre>0?`Bs ${Number(c.balanceCierre).toLocaleString("es-BO",{minimumFractionDigits:2})}`:"---"}
                  </div>
                </div>
              </div>
            </div>
            <div>
              {c.isOpen
                ? <button onClick={()=>setShowBal(showBal===c.id?null:c.id)} style={{
                    background:"#1565C0",border:"none",borderRadius:12,
                    padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,
                    cursor:"pointer",fontFamily:FONT,WebkitTapHighlightColor:"transparent",
                    whiteSpace:"nowrap"}}>
                    CERRAR CAJA
                  </button>
                : <button onClick={()=>abrirCaja(c.id)} style={{
                    background:C.green,border:"none",borderRadius:12,
                    padding:"10px 16px",color:"#fff",fontSize:13,fontWeight:700,
                    cursor:"pointer",fontFamily:FONT,WebkitTapHighlightColor:"transparent",
                    whiteSpace:"nowrap"}}>
                    ABRIR CAJA
                  </button>
              }
            </div>
          </div>

          {c.isOpen&&(
            <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.sep}`,
              display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:C.green,flexShrink:0}}/>
              <span style={{fontSize:12,color:C.green,fontFamily:FONT,fontWeight:600}}>Abierta</span>
            </div>
          )}

          {showBal===c.id&&(
            <div style={{marginTop:14,padding:16,background:C.bg3,borderRadius:12,
              border:`1px solid ${C.sep}`}}>
              <div style={{fontSize:13,color:C.label2,fontFamily:FONT,marginBottom:10,fontWeight:500}}>
                Ingresa el balance al momento del cierre:
              </div>
              <IOSInput
                label="Balance al cierre (Bs)"
                value={balInput[c.id]||""}
                onChange={e=>setBalInput(p=>({...p,[c.id]:e.target.value}))}
                placeholder="0.00"
                type="number"
              />
              <div style={{display:"flex",gap:8,marginTop:8}}>
                <button onClick={()=>setShowBal(null)} style={{
                  flex:1,background:C.bg2,border:`1px solid ${C.sep}`,borderRadius:12,
                  padding:"11px",fontSize:13,color:C.label2,cursor:"pointer",fontFamily:FONT,
                  WebkitTapHighlightColor:"transparent"}}>
                  Cancelar
                </button>
                <button onClick={()=>cerrarCaja(c.id)} style={{
                  flex:1,background:"#1565C0",border:"none",borderRadius:12,
                  padding:"11px",fontSize:13,fontWeight:700,color:"#fff",
                  cursor:"pointer",fontFamily:FONT,WebkitTapHighlightColor:"transparent"}}>
                  Confirmar Cierre
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// APP PRINCIPAL
// ══════════════════════════════════════════════════════════
// ── Comprobante de venta (58mm) ──────────────────────────
function imprimirComprobante(venta) {
  const marca = MARCAS.find(m => m.id === venta.items?.[0]?.marcaId);
  const win = window.open('', '_blank', 'width=300,height=600');
  const items = venta.items || [];
  const itemsHtml = items.map(it => `
    <tr>
      <td style="font-size:11px;padding:2px 0">${it.nombre}</td>
      <td style="font-size:11px;text-align:right;white-space:nowrap">${it.cantidad} x Bs ${it.precioUnit}</td>
    </tr>
    <tr>
      <td colspan="2" style="font-size:10px;color:#666;padding-bottom:4px">${it.marcaNombre}</td>
    </tr>
  `).join('');
  
  const metodos = {efectivo:'Efectivo',qr:'QR',tarjeta:'Tarjeta (+2.5%)'};
  
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Comprobante ${venta.id}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { 
      font-family: 'Courier New', monospace; 
      width: 58mm; 
      padding: 4mm 3mm;
      font-size: 12px;
      color: #000;
    }
    .logo { text-align:center; margin-bottom:6px; }
    .logo img { width:40mm; }
    .header { text-align:center; margin-bottom:8px; border-bottom:1px dashed #000; padding-bottom:6px; }
    .title { font-size:13px; font-weight:bold; letter-spacing:2px; }
    .subtitle { font-size:9px; letter-spacing:3px; color:#444; }
    .address { font-size:9px; color:#555; margin-top:2px; }
    .section { margin:6px 0; }
    .label { font-size:9px; color:#666; text-transform:uppercase; letter-spacing:1px; }
    .value { font-size:11px; }
    table { width:100%; border-collapse:collapse; }
    .total-row { border-top:1px dashed #000; margin-top:6px; padding-top:6px; }
    .total-label { font-size:13px; font-weight:bold; }
    .total-value { font-size:15px; font-weight:bold; text-align:right; }
    .footer { text-align:center; margin-top:8px; border-top:1px dashed #000; padding-top:6px; font-size:9px; color:#666; }
    .id { font-size:8px; color:#999; text-align:center; margin-top:4px; }
    @media print {
      body { width:58mm; }
      button { display:none; }
    }
  </style>
</head>
<body>
  <div class="logo">
    <img src="${LOGO_B64}" alt="Toscana House"/>
  </div>
  <div class="header">
    <div class="address">Equipetrol, Calle 8 Oeste · Santa Cruz</div>
    <div class="address">${venta.fecha} · ${venta.hora}</div>
  </div>

  <div class="section">
    <table>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
  </div>

  <div class="total-row">
    <table>
      <tr>
        ${venta.descPct > 0 ? `
        <tr>
          <td class="label">Subtotal</td>
          <td style="text-align:right">Bs ${venta.subtotal?.toFixed(2)}</td>
        </tr>
        <tr>
          <td class="label">Descuento ${venta.descPct}%</td>
          <td style="text-align:right;color:#c00">-Bs ${(venta.subtotal - venta.total)?.toFixed(2)}</td>
        </tr>
        ` : ''}
        <tr>
          <td class="total-label">TOTAL</td>
          <td class="total-value">Bs ${venta.total?.toFixed(2)}</td>
        </tr>
        <tr>
          <td class="label">Método de pago</td>
          <td style="text-align:right">${metodos[venta.metodoPago] || venta.metodoPago}</td>
        </tr>
        ${venta.vendedor ? `<tr><td class="label">Atendido por</td><td style="text-align:right">${venta.vendedor}</td></tr>` : ''}
        ${venta.clienteNombre ? `<tr><td class="label">Cliente</td><td style="text-align:right">${venta.clienteNombre}</td></tr>` : ''}
        ${venta.conFactura ? `<tr><td class="label">Factura a</td><td style="text-align:right">${venta.factNombre} · NIT: ${venta.factNit}</td></tr>` : ''}
      </tr>
    </table>
  </div>

  <div class="footer">
    <div>¡Gracias por tu compra!</div>
    <div style="margin-top:2px">Toscana House · Casa de Moda</div>
  </div>
  <div class="id">${venta.id}</div>

  <script>
    window.onload = function() { window.print(); }
  </script>
</body>
</html>`);
  win.document.close();
}

// ── Planilla de alquileres ──────────────────────────────
function generarPlanillaAlquileres(ventas, mes, anio) {
  const MK = `${mes}-${anio}`;
  const vMes = ventas.filter(v => v.mes === mes && v.anio === anio);
  
  const win = window.open('', '_blank', 'width=800,height=600');
  
  const rowsHtml = MARCAS.map(m => {
    const alq = ALQUILERES[m.id] || { alquiler: 0, comision: 0 };
    const ventasMarca = vMes.filter(v => v.items?.some(it => it.marcaId === m.id));
    const bruto = ventasMarca.reduce((s, v) => {
      const itemsMarca = v.items?.filter(it => it.marcaId === m.id) || [];
      return s + itemsMarca.reduce((ss, it) => ss + it.subtotal, 0);
    }, 0);
    const comision = alq.comision > 0 ? Math.round(bruto * alq.comision / 100) : 0;
    const totalDesc = alq.alquiler + comision;
    const liquido = bruto - totalDesc;
    
    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 12px">${m.emoji} ${m.nombre}</td>
      <td style="padding:8px 12px;text-align:right">Bs ${bruto.toFixed(2)}</td>
      <td style="padding:8px 12px;text-align:right">Bs ${alq.alquiler.toFixed(2)}</td>
      <td style="padding:8px 12px;text-align:right">${alq.comision > 0 ? `${alq.comision}% = Bs ${comision.toFixed(2)}` : '—'}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:600;color:${liquido >= 0 ? '#2E6B3E' : '#c00'}">Bs ${liquido.toFixed(2)}</td>
    </tr>`;
  }).join('');

  const MESES_N = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const totalBruto = MARCAS.reduce((s, m) => {
    const alq = ALQUILERES[m.id] || { alquiler: 0, comision: 0 };
    const ventasMarca = vMes.filter(v => v.items?.some(it => it.marcaId === m.id));
    const bruto = ventasMarca.reduce((ss, v) => {
      return ss + (v.items?.filter(it => it.marcaId === m.id) || []).reduce((sss, it) => sss + it.subtotal, 0);
    }, 0);
    return s + bruto;
  }, 0);

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Planilla Alquileres ${MESES_N[mes]} ${anio}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; color: #222; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1a3a2a; color: #fff; padding: 10px 12px; text-align: right; font-size: 13px; }
    th:first-child { text-align: left; }
    tr:nth-child(even) { background: #f9f9f9; }
    .total-row { background: #1a3a2a !important; color: #fff; font-weight: bold; }
    .total-row td { padding: 10px 12px; }
    @media print { button { display:none; } }
  </style>
</head>
<body>
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
    <img src="${LOGO_B64}" style="height:60px"/>
    <div>
      <h1>Planilla de Alquileres</h1>
      <div class="sub">${MESES_N[mes]} ${anio} · Toscana House</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Marca</th>
        <th>Ventas Brutas</th>
        <th>Alquiler</th>
        <th>Comisión</th>
        <th>Líquido a Pagar</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="total-row">
        <td>TOTAL</td>
        <td style="text-align:right">Bs ${totalBruto.toFixed(2)}</td>
        <td colspan="2"></td>
        <td style="text-align:right">—</td>
      </tr>
    </tbody>
  </table>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`);
  win.document.close();
}

// ══════════════════════════════════════════════════════════
// KPI CARD — small metric tile
// ══════════════════════════════════════════════════════════
function KPICard({icon, label, val, sub, color}){
  return (
    <div style={{
      background:"#fff", borderRadius:14, padding:"14px 16px",
      border:"1px solid #E2E8F0",
      boxShadow:"0 1px 4px rgba(21,101,192,0.06)",
    }}>
      <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:8}}>
        <div style={{
          width:32, height:32, borderRadius:10,
          background:`${color}18`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:16,
        }}>{icon}</div>
        <span style={{fontSize:12, color:"#64748B", fontFamily:FONT_UI, fontWeight:500}}>{label}</span>
      </div>
      <div style={{fontSize:22, fontWeight:800, color:color, fontFamily:FONT_UI, lineHeight:1}}>{val}</div>
      <div style={{fontSize:11, color:"#94A3B8", fontFamily:FONT_UI, marginTop:4}}>{sub}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// HOME DASHBOARD — vista en tiempo real (KPIs, chart, feed)
// ══════════════════════════════════════════════════════════
function HomeDashboard({ventas, inv, vMes, mes, anio, onGoTab}){
  const [clock, setClock] = useState(
    () => new Date().toLocaleTimeString("es-BO", {hour:"2-digit", minute:"2-digit", second:"2-digit"})
  );
  useEffect(() => {
    const t = setInterval(() => setClock(
      new Date().toLocaleTimeString("es-BO", {hour:"2-digit", minute:"2-digit", second:"2-digit"})
    ), 1000);
    return () => clearInterval(t);
  }, []);

  const hoyStr = new Date().toISOString().slice(0,10);
  const vHoy   = ventas.filter(v => v.fecha === hoyStr);
  const totalHoy = vHoy.reduce((s, v) => s + v.total, 0);
  const totalMes  = vMes.reduce((s, v) => s + v.total, 0);
  const stockTotal = inv.reduce((s, i) => s + (i.stock || 0), 0);

  // ── Últimos 7 días (bar chart) ──────────────────────────
  const last7 = useMemo(() => {
    const days = [];
    for(let i = 6; i >= 0; i--){
      const d = new Date();
      d.setDate(d.getDate() - i);
      const str   = d.toISOString().slice(0,10);
      const total = ventas.filter(v => v.fecha === str).reduce((s,v) => s + v.total, 0);
      const label = d.toLocaleDateString("es-BO", {weekday:"short"}).slice(0,3);
      days.push({str, total, label});
    }
    return days;
  }, [ventas]);
  const maxDay = Math.max(...last7.map(d => d.total), 1);

  // ── Métodos de pago hoy ─────────────────────────────────
  const pagoHoy = {
    efectivo: vHoy.filter(v => v.metodoPago === "efectivo").reduce((s,v) => s+v.total, 0),
    qr:       vHoy.filter(v => v.metodoPago === "qr").reduce((s,v) => s+v.total, 0),
    tarjeta:  vHoy.filter(v => v.metodoPago === "tarjeta").reduce((s,v) => s+v.total, 0),
    mixto:    vHoy.filter(v => v.metodoPago?.startsWith("mixto|")).reduce((s,v) => s+v.total, 0),
  };

  // ── Top 5 marcas del mes ────────────────────────────────
  const topMarcas = useMemo(() => {
    const map = {};
    vMes.forEach(v => v.items.forEach(it => {
      map[it.marcaId] = (map[it.marcaId] || 0) + it.subtotal;
    }));
    return Object.entries(map)
      .map(([id, total]) => ({marca: MARCAS.find(m => m.id === Number(id)), total}))
      .filter(x => x.marca)
      .sort((a,b) => b.total - a.total)
      .slice(0, 5);
  }, [vMes]);
  const maxMarca = Math.max(...topMarcas.map(m => m.total), 1);

  // ── Últimas 6 ventas ────────────────────────────────────
  const ultVentas = useMemo(() =>
    [...ventas]
      .sort((a,b) => (b.createdAt||b.fecha||"").localeCompare(a.createdAt||a.fecha||""))
      .slice(0, 6),
    [ventas]
  );

  const today   = new Date();
  const dayNames = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const dateStr  = `${dayNames[today.getDay()]}, ${today.getDate()} de ${MESES[today.getMonth()]} ${today.getFullYear()}`;

  const cardStyle = {
    background:"#fff", borderRadius:14, padding:"14px 16px",
    border:"1px solid #E2E8F0", boxShadow:"0 1px 4px rgba(21,101,192,0.06)",
    marginBottom:14,
  };

  return (
    <div style={{paddingBottom:8}}>

      {/* ── Reloj / fecha ── */}
      <div style={{textAlign:"center", marginBottom:20}}>
        <div style={{fontSize:38, fontWeight:800, color:C.gold, fontFamily:FONT_UI,
          letterSpacing:-1, lineHeight:1}}>{clock}</div>
        <div style={{fontSize:13, color:C.label3, fontFamily:FONT_UI, marginTop:4}}>{dateStr}</div>
      </div>

      {/* ── KPI 2×2 grid ── */}
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14}}>
        <KPICard icon="💰" label="Ventas hoy"
          val={`Bs ${new Intl.NumberFormat("es-BO",{minimumFractionDigits:0,maximumFractionDigits:0}).format(totalHoy)}`}
          sub={`${vHoy.length} transacción${vHoy.length!==1?"es":""}`}
          color="#2E7D32"/>
        <KPICard icon="📅" label={`Ventas ${MESES[mes].slice(0,3)}`}
          val={`Bs ${new Intl.NumberFormat("es-BO",{minimumFractionDigits:0,maximumFractionDigits:0}).format(totalMes)}`}
          sub={`${vMes.length} transacciones`}
          color={C.gold}/>
        <KPICard icon="📦" label="Stock total"
          val={stockTotal.toLocaleString()}
          sub="unidades en tienda"
          color={C.indigo}/>
        <KPICard icon="🏷️" label="Marcas activas"
          val={MARCAS.length}
          sub="marcas en tienda"
          color={C.amber}/>
      </div>

      {/* ── Bar chart últimos 7 días ── */}
      <div style={cardStyle}>
        <div style={{fontSize:13, fontWeight:700, color:C.label2, fontFamily:FONT_UI, marginBottom:14}}>
          Últimos 7 días
        </div>
        <div style={{display:"flex", alignItems:"flex-end", gap:6, height:80}}>
          {last7.map((d, i) => {
            const pct    = d.total / maxDay;
            const isToday = d.str === hoyStr;
            return (
              <div key={i} style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4}}>
                <div style={{width:"100%", display:"flex", flexDirection:"column", justifyContent:"flex-end", height:64}}>
                  <div style={{
                    width:"100%",
                    height: d.total > 0 ? Math.max(pct * 64, 4) : 0,
                    background: isToday ? C.gold : `${C.gold}50`,
                    borderRadius:"4px 4px 0 0",
                    transition:"height .35s ease",
                  }}/>
                </div>
                <div style={{fontSize:9, fontFamily:FONT_UI,
                  color: isToday ? C.gold : C.label3,
                  fontWeight: isToday ? 700 : 400,
                }}>{d.label}</div>
              </div>
            );
          })}
        </div>
        {totalHoy > 0 && (
          <div style={{fontSize:11, color:C.label3, fontFamily:FONT_UI, textAlign:"center", marginTop:8}}>
            Hoy: Bs {new Intl.NumberFormat("es-BO",{minimumFractionDigits:0,maximumFractionDigits:0}).format(totalHoy)}
          </div>
        )}
      </div>

      {/* ── Métodos de pago hoy ── */}
      {totalHoy > 0 && (
        <div style={cardStyle}>
          <div style={{fontSize:13, fontWeight:700, color:C.label2, fontFamily:FONT_UI, marginBottom:10}}>
            Métodos de pago — hoy
          </div>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
            {[
              {label:"Efectivo", val:pagoHoy.efectivo, icon:"💵", color:"#2E7D32"},
              {label:"QR",       val:pagoHoy.qr,       icon:"📱", color:"#1565C0"},
              {label:"Tarjeta",  val:pagoHoy.tarjeta,  icon:"💳", color:"#E65100"},
              {label:"Mixto",    val:pagoHoy.mixto,    icon:"🔀", color:"#6C5CE7"},
            ].filter(p => p.val > 0).map(p => (
              <div key={p.label} style={{
                background:`${p.color}08`, borderRadius:10, padding:"10px 12px",
                border:`1px solid ${p.color}20`,
              }}>
                <div style={{fontSize:11, color:p.color, fontFamily:FONT_UI, fontWeight:600, marginBottom:4}}>
                  {p.icon} {p.label}
                </div>
                <div style={{fontSize:16, fontWeight:800, color:p.color, fontFamily:FONT_UI}}>
                  Bs {new Intl.NumberFormat("es-BO",{minimumFractionDigits:0,maximumFractionDigits:0}).format(p.val)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Top marcas del mes ── */}
      {topMarcas.length > 0 && (
        <div style={cardStyle}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
            <div style={{fontSize:13, fontWeight:700, color:C.label2, fontFamily:FONT_UI}}>
              Top marcas — {MESES[mes]}
            </div>
            <button onClick={() => onGoTab("marcas")} style={{
              fontSize:12, color:C.gold, fontFamily:FONT_UI, fontWeight:600,
              background:"none", border:"none", cursor:"pointer", padding:0,
            }}>Ver todas →</button>
          </div>
          {topMarcas.map((m, i) => (
            <div key={m.marca.id} style={{marginBottom: i < topMarcas.length - 1 ? 12 : 0}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4}}>
                <div style={{display:"flex", alignItems:"center", gap:6}}>
                  <span style={{fontSize:14}}>{m.marca.emoji}</span>
                  <span style={{fontSize:13, fontWeight:600, color:C.label, fontFamily:FONT_UI}}>{m.marca.nombre}</span>
                </div>
                <span style={{fontSize:12, fontWeight:700, color:m.marca.color, fontFamily:FONT_UI}}>
                  Bs {new Intl.NumberFormat("es-BO",{minimumFractionDigits:0,maximumFractionDigits:0}).format(m.total)}
                </span>
              </div>
              <div style={{height:6, background:"#F1F5F9", borderRadius:3, overflow:"hidden"}}>
                <div style={{
                  height:6,
                  width:`${(m.total / maxMarca) * 100}%`,
                  background:m.marca.color,
                  borderRadius:3,
                  transition:"width .4s ease",
                }}/>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Últimas ventas ── */}
      {ultVentas.length > 0 && (
        <div style={cardStyle}>
          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12}}>
            <div style={{fontSize:13, fontWeight:700, color:C.label2, fontFamily:FONT_UI}}>Últimas ventas</div>
            <button onClick={() => onGoTab("ventas")} style={{
              fontSize:12, color:C.gold, fontFamily:FONT_UI, fontWeight:600,
              background:"none", border:"none", cursor:"pointer", padding:0,
            }}>Ver todas →</button>
          </div>
          {ultVentas.map((v, i) => (
            <div key={v.id || i} style={{
              display:"flex", justifyContent:"space-between", alignItems:"center",
              padding:"9px 0",
              borderBottom: i < ultVentas.length - 1 ? "1px solid #F1F5F9" : "",
            }}>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:13, fontWeight:600, color:C.label, fontFamily:FONT_UI,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                  {iconPago(v.metodoPago)} {v.items?.map(it => it.nombre).join(", ") || "Venta"}
                </div>
                <div style={{fontSize:11, color:C.label3, fontFamily:FONT_UI}}>
                  {v.fecha} · {labelPago(v.metodoPago)}
                </div>
              </div>
              <div style={{fontSize:14, fontWeight:800, color:"#2E7D32", fontFamily:FONT_UI, marginLeft:12}}>
                Bs {new Intl.NumberFormat("es-BO",{minimumFractionDigits:0,maximumFractionDigits:0}).format(v.total)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Accesos rápidos ── */}
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:8}}>
        {[
          {icon:"⊕", label:"Nueva venta",    tab:"pos",           color:C.gold},
          {icon:"◫", label:"Inventario",      tab:"inventario",    color:C.indigo},
          {icon:"◈", label:"Ver ventas",      tab:"ventas",        color:"#00695C"},
          {icon:"◎", label:"Liquidaciones",   tab:"liquidaciones", color:"#AD1457"},
        ].map(a => (
          <button key={a.tab} onClick={() => onGoTab(a.tab)} style={{
            background:`${a.color}10`, borderRadius:12, padding:"14px 12px",
            border:`1px solid ${a.color}25`,
            display:"flex", alignItems:"center", gap:10,
            cursor:"pointer", WebkitTapHighlightColor:"transparent",
            transition:"background .15s",
          }}>
            <span style={{fontSize:22}}>{a.icon}</span>
            <span style={{fontSize:13, fontWeight:700, color:a.color, fontFamily:FONT_UI}}>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function App(){
  const { user, login, logout } = useAuth();
  const now=new Date();
  const[tab,setTab]         =useState("inicio");
  const[inv,setInv]         =useState([]);
  const[ventas,setVentas]   =useState([]);
  const[alq,setAlq]         =useState([]);
  const[cierres,setCierres] =useState({});
  const[cargando,setCargando]=useState(true);
  const[dbStatus,setDbStatus]=useState("connecting");
  const[mes,setMes]         =useState(now.getMonth());
  const[anio,setAnio]       =useState(now.getFullYear());
  const[marcaDetalle,setMD] =useState(null);
  const[sheetInv,setShInv]  =useState(false);
  const[sheetBaja,setShBaja]=useState(false);
  const[shExcel,setShExcel]=useState(false);
  const[sheetDrive,setShDrive]=useState(false);
  const[mLiq,setMLiq]       =useState(null);
  const[fInv,setFInv]       =useState({marcaId:"",nombre:"",categoria:"",descripcion:"",subcat:"",precio:"",stock:"",fecha:hoy()});
  const[bajaCod,setBajaCod] =useState("");
  const[bajaMsg,setBajaMsg] =useState(null);
  const[bajasLista,setBajasLista]=useState([]);
  const[busqInv,setBusqInv] =useState("");
  const[filInvM,setFilInvM] =useState("");
  const[driveUrl,setDriveUrlLocal]=useState(()=>{ try{return localStorage.getItem("th_drive_url")||"";}catch{return "";} });
  const[generando,setGenerando]=useState(false);
  const[retiros,setRetiros]    =useState(()=>{ try{return JSON.parse(localStorage.getItem("th_retiros_v1")||"[]");}catch{return[];} });
  const[ventaDetalle,setVentaDetalle]=useState(null);
  const drive = useDriveSync();

  // Cargar retiros desde Supabase al inicio
  useEffect(()=>{
    sbCargarRetiros().then(data=>{ if(data.length>0) setRetiros(data); });
  },[]);

  function registrarRetiro(r){
    const updated=[...retiros,r];
    setRetiros(updated);
    try{localStorage.setItem("th_retiros_v1",JSON.stringify(updated));}catch{}
    // Dar de baja del inventario
    setInv(p=>p.map(i=>i.id===r.prodId?{...i,stock:Math.max(0,i.stock-r.cantidad)}:i));
    sbActualizarStock(r.prodId, Math.max(0,(inv.find(i=>i.id===r.prodId)?.stock||0)-r.cantidad));
    sbGuardarRetiro(r);
  }

  // Cargar datos desde Supabase al inicio
  useEffect(()=>{
    setDbStatus("connecting");
    sbCargarTodo().then(data=>{
      if(data){
        if(data.inv.length>0)    setInv(data.inv);
        if(data.ventas.length>0) setVentas(data.ventas);
        if(Object.keys(data.cierres).length>0) setCierres(data.cierres);
        setDbStatus("ok");
      } else {
        setDbStatus("error");
      }
      setCargando(false);
    });
  },[]);

  const MK      =useMemo(()=>mkKey(mes,anio),[mes,anio]);
  const vMes    =useMemo(()=>ventas.filter(v=>v.mk===MK),[ventas,MK]);
  const alqMes  =useMemo(()=>alq.filter(a=>a.mes===mes&&a.anio===anio),[alq,mes,anio]);
  const totalVtas=useMemo(()=>vMes.reduce((s,v)=>s+v.total,0),[vMes]);

  const invFil=useMemo(()=>{
    let r=inv;
    if(busqInv){const q=busqInv.toLowerCase();r=r.filter(i=>i.nombre.toLowerCase().includes(q)||i.codigo.toLowerCase().includes(q));}
    if(filInvM) r=r.filter(i=>i.marcaId===Number(filInvM));
    return r;
  },[inv,busqInv,filInvM]);

  function addProd(){
    if(!fInv.marcaId||!fInv.nombre||!fInv.precio||!fInv.stock){alert("Completa todos los campos");return;}
    const idx=inv.length+1;
    const marca=MARCAS.find(m=>m.id===Number(fInv.marcaId));
    const prod={id:Date.now(),codigo:genCod(Number(fInv.marcaId),fInv.nombre,idx),
      marcaId:Number(fInv.marcaId),nombre:fInv.nombre,categoria:fInv.categoria||"General",
      precio:Number(fInv.precio),stock:Number(fInv.stock),stockInicial:Number(fInv.stock),fecha:fInv.fecha,
      marcaNombre:marca?.nombre||""};
    setInv(p=>[...p,prod]);
    drive.syncProducto(prod);
    sbGuardarProducto(prod); // guardar en nube
    setFInv({marcaId:"",nombre:"",categoria:"",precio:"",stock:"",fecha:hoy()});
    setShInv(false);
    setTimeout(()=>imprimirTicket(prod, marca?.nombre||"Toscana House"), 300);
  }

  function darBaja(){
    const cod=bajaCod.trim().toUpperCase();
    const prod=inv.find(i=>i.codigo.toUpperCase()===cod);
    if(!prod){setBajaMsg({ok:false,msg:`"${cod}" no encontrado`});return;}
    if(prod.stock<=0){setBajaMsg({ok:false,msg:`"${prod.nombre}" ya está agotado`});return;}
    setInv(p=>p.map(i=>i.id===prod.id?{...i,stock:0}:i));
    setBajaMsg({ok:true,msg:`✓ "${prod.nombre}" dado de baja`});
    setBajaCod("");
  }

  function handleVenta(v){
    const id=`V${Date.now()}`;
    const vf={...v,id,fecha:hoy(),hora:hora(),mk:MK,mes,anio};
    setVentas(p=>[...p,vf]);
    v.items.forEach(it=>{
      setInv(p=>p.map(i=>i.id===it.prodId?{...i,stock:Math.max(0,i.stock-it.cantidad)}:i));
      sbActualizarStock(it.prodId, Math.max(0,(inv.find(i=>i.id===it.prodId)?.stock||0)-it.cantidad));
    });
    drive.syncVenta(vf);
    sbGuardarVenta(vf); // guardar en nube
    return vf;
  }

  function toggleAlq(marcaId){
    const e=alqMes.find(a=>a.marcaId===marcaId);
    if(e) setAlq(p=>p.map(a=>a.marcaId===marcaId&&a.mes===mes&&a.anio===anio?{...a,pagado:!a.pagado,fechaPago:!a.pagado?hoy():""}:a));
    else  setAlq(p=>[...p,{id:Date.now(),marcaId,mes,anio,pagado:true,fechaPago:hoy()}]);
  }

  const getLiq=useCallback((marcaId)=>{
    const marca=MARCAS.find(m=>m.id===marcaId);
    const vM=vMes.filter(v=>v.items.some(i=>i.marcaId===marcaId));
    const bruto=vM.reduce((s,v)=>s+v.items.filter(i=>i.marcaId===marcaId).reduce((ss,i)=>ss+i.subtotal,0),0);
    return{marca,vMarca:vM,bruto,comision:bruto*.1,neto:bruto*.9,
           alqPagado:alqMes.find(a=>a.marcaId===marcaId)?.pagado||false};
  },[vMes,alqMes]);

  const getHist=useCallback((marcaId)=>{
    const map={};
    ventas.forEach(v=>{
      if(!v.items.some(i=>i.marcaId===marcaId))return;
      if(!map[v.mk])map[v.mk]={mk:v.mk,mes:v.mes,anio:v.anio,ventas:[],bruto:0};
      const its=v.items.filter(i=>i.marcaId===marcaId);
      const sub=its.reduce((s,i)=>s+i.subtotal,0);
      map[v.mk].ventas.push({...v,itsMarca:its,subMarca:sub});
      map[v.mk].bruto+=sub;
    });
    return Object.values(map).sort((a,b)=>b.mk.localeCompare(a.mk));
  },[ventas]);

  const TABS=[
    {id:"inicio",        icon:"⊞", label:"Inicio"},
    {id:"pos",           icon:"⊕", label:"Caja"},
    {id:"ventas",        icon:"◈", label:"Ventas"},
    {id:"inventario",    icon:"◫", label:"Inventario"},
    {id:"marcas",        icon:"◆", label:"Marcas"},
    {id:"liquidaciones", icon:"◎", label:"Liquidar"},
    {id:"config",        icon:"⚙", label:"Config"},
  ];

  // Pantallas con vista de detalle (back button)
  const showingDetail = tab==="marcas" && marcaDetalle;
  // Pasar dbStatus al NavBar via closure (ya está en scope)

  // Early return si no hay sesión
  if (!user) return <LoginScreen onLogin={login}/>;

  return (
    <div style={{
      minHeight:"100vh",
      background:C.bg0,
      color:C.label,
      fontFamily:FONT_UI,
      paddingBottom:84, // espacio para tab bar + safe area
      WebkitFontSmoothing:"antialiased",
      MozOsxFontSmoothing:"grayscale",
    }}>

      {/* ── LOADING SCREEN ── */}
      {cargando&&(
        <div style={{position:"fixed",inset:0,background:"rgba(244,247,251,0.97)",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          zIndex:9999,gap:20}}>
          <LogoMark size={48} color={C.gold}/>
          <div style={{fontSize:15,color:C.label2,fontFamily:FONT}}>Cargando datos…</div>
          <div style={{width:48,height:4,borderRadius:2,background:C.sep,overflow:"hidden"}}>
            <div style={{width:"60%",height:4,background:C.gold,borderRadius:2,
              animation:"loadbar 1.2s ease-in-out infinite"}}/>
          </div>
          <style>{`@keyframes loadbar{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}`}</style>
        </div>
      )}

      {/* ── NAV BAR ── */}
      {showingDetail ? (
        <NavBar
          title={MARCAS.find(m=>m.id===marcaDetalle)?.nombre}
          back="Marcas"
          onBack={()=>setMD(null)}
          right={
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <button onClick={()=>exportCSV(MARCAS.find(m=>m.id===marcaDetalle),ventas,mes,anio)}
                style={{background:"none",border:"none",color:C.label3,fontSize:13,fontFamily:FONT,
                  cursor:"pointer",padding:"4px 0",WebkitTapHighlightColor:"transparent"}}>CSV</button>
              <button
                disabled={generando}
                onClick={()=>generarExcelMarca(MARCAS.find(m=>m.id===marcaDetalle),ventas,inv,setGenerando)}
                style={{background:`${C.gold}20`,border:`1px solid ${C.gold}40`,color:C.gold,
                  borderRadius:8,padding:"5px 12px",fontSize:13,fontFamily:FONT,fontWeight:600,
                  cursor:generando?"not-allowed":"pointer",WebkitTapHighlightColor:"transparent"}}>
                {generando?"…":"📊 Excel"}
              </button>
            </div>
          }
        />
      ):(
        <NavBar
          title="Toscana House"
          subtitle={`${MESES[mes]} ${anio} · ${dbStatus==="ok"?"☁ Nube ✓":dbStatus==="error"?"Sin conexión":"Conectando…"}`}
          right={
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <DriveIndicator syncing={drive.syncing} connected={!!drive.url}/>
              <button onClick={()=>setShDrive(true)} style={{
                background:"none",border:"none",fontSize:20,cursor:"pointer",
                color:drive.url?C.green:C.label3,padding:"4px",
                WebkitTapHighlightColor:"transparent",lineHeight:1,
              }}>☁</button>
              <button onClick={logout} style={{
                background:"none",fontSize:13,cursor:"pointer",
                color:C.label3,padding:"4px 8px",fontFamily:FONT,
                WebkitTapHighlightColor:"transparent",
                border:`1px solid ${C.sep}`,borderRadius:8,
              }}>Salir</button>
              <select value={mes} onChange={e=>setMes(Number(e.target.value))}
                style={{background:"none",border:"none",color:C.gold,fontSize:14,
                  fontFamily:FONT,cursor:"pointer",outline:"none",
                  WebkitAppearance:"none",padding:"4px 0"}}>
                {MESES.map((m,i)=><option key={i} value={i} style={{background:C.bg1}}>{m.slice(0,3)}</option>)}
              </select>
            </div>
          }
        />
      )}

      {/* ── CONTENT ── */}
      <div style={{padding:"16px 16px 0"}}>

        {/* INICIO — dashboard */}
        {tab==="inicio" && (
          <HomeDashboard
            ventas={ventas} inv={inv} vMes={vMes}
            mes={mes} anio={anio}
            onGoTab={setTab}
          />
        )}

        {/* POS */}
        {tab==="pos" && <POSContainer inv={inv} onVenta={handleVenta} retiros={retiros} onRetiro={registrarRetiro}/>}

        {/* INVENTARIO — por marca */}
        {tab==="inventario" && (
          <InventarioPorMarca inv={inv} ventas={ventas} onRecibir={()=>setShInv(true)} onBaja={()=>{setShBaja(true);setBajaMsg(null);setBajaCod("");}}/>
        )}

        {/* MARCAS — lista */}
        {tab==="marcas" && !marcaDetalle && (
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.label3,textTransform:"uppercase",
              letterSpacing:.8,marginBottom:12,paddingLeft:4}}>17 Marcas Activas</div>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              {MARCAS.map((m,i)=>{
                const total=vMes.reduce((s,v)=>s+v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0),0);
                const prods=inv.filter(i=>i.marcaId===m.id).filter(p=>p.stock>0).length;
                const cerrado=cierres[`${MK}-${m.id}`]?.cerrado;
                return (
                  <div key={m.id} onClick={()=>setMD(m.id)} style={{
                    background:C.bg2,
                    borderRadius:i===0?"14px 14px 2px 2px":i===MARCAS.length-1?"2px 2px 14px 14px":"2px",
                    padding:"14px 16px",
                    borderBottom:i<MARCAS.length-1?`1px solid ${C.sep}`:"",
                    display:"flex",alignItems:"center",gap:14,
                    cursor:"pointer",
                    WebkitTapHighlightColor:"transparent",
                    userSelect:"none",
                  }}>
                    <div style={{width:42,height:42,borderRadius:12,
                      background:`${m.color}22`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:20,flexShrink:0}}>{m.emoji}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:16,fontWeight:500,color:C.label,fontFamily:FONT}}>{m.nombre}</div>
                      <div style={{fontSize:13,color:C.label3,fontFamily:FONT}}>
                        {prods} producto{prods!==1?"s":""}
                        {total>0&&` · ${$(total)}`}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                      {cerrado&&<Chip color={C.green} small>✓</Chip>}
                      <span style={{color:C.label3,fontSize:22}}>›</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* MARCAS — detalle */}
        {tab==="marcas" && marcaDetalle && (
          <MarcaDetalle
            marcaId={marcaDetalle}
            inv={inv} ventas={ventas} vMes={vMes}
            mes={mes} anio={anio} MK={MK}
            cierres={cierres} setCierres={setCierres}
            getHist={getHist} getLiq={getLiq}
          />
        )}

        {/* VENTAS */}
        {tab==="ventas" && (
          <VentasTab vMes={vMes} totalVtas={totalVtas} mes={mes} anio={anio}
            onVentaClick={v=>setVentaDetalle(v)}/>
        )}

        {/* DASHBOARD */}
        {tab==="dashboard" && (
          <DashboardVentas ventas={ventas} onVentaClick={v=>setVentaDetalle(v)}/>
        )}

        {/* LIQUIDACIONES */}
        {tab==="liquidaciones" && (
          <div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:C.label3,textTransform:"uppercase",
                letterSpacing:.8,marginBottom:12,fontFamily:FONT_UI}}>{MESES[mes]} {anio}</div>

              {/* Totales por método de pago */}
              {(()=>{
                const ef=vMes.filter(v=>v.metodoPago==="efectivo").reduce((s,v)=>s+v.total,0);
                const qr=vMes.filter(v=>v.metodoPago==="qr").reduce((s,v)=>s+v.total,0);
                const tj=vMes.filter(v=>v.metodoPago==="tarjeta").reduce((s,v)=>s+v.total,0);
                const conFact=vMes.filter(v=>v.conFactura);
                return (
                  <div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:12}}>
                      {[
                        {label:"Total mes",value:$(vMes.reduce((s,v)=>s+v.total,0)),color:C.label,bg:C.bg2},
                        {label:"Efectivo",value:$(ef),color:C.green,bg:`${C.green}10`},
                        {label:"QR",value:$(qr),color:C.blue,bg:`${C.blue}10`},
                        {label:"Tarjeta",value:$(tj),color:C.amber,bg:`${C.amber}10`},
                      ].map(s=>(
                        <div key={s.label} style={{background:s.bg,borderRadius:14,padding:"12px 10px",
                          border:`1px solid ${s.color}25`,textAlign:"center"}}>
                          <div style={{fontSize:10,fontWeight:700,color:s.color,fontFamily:FONT_UI,
                            textTransform:"uppercase",letterSpacing:.6,marginBottom:4,opacity:.8}}>{s.label}</div>
                          <div style={{fontSize:16,fontWeight:700,color:s.color,fontFamily:FONT_UI}}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Conciliación de pagos */}
                    <div style={{background:C.bg2,borderRadius:14,border:`1px solid ${C.sep}`,
                      padding:"14px 16px",marginBottom:12}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.label3,textTransform:"uppercase",
                        letterSpacing:.8,marginBottom:12,fontFamily:FONT_UI}}>Conciliación de pagos</div>
                      {[
                        {label:"Efectivo",val:ef,n:vMes.filter(v=>v.metodoPago==="efectivo").length,color:C.green,icon:"💵"},
                        {label:"QR",val:qr,n:vMes.filter(v=>v.metodoPago==="qr").length,color:C.blue,icon:"📱"},
                        {label:"Tarjeta (+2.5%)",val:tj,n:vMes.filter(v=>v.metodoPago==="tarjeta").length,color:C.amber,icon:"💳"},
                      ].map((p,i,arr)=>(
                        <div key={p.label} style={{display:"flex",justifyContent:"space-between",
                          alignItems:"center",padding:"10px 0",
                          borderBottom:i<arr.length-1?`1px solid ${C.sep}`:""}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <span style={{fontSize:18}}>{p.icon}</span>
                            <div>
                              <div style={{fontSize:14,fontWeight:600,color:C.label,fontFamily:FONT_UI}}>{p.label}</div>
                              <div style={{fontSize:12,color:C.label3,fontFamily:FONT_UI}}>{p.n} transacciones</div>
                            </div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:15,fontWeight:700,color:p.color,fontFamily:FONT_UI}}>{$(p.val)}</div>
                            {p.val>0&&<div style={{fontSize:10,color:C.green,fontFamily:FONT_UI,fontWeight:600}}>✓ Registrado</div>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Ventas con factura */}
                    {conFact.length>0&&(
                      <div style={{background:`${C.blue}08`,borderRadius:14,border:`1px solid ${C.blue}25`,
                        padding:"12px 16px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:C.blue,fontFamily:FONT_UI}}>🧾 Ventas con factura</div>
                          <div style={{fontSize:12,color:C.label3,fontFamily:FONT_UI,marginTop:2}}>{conFact.length} venta{conFact.length>1?"s":""} este mes</div>
                        </div>
                        <div style={{fontSize:15,fontWeight:700,color:C.blue,fontFamily:FONT_UI}}>
                          {$(conFact.reduce((s,v)=>s+v.total,0))}
                        </div>
                      </div>
                    )}

                    {/* Estado general del cierre */}
                    {(()=>{
                      const cerradas=MARCAS.filter(m=>cierres[`${MK}-${m.id}`]?.cerrado).length;
                      const conVentas=MARCAS.filter(m=>getLiq(m.id).bruto>0).length;
                      const pct=conVentas>0?Math.round(cerradas/conVentas*100):0;
                      return (
                        <div style={{background:C.bg2,borderRadius:14,border:`1px solid ${C.sep}`,
                          padding:"12px 16px",marginBottom:12}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <div style={{fontSize:13,fontWeight:700,color:C.label,fontFamily:FONT_UI}}>
                              Progreso de cierres
                            </div>
                            <div style={{fontSize:13,fontWeight:700,
                              color:pct===100?C.green:C.amber,fontFamily:FONT_UI}}>
                              {cerradas}/{conVentas} marcas
                            </div>
                          </div>
                          <div style={{height:8,background:C.sep,borderRadius:4,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${pct}%`,
                              background:pct===100?C.green:C.amber,
                              borderRadius:4,transition:"width .3s"}}/>
                          </div>
                          {pct===100&&(
                            <div style={{fontSize:12,color:C.green,fontFamily:FONT_UI,marginTop:6,textAlign:"center",fontWeight:600}}>
                              ✓ Todas las marcas con ventas están cerradas
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* Botones Excel + Planilla */}
              <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                <button onClick={()=>generarPlanillaAlquileres(ventas,mes,anio)}
                  style={{flex:1,background:`${C.gold}15`,border:`1px solid ${C.gold}40`,
                    borderRadius:12,padding:"11px 10px",color:C.gold,
                    fontSize:12,fontFamily:FONT_UI,fontWeight:700,cursor:"pointer",
                    display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  📋 Planilla Alquileres
                </button>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                <button onClick={()=>generarExcelMensual(ventas,inv,mes,anio,setGenerando)}
                  disabled={generando}
                  style={{flex:1,background:generando?C.bg2:`${C.green}20`,border:`1px solid ${generando?C.sep:C.green}40`,
                    borderRadius:12,padding:"12px 10px",color:generando?C.label3:C.green,
                    fontSize:13,fontFamily:FONT,fontWeight:600,cursor:generando?"not-allowed":"pointer",
                    WebkitTapHighlightColor:"transparent",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  {generando?"⏳ Generando…":"📊 Reporte Mensual .xlsx"}
                </button>
                <button onClick={()=>generarExcelStock(inv,setGenerando)}
                  disabled={generando}
                  style={{flex:1,background:generando?C.bg2:`${C.blue}20`,border:`1px solid ${generando?C.sep:C.blue}40`,
                    borderRadius:12,padding:"12px 10px",color:generando?C.label3:C.blue,
                    fontSize:13,fontFamily:FONT,fontWeight:600,cursor:generando?"not-allowed":"pointer",
                    WebkitTapHighlightColor:"transparent",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  {generando?"⏳":"📦 Stock .xlsx"}
                </button>
              </div>
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              {MARCAS.map((m,i)=>{
                const liq=getLiq(m.id);
                const cerrado=cierres[`${MK}-${m.id}`]?.cerrado;
                return (
                  <div key={m.id} onClick={()=>setMLiq(m.id)} style={{
                    background:C.bg2,
                    borderRadius:i===0?"14px 14px 2px 2px":i===MARCAS.length-1?"2px 2px 14px 14px":"2px",
                    padding:"14px 16px",
                    borderBottom:i<MARCAS.length-1?`1px solid ${C.sep}`:"",
                    display:"flex",alignItems:"center",gap:12,
                    cursor:"pointer",WebkitTapHighlightColor:"transparent",
                  }}>
                    <div style={{width:38,height:38,borderRadius:10,
                      background:`${m.color}22`,display:"flex",alignItems:"center",
                      justifyContent:"center",fontSize:18,flexShrink:0}}>{m.emoji}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:16,fontWeight:500,color:C.label,fontFamily:FONT}}>{m.nombre}</div>
                      <div style={{fontSize:13,color:liq.bruto>0?C.gold:C.label3,fontFamily:FONT}}>
                        {liq.bruto>0 ? `${$(liq.neto)} neto` : "Sin ventas"}
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {cerrado
                        ? <Chip color={C.green} small>✓ Cerrado</Chip>
                        : liq.bruto>0&&<Chip color={C.amber} small>Pendiente</Chip>
                      }
                      <span style={{color:C.label3,fontSize:22}}>›</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CAJAS */}
        {tab==="cajas" && <CajasTab/>}

        {/* HISTORIAL */}
        {tab==="historial" && (
          <HistorialTab ventas={ventas} inv={inv} cierres={cierres}
            onVentaClick={v=>setVentaDetalle(v)}/>
        )}

        {/* CONFIG */}
        {tab==="config" && (
          <ConfigTab user={user} logout={logout}/>
        )}
      </div>

      {/* ── BOTTOM TAB BAR ── */}
      <TabBar tabs={TABS} active={tab} onChange={t=>{setTab(t);setMD(null);}}/>

      {/* ── NOTA DE VENTA MODAL ── */}
      <NotaVentaModal
        venta={ventaDetalle}
        numVenta={ventaDetalle?ventaDetalle.id.replace(/\D/g,"").slice(-4).padStart(4,"0"):null}
        onClose={()=>setVentaDetalle(null)}
      />

      {/* ══ SHEETS ══ */}

      {/* Sheet: Recibir Producto */}
      <SheetRecibir
        open={sheetInv}
        onClose={()=>setShInv(false)}
        inv={inv}
        onAdd={addProd}
        fInv={fInv}
        setFInv={setFInv}
      />

      {/* Sheet: Dar de Baja */}
      <Sheet open={sheetBaja} onClose={()=>setShBaja(false)} title="Dar de Baja por Código">
        <p style={{color:C.label2,fontFamily:FONT,fontSize:15,margin:"0 0 16px"}}>
          Ingresa el código del producto para marcarlo como agotado.
        </p>
        <IOSInput label="Código del producto" value={bajaCod}
          onChange={e=>{setBajaCod(e.target.value.toUpperCase());setBajaMsg(null);}}
          placeholder="Ej: DON-CREM-0001"
          style={{fontFamily:"monospace",textTransform:"uppercase"}}/>
        {bajaMsg&&(
          <div style={{padding:"12px 14px",borderRadius:12,marginBottom:12,
            background:bajaMsg.ok?`${C.green}15`:`${C.red}15`,
            border:`1px solid ${(bajaMsg.ok?C.green:C.red)}40`,
            color:bajaMsg.ok?C.green:C.red,fontSize:14,fontFamily:FONT}}>{bajaMsg.msg}</div>
        )}
        <IOSBtn onPress={darBaja} variant="danger" full disabled={!bajaCod.trim()}>Dar de Baja</IOSBtn>
      </Sheet>

      {/* ══ DRIVE CONFIG SHEET ══ */}
      <Sheet open={sheetDrive} onClose={()=>setShDrive(false)} title="☁ Google Drive" tall>
        {/* Status */}
        <div style={{background:drive.url?`${C.green}15`:`${C.label3}10`,borderRadius:16,
          padding:"16px",marginBottom:20,border:`1px solid ${drive.url?C.green+"30":C.sep}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
            <div style={{width:10,height:10,borderRadius:"50%",
              background:drive.url?C.green:C.label3,flexShrink:0}}/>
            <span style={{fontSize:15,fontWeight:600,color:drive.url?C.green:C.label2,fontFamily:FONT}}>
              {drive.url?"Conectado a Google Drive":"Sin conectar"}
            </span>
          </div>
          {drive.url&&<div style={{fontSize:12,color:C.label3,fontFamily:"monospace",
            wordBreak:"break-all"}}>{drive.url.slice(0,60)}…</div>}
        </div>

        {/* URL input */}
        <div style={{marginBottom:8}}>
          <div style={{fontSize:13,fontWeight:500,color:C.label2,fontFamily:FONT,marginBottom:6}}>
            URL de Google Apps Script
          </div>
          <textarea
            value={drive.url}
            onChange={e=>drive.saveUrl(e.target.value.trim())}
            placeholder="https://script.google.com/macros/s/AKfy.../exec"
            rows={3}
            style={{width:"100%",padding:"12px 14px",borderRadius:12,
              border:`1.5px solid ${C.sep}`,background:C.bg2,
              fontSize:13,color:C.label,outline:"none",fontFamily:"monospace",
              boxSizing:"border-box",resize:"none",lineHeight:1.4}}
            onFocus={e=>e.target.style.borderColor=C.gold}
            onBlur={e=>e.target.style.borderColor=C.sep}
          />
        </div>
        <p style={{fontSize:12,color:C.label3,fontFamily:FONT,margin:"0 0 16px",lineHeight:1.5}}>
          Ver instrucciones de configuración en el archivo <strong style={{color:C.gold}}>apps-script.js</strong> incluido en el paquete.
        </p>

        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
          <IOSBtn onPress={async()=>{
            const r=await drive.testConnection();
            if(r.ok) alert("✓ Conexión exitosa con Google Drive");
            else alert("✗ Error: "+(r.error||"No se pudo conectar"));
          }} variant="fill" full icon="🔗">Probar Conexión</IOSBtn>
          <IOSBtn onPress={async()=>{
            if(!ventas.length){alert("No hay ventas para sincronizar");return;}
            let ok=0,err=0;
            for(const v of ventas){
              await drive.syncVenta(v);
            }
            alert(`Sincronización completada — ${ventas.length} venta(s) enviadas`);
          }} variant="fill" full icon="🔄">Re-sincronizar Todas las Ventas</IOSBtn>
          <IOSBtn onPress={async()=>{
            const r=await drive.syncCierre(mes,anio,ventas);
            if(r.ok) alert(`✓ Cierre de ${MESES[mes]} generado en Google Drive`);
            else alert("Error: "+(r.error||"Sin conexión"));
          }} variant="fill" full icon="📊">Generar Cierre Mensual en Drive</IOSBtn>
        </div>

        {/* Sync log */}
        {drive.syncLog.length>0&&<div>
          <div style={{fontSize:13,fontWeight:600,color:C.label3,textTransform:"uppercase",
            letterSpacing:.6,marginBottom:10}}>Historial de sincronización</div>
          <div style={{maxHeight:220,overflowY:"auto",display:"flex",flexDirection:"column",gap:6}}>
            {drive.syncLog.map((log,i)=>(
              <div key={i} style={{background:C.bg2,borderRadius:10,padding:"10px 14px",
                border:`1px solid ${log.ok?C.green+"30":C.red+"30"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:12,fontWeight:600,
                    color:log.ok?C.green:C.red,fontFamily:FONT}}>
                    {log.ok?"✓":"✗"} {log.tipo==="venta"?"Venta":log.tipo==="cierre"?"Cierre":"Producto"}
                  </span>
                  <span style={{fontSize:11,color:C.label3,fontFamily:FONT}}>{log.fecha} {log.hora||""}</span>
                </div>
                {log.id&&<div style={{fontFamily:"monospace",fontSize:11,color:C.gold}}>{log.id}</div>}
                {log.marcas&&<div style={{fontSize:11,color:C.label3,fontFamily:FONT}}>
                  → {log.marcas.join(", ")}
                </div>}
                {log.error&&<div style={{fontSize:11,color:C.red,fontFamily:FONT}}>Error: {log.error}</div>}
              </div>
            ))}
          </div>
          <div style={{marginTop:10}}>
            <IOSBtn onPress={()=>()=>{localStorage.removeItem('th_sync_log');window.location.reload()}}
              variant="danger" small>Limpiar historial</IOSBtn>
          </div>
        </div>}
      </Sheet>


      {/* Sheet: Liquidación */}
      <LiqModal
        marcaId={mLiq} ventas={ventas} mes={mes} anio={anio}
        MK={MK} cierres={cierres} setCierres={setCierres}
        onClose={()=>setMLiq(null)}
        syncCierre={drive.syncCierre}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// POSContainer — Caja con sub-tabs Venta | Retiros
// ══════════════════════════════════════════════════════════
function POSContainer({inv,onVenta,retiros,onRetiro}){
  const [subTab, setSubTab] = useState("venta");
  const tabs=[{id:"venta",label:"💳 Venta"},{id:"retiros",label:"📤 Retiros"}];
  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{display:"flex",gap:4,marginBottom:16,background:C.bg2,
        borderRadius:12,padding:4,border:`1px solid ${C.sep}`}}>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setSubTab(t.id)} style={{
            flex:1,border:"none",borderRadius:9,
            padding:"9px 12px",fontSize:13,fontWeight:subTab===t.id?700:500,
            cursor:"pointer",fontFamily:FONT,
            background:subTab===t.id?C.bg1:"transparent",
            color:subTab===t.id?C.blue:C.label3,
            boxShadow:subTab===t.id?"0 1px 4px rgba(0,0,0,0.10)":"none",
            transition:"all .15s",WebkitTapHighlightColor:"transparent"}}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab==="venta"
        ? <POS inv={inv} onVenta={onVenta}/>
        : <RetirosTab inv={inv} retiros={retiros} onRetiro={onRetiro}/>
      }
    </div>
  );
}

// POS — Caja de ventas
// ══════════════════════════════════════════════════════════
function POS({inv,onVenta}){
  var _hN135 = useState([]); var carrito = _hN135[0]; var setCarrito = _hN135[1];;
  var _hN136 = useState(""); var busq = _hN136[0]; var setBusq = _hN136[1];;
  var _hN137 = useState("efectivo"); var pago = _hN137[0]; var setPago = _hN137[1];;
  var _hN138 = useState(""); var vendedor = _hN138[0]; var setVendedor = _hN138[1];;
  var _hN139 = useState(0); var descExtra = _hN139[0]; var setDescExtra = _hN139[1];;
  var _hN140 = useState(null); var etiqueta = _hN140[0]; var setEtiqueta = _hN140[1];;
  var _hN141 = useState(null); var ultima = _hN141[0]; var setUltima = _hN141[1];;
  var _hN142 = useState(false); var showOk = _hN142[0]; var setShowOk = _hN142[1];;
  var _hN143 = useState(false); var showPago = _hN143[0]; var setShowPago = _hN143[1];
  var _hNm1 = useState(false); var pagoMixto = _hNm1[0]; var setPagoMixto = _hNm1[1];
  var _hNm2 = useState({efectivo:"", qr:"", tarjeta:""}); var montosMixtos = _hNm2[0]; var setMontosMixtos = _hNm2[1];
  var _hN144 = useState(null); var scanStatus = _hN144[0]; var setScanStatus = _hN144[1];; // null | "leyendo" | "ok" | "notfound"
  var _hN145 = useState(""); var scanMsg = _hN145[0]; var setScanMsg = _hN145[1];;
  const inputRef=useRef();
  const fileRef=useRef();

  const resultados=useMemo(()=>{
    if(!busq.trim())return[];
    const q=busq.toLowerCase();
    return inv.filter(i=>i.stock>0&&(i.nombre.toLowerCase().includes(q)||i.codigo.toLowerCase().includes(q)||(i.categoria||"").toLowerCase().includes(q))).slice(0,6);
  },[inv,busq]);

  const pagoInfo=PAGOS.find(p=>p.id===pago)||PAGOS[0];
  const subtotal=carrito.reduce((s,it)=>s+it.precio*it.cantidad,0);
  const descTarjeta=pago==="tarjeta"?subtotal*(pagoInfo.desc/100):0;
  const descManual=subtotal*(descExtra/100);
  const total=subtotal-descTarjeta-descManual;
  const descPct=pagoInfo.desc+Number(descExtra);

  const porMarca=useMemo(()=>{
    const m={};
    carrito.forEach(it=>{
      if(!m[it.marcaId])m[it.marcaId]={nombre:it.marcaNombre,color:it.marcaColor,emoji:it.marcaEmoji,total:0,uds:0};
      m[it.marcaId].total+=it.precio*it.cantidad;
      m[it.marcaId].uds+=it.cantidad;
    });
    return Object.entries(m);
  },[carrito]);

  function add(prod){
    const m=MARCAS.find(x=>x.id===prod.marcaId);
    setCarrito(p=>{
      const ex=p.find(x=>x.prodId===prod.id);
      if(ex){if(ex.cantidad>=prod.stock)return p;return p.map(x=>x.prodId===prod.id?{...x,cantidad:x.cantidad+1}:x);}
      return[...p,{prodId:prod.id,codigo:prod.codigo,nombre:prod.nombre,
        marcaId:prod.marcaId,marcaNombre:m?.nombre||"",
        marcaColor:m?.color||C.gold,marcaEmoji:m?.emoji||"◈",
        precio:prod.precio,cantidad:1}];
    });
    setBusq("");
  }
  function cambiar(prodId,d){setCarrito(p=>p.map(x=>x.prodId===prodId?{...x,cantidad:Math.max(1,x.cantidad+d)}:x));}
  function quitar(prodId){setCarrito(p=>p.filter(x=>x.prodId!==prodId));}
  async function handleEtiqueta(e){
    const f=e.target.files?.[0];
    if(!f) return;
    // Guardar imagen para adjuntar a la venta
    const r=new FileReader();
    r.onload=ev=>setEtiqueta(ev.target.result);
    r.readAsDataURL(f);
    // Intentar leer código de barras/QR de la imagen
    setScanStatus("leyendo");
    try {
      const codigo = await leerCodigoDeImagen(f);
      if(codigo){
        setScanStatus("ok");
        setScanMsg(`Código detectado: ${codigo}`);
        // Buscar el producto en el inventario por código
        const prod = inv.find(i=>i.codigo.toUpperCase()===codigo.toUpperCase());
        if(prod){
          // Agregar directamente al carrito
          add(prod);
          setScanMsg(`✓ "${prod.nombre}" agregado al carrito`);
        } else {
          // Poner en el buscador para búsqueda manual
          setBusq(codigo);
          setScanMsg(`Código "${codigo}" — busca el producto`);
        }
      } else {
        setScanStatus("notfound");
        setScanMsg("No se detectó código — foto guardada");
      }
    } catch(err){
      setScanStatus("notfound");
      setScanMsg("No se pudo leer el código");
    }
    setTimeout(()=>setScanStatus(null),4000);
  }

  function cobrar(){
    if(!carrito.length)return;
    if(pagoMixto){
      const suma=(parseFloat(montosMixtos.efectivo)||0)+(parseFloat(montosMixtos.qr)||0)+(parseFloat(montosMixtos.tarjeta)||0);
      if(Math.abs(suma-total)>0.01){alert(`Los montos (${$(suma)}) no cuadran con el total (${$(total)})`);return;}
    }
    const factor=1-descPct/100;
    const items=carrito.map(it=>({prodId:it.prodId,codigo:it.codigo,nombre:it.nombre,
      marcaId:it.marcaId,marcaNombre:it.marcaNombre,
      cantidad:it.cantidad,precioUnit:it.precio,subtotal:it.precio*it.cantidad*factor}));
    var metodoPagoFinal = pago;
    if(pagoMixto){
      var partes = [];
      if(parseFloat(montosMixtos.efectivo)>0) partes.push("efectivo:"+montosMixtos.efectivo);
      if(parseFloat(montosMixtos.qr)>0) partes.push("qr:"+montosMixtos.qr);
      if(parseFloat(montosMixtos.tarjeta)>0) partes.push("tarjeta:"+montosMixtos.tarjeta);
      metodoPagoFinal = partes.length > 0 ? "mixto|" + partes.join("|") : pago;
    }
    const vf=onVenta({items,total,subtotal,descPct,metodoPago:metodoPagoFinal,vendedor:vendedor||"Tienda",etiquetaImg:etiqueta});
    setUltima(vf);setShowOk(true);setShowPago(false);
    setCarrito([]);setDescExtra(0);setBusq("");setEtiqueta(null);
    setPagoMixto(false);setMontosMixtos({efectivo:"",qr:"",tarjeta:""});
  }

  return (
    <div>
      {/* Search bar */}
      <div style={{position:"relative",marginBottom:14}}>
        <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:16,color:C.label3}}>🔍</span>
        <input
          ref={inputRef} value={busq} autoFocus
          onChange={e=>setBusq(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&resultados.length>0)add(resultados[0]);}}
          placeholder="Nombre, código, categoría…"
          style={{width:"100%",padding:"12px 14px 12px 40px",borderRadius:14,
            border:`1.5px solid ${C.sep}`,background:C.bg2,
            fontSize:16,color:C.label,outline:"none",fontFamily:FONT,
            boxSizing:"border-box",WebkitAppearance:"none"}}
          onFocus={e=>e.target.style.borderColor=C.gold}
          onBlur={e=>e.target.style.borderColor=C.sep}
        />
      </div>

      {/* Resultados búsqueda */}
      {resultados.length>0&&(
        <div style={{background:C.bg2,borderRadius:14,overflow:"hidden",marginBottom:14}}>
          {resultados.map((p,idx)=>{
            const m=MARCAS.find(x=>x.id===p.marcaId);
            return (
              <div key={p.id} onClick={()=>add(p)} style={{
                display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"13px 16px",
                borderBottom:idx<resultados.length-1?`1px solid ${C.sep}`:"",
                cursor:"pointer",WebkitTapHighlightColor:"transparent",
                background:idx===0?`${C.gold}10`:"transparent",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:36,height:36,borderRadius:10,
                    background:`${m?.color||C.gold}22`,
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{m?.emoji}</div>
                  <div>
                    <div style={{fontSize:15,fontWeight:500,color:C.label,fontFamily:FONT}}>{p.nombre}</div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontFamily:"monospace",fontSize:11,color:C.gold,
                        background:`${C.gold}18`,padding:"1px 6px",borderRadius:4}}>{p.codigo}</span>
                      <span style={{fontSize:12,color:C.label3,fontFamily:FONT}}>stock: {p.stock}</span>
                    </div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:700,color:C.gold,fontFamily:FONT}}>{$(p.precio)}</div>
                  <div style={{fontSize:11,color:C.label3,fontFamily:FONT}}>{idx===0?"↵ agregar":""}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Carrito */}
      {carrito.length>0&&(
        <div style={{background:C.bg2,borderRadius:16,overflow:"hidden",marginBottom:14}}>
          <div style={{padding:"12px 16px 8px",borderBottom:`1px solid ${C.sep}`,
            display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:600,color:C.label2,fontFamily:FONT,
              textTransform:"uppercase",letterSpacing:.6}}>Carrito · {carrito.length} ítem{carrito.length!==1?"s":""}</span>
            <span style={{fontSize:16,fontWeight:700,color:C.gold,fontFamily:FONT}}>{$(subtotal)}</span>
          </div>
          {carrito.map((it,i)=>(
            <div key={it.prodId} style={{
              display:"flex",alignItems:"center",gap:12,padding:"13px 16px",
              borderBottom:i<carrito.length-1?`1px solid ${C.sep}`:"",
            }}>
              <div style={{width:4,height:40,borderRadius:2,background:it.marcaColor,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:15,fontWeight:500,color:C.label,fontFamily:FONT,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.nombre}</div>
                <div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>
                  {it.marcaEmoji} {it.marcaNombre}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                <button onClick={()=>cambiar(it.prodId,-1)} style={{
                  width:32,height:32,borderRadius:"50%",
                  background:C.fill2,border:"none",cursor:"pointer",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:18,color:C.label2,fontWeight:700,
                  WebkitTapHighlightColor:"transparent",
                }}>−</button>
                <span style={{fontSize:16,fontWeight:700,color:C.label,fontFamily:FONT,minWidth:20,textAlign:"center"}}>{it.cantidad}</span>
                <button onClick={()=>cambiar(it.prodId,1)} style={{
                  width:32,height:32,borderRadius:"50%",
                  background:C.fill2,border:"none",cursor:"pointer",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:18,color:C.label2,fontWeight:700,
                  WebkitTapHighlightColor:"transparent",
                }}>+</button>
              </div>
              <div style={{minWidth:70,textAlign:"right"}}>
                <div style={{fontSize:15,fontWeight:600,color:C.gold,fontFamily:FONT}}>{$(it.precio*it.cantidad)}</div>
              </div>
              <button onClick={()=>quitar(it.prodId)} style={{
                background:"none",border:"none",cursor:"pointer",
                color:C.red,fontSize:20,padding:"4px",
                WebkitTapHighlightColor:"transparent",
              }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Escanear Etiqueta */}
      <div style={{background:C.bg2,borderRadius:14,padding:"14px 16px",marginBottom:14,
        border:scanStatus==="ok"?`1.5px solid ${C.green}`:scanStatus==="notfound"?`1.5px solid ${C.amber}`:`1px solid ${C.sep}`}}>
        <div style={{fontSize:13,fontWeight:600,color:C.label3,textTransform:"uppercase",
          letterSpacing:.6,marginBottom:10}}>📷 Escanear Etiqueta</div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          onChange={handleEtiqueta} style={{display:"none"}}/>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:scanMsg?10:0}}>
          <IOSBtn onPress={()=>fileRef.current?.click()} variant="fill" small icon="📷">
            {scanStatus==="leyendo"?"Leyendo…":etiqueta?"Nueva foto":"Fotografiar código"}
          </IOSBtn>
          {etiqueta&&(
            <>
              <img src={etiqueta} alt="etiqueta"
                style={{height:44,borderRadius:8,border:`1px solid ${C.sep}`}}/>
              <button onClick={()=>{setEtiqueta(null);setScanStatus(null);setScanMsg("");}} style={{
                background:"none",border:"none",color:C.red,fontSize:18,cursor:"pointer",
                WebkitTapHighlightColor:"transparent",
              }}>×</button>
            </>
          )}
        </div>
        {scanMsg&&(
          <div style={{padding:"8px 12px",borderRadius:10,fontSize:13,fontFamily:FONT,
            background:scanStatus==="ok"?`${C.green}15`:scanStatus==="notfound"?`${C.amber}15`:C.fill2,
            color:scanStatus==="ok"?C.green:scanStatus==="notfound"?C.amber:C.label2}}>
            {scanStatus==="leyendo"&&"⏳ "}{scanMsg}
          </div>
        )}
        <div style={{fontSize:11,color:C.label3,fontFamily:FONT,marginTop:8}}>
          Apunta al código de barras o QR de la prenda → se agrega automáticamente al carrito
        </div>
      </div>

      {/* Botón cobrar */}
      <IOSBtn
        onPress={()=>carrito.length&&setShowPago(true)}
        variant="primary" full
        disabled={!carrito.length}
        style={{fontSize:18,padding:"17px"}}
      >
        {carrito.length?`💳  COBRAR ${$(total)}`:"Agrega productos"}
      </IOSBtn>

      {/* Última venta */}
      {showOk&&ultima&&(
        <div style={{background:`${C.green}15`,border:`1px solid ${C.green}30`,
          borderRadius:16,padding:"16px",marginTop:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:700,color:C.green,textTransform:"uppercase",letterSpacing:.5}}>✓ Venta Registrada</div>
            <button onClick={()=>setShowOk(false)} style={{background:"none",border:"none",
              color:C.label3,cursor:"pointer",fontSize:18,WebkitTapHighlightColor:"transparent"}}>×</button>
          </div>
          <div style={{fontFamily:"monospace",fontSize:13,color:C.gold}}>{ultima.id}</div>
          <div style={{fontSize:26,fontWeight:800,color:C.green,fontFamily:FONT,margin:"4px 0 10px"}}>{$(ultima.total)}</div>
          {ultima.items.map((i,ii)=>(
            <div key={`ok-${ii}`} style={{fontSize:13,color:C.label2,fontFamily:FONT,marginBottom:2}}>
              → {i.nombre} ×{i.cantidad} ({i.marcaNombre})
            </div>
          ))}
          <div style={{marginTop:12}}>
            <IOSBtn onPress={()=>sendWA(ultima)} variant="fill" full small icon="📲">
              Enviar por WhatsApp
            </IOSBtn>
          </div>
        </div>
      )}

      {/* Sheet: Cobro */}
      <Sheet open={showPago} onClose={()=>setShowPago(false)} title="Confirmar Cobro" tall>
        {/* Total */}
        <div style={{background:`${C.gold}12`,border:`1px solid ${C.gold}30`,
          borderRadius:16,padding:"20px",marginBottom:20,textAlign:"center"}}>
          <div style={{fontSize:13,color:C.label3,fontFamily:FONT,marginBottom:6}}>Total a cobrar</div>
          <div style={{fontSize:40,fontWeight:800,color:C.gold,fontFamily:FONT,lineHeight:1}}>{$(total)}</div>
          {descPct>0&&<div style={{fontSize:13,color:C.label3,fontFamily:FONT,marginTop:6}}>
            Subtotal {$(subtotal)} · -({descPct}%)
          </div>}
        </div>

        {/* Método de pago */}
        <div style={{fontSize:13,fontWeight:600,color:C.label3,textTransform:"uppercase",
          letterSpacing:.6,marginBottom:10}}>Método de Pago</div>

        {/* Toggle pago simple / mixto */}
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <button onClick={function(){setPagoMixto(false);}} style={{
            flex:1,padding:"10px",borderRadius:12,cursor:"pointer",fontFamily:FONT,
            border:"2px solid "+(!pagoMixto?C.green:C.sep),
            background:!pagoMixto?C.green+"18":C.bg2,
            color:!pagoMixto?C.green:C.label2,fontWeight:!pagoMixto?700:400,fontSize:13,
          }}>Pago simple</button>
          <button onClick={function(){setPagoMixto(true);}} style={{
            flex:1,padding:"10px",borderRadius:12,cursor:"pointer",fontFamily:FONT,
            border:"2px solid "+(pagoMixto?C.blue:C.sep),
            background:pagoMixto?C.blue+"18":C.bg2,
            color:pagoMixto?C.blue:C.label2,fontWeight:pagoMixto?700:400,fontSize:13,
          }}>Pago mixto</button>
        </div>

        {/* Pago simple */}
        {!pagoMixto&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
              {PAGOS.map(p=>(
                <button key={p.id} onClick={()=>setPago(p.id)} style={{
                  padding:"14px 8px",borderRadius:14,
                  border:`2px solid ${pago===p.id?p.color:C.sep}`,
                  background:pago===p.id?`${p.color}18`:C.bg2,
                  cursor:"pointer",fontFamily:FONT,transition:"all .15s",
                  display:"flex",flexDirection:"column",alignItems:"center",gap:6,
                  WebkitTapHighlightColor:"transparent",
                }}>
                  <span style={{fontSize:26}}>{p.icon}</span>
                  <span style={{fontSize:13,fontWeight:pago===p.id?700:400,
                    color:pago===p.id?p.color:C.label2}}>{p.label}</span>
                  {p.desc>0&&<Chip color={C.amber} small>-{p.desc}%</Chip>}
                </button>
              ))}
            </div>
            {pago==="tarjeta"&&(
              <div style={{padding:"12px 14px",background:`${C.amber}15`,borderRadius:12,
                border:`1px solid ${C.amber}30`,marginBottom:16,fontSize:13,color:C.amber,fontFamily:FONT}}>
                💳 Descuento 2.5% por tarjeta aplicado automáticamente
              </div>
            )}
          </div>
        )}

        {/* Pago mixto */}
        {pagoMixto&&(
          <div style={{marginBottom:16}}>
            <div style={{background:C.bg2,borderRadius:14,padding:16,border:"1px solid "+C.sep,marginBottom:10}}>
              <div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginBottom:12,textAlign:"center"}}>
                Total a cobrar: <strong style={{color:C.gold}}>{$(total)}</strong> — distribuye entre los métodos
              </div>
              {PAGOS.map(function(p){
                var val = montosMixtos[p.id] || "";
                return (
                  <div key={p.id} style={{marginBottom:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                      <span style={{fontSize:20}}>{p.icon}</span>
                      <span style={{fontSize:14,fontWeight:600,color:C.label,fontFamily:FONT}}>{p.label}</span>
                    </div>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",
                        fontSize:14,color:C.label3,fontFamily:FONT}}>Bs</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={val}
                        placeholder="0.00"
                        onChange={function(e){
                          var v = e.target.value;
                          setMontosMixtos(function(prev){
                            var next = Object.assign({}, prev);
                            next[p.id] = v;
                            return next;
                          });
                        }}
                        style={{width:"100%",padding:"11px 14px 11px 36px",borderRadius:12,
                          border:"1.5px solid "+C.sep,background:C.bg3,
                          fontSize:16,color:C.label,outline:"none",
                          fontFamily:FONT,boxSizing:"border-box"}}
                      />
                    </div>
                  </div>
                );
              })}
              {(function(){
                var suma = (parseFloat(montosMixtos.efectivo)||0) +
                           (parseFloat(montosMixtos.qr)||0) +
                           (parseFloat(montosMixtos.tarjeta)||0);
                var diff = total - suma;
                return (
                  <div style={{padding:"10px 12px",borderRadius:10,
                    background:Math.abs(diff)<0.01?C.green+"15":C.red+"15",
                    border:"1px solid "+(Math.abs(diff)<0.01?C.green:C.red)+"30"}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontFamily:FONT}}>
                      <span style={{fontSize:13,color:C.label3}}>Total ingresado:</span>
                      <span style={{fontSize:13,fontWeight:700,color:C.label}}>{$(suma)}</span>
                    </div>
                    {Math.abs(diff)>0.01&&(
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontFamily:FONT}}>
                        <span style={{fontSize:13,color:C.red}}>Diferencia:</span>
                        <span style={{fontSize:13,fontWeight:700,color:C.red}}>{$(Math.abs(diff))}</span>
                      </div>
                    )}
                    {Math.abs(diff)<0.01&&(
                      <div style={{fontSize:13,color:C.green,textAlign:"center",marginTop:4,fontFamily:FONT}}>
                        ✓ Montos cuadrados
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Descuento adicional */}
        <IOSInput label="Descuento adicional (%)" type="number" min="0" max="100"
          value={descExtra} onChange={e=>setDescExtra(Number(e.target.value))}/>
        <IOSInput label="Vendedor (opcional)" value={vendedor}
          onChange={e=>setVendedor(e.target.value)} placeholder="Nombre del vendedor"/>

        {/* Apropiación */}
        {porMarca.length>0&&(
          <div style={{marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,color:C.label3,textTransform:"uppercase",
              letterSpacing:.6,marginBottom:10}}>Apropiación por Marca</div>
            <div style={{background:C.bg2,borderRadius:14,overflow:"hidden"}}>
              {porMarca.map(([id,d],i)=>(
                <div key={id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"12px 16px",borderBottom:i<porMarca.length-1?`1px solid ${C.sep}`:""}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>{d.emoji}</span>
                    <span style={{fontSize:15,color:C.label,fontFamily:FONT}}>{d.nombre}</span>
                    <span style={{fontSize:12,color:C.label3}}>{d.uds} uds</span>
                  </div>
                  <span style={{fontSize:15,fontWeight:600,color:d.color,fontFamily:FONT}}>
                    {$(d.total*(1-descPct/100))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <IOSBtn onPress={cobrar} full variant="primary" style={{fontSize:18,padding:"17px"}} icon="💳">
          Cobrar {$(total)}
        </IOSBtn>
      </Sheet>
    </div>
  );
}



// ══════════════════════════════════════════════════════════
// SHEET RECIBIR PRODUCTO — con generación de código de barra
// ══════════════════════════════════════════════════════════
function SheetRecibir({open, onClose, inv, onAdd, fInv, setFInv}){
  var _hN146 = useState(""); var scanInvMsg = _hN146[0]; var setScanInvMsg = _hN146[1];;
  var _hN147 = useState(null); var scanInvStatus = _hN147[0]; var setScanInvStatus = _hN147[1];;
  var _hN148 = useState(false); var barcodeReady = _hN148[0]; var setBarcodeReady = _hN148[1];;
  const scanInvRef = useRef(null);
  
  const codigoGenerado = fInv.marcaId && fInv.nombre
    ? genCod(Number(fInv.marcaId), fInv.nombre, inv.length+1)
    : "";

  useEffect(()=>{
    if(codigoGenerado) setBarcodeReady(true);
  },[codigoGenerado]);

  async function handleScanEtiqueta(e){
    const f = e.target.files?.[0];
    if(!f) return;
    setScanInvStatus("leyendo");
    setScanInvMsg("Leyendo código de la etiqueta…");
    try {
      const codigo = await leerCodigoDeImagen(f);
      if(codigo){
        // Rellenar nombre y categoría desde el código
        const partes = codigo.split("-");
        const nombre = partes.length >= 2 ? partes.slice(1, partes.length-1).join(" ") : codigo;
        const categoria = detectarCategoria(codigo);
        setFInv(p=>({...p,
          nombre: p.nombre || nombre,
          categoria: p.categoria || categoria,
        }));
        setScanInvStatus("ok");
        setScanInvMsg(`✓ Código leído: ${codigo}`);
      } else {
        setScanInvStatus("notfound");
        setScanInvMsg("No se detectó código en la imagen");
      }
    } catch(e){
      setScanInvStatus("notfound");
      setScanInvMsg("Error al leer la imagen");
    }
    setTimeout(()=>{setScanInvStatus(null);setScanInvMsg("");},4000);
  }

  // Detecta categoría según palabras clave en el código o nombre
  function detectarCategoria(texto){
    const t = texto.toLowerCase();
    if(t.includes("cam")||t.includes("pol")||t.includes("rem")) return "Ropa";
    if(t.includes("pan")||t.includes("jean")||t.includes("fal")) return "Ropa";
    if(t.includes("bol")||t.includes("car")||t.includes("ach")) return "Accesorios";
    if(t.includes("zap")||t.includes("san")||t.includes("bot")) return "Calzado";
    if(t.includes("cre")||t.includes("per")||t.includes("jab")) return "Cuidado personal";
    if(t.includes("vel")||t.includes("arom")) return "Velas & Aromas";
    return "General";
  }

  return (
    <Sheet open={open} onClose={()=>{onClose();setScanInvMsg("");setScanInvStatus(null);}} title="Recibir Producto" tall>
      {/* Opción escanear etiqueta existente */}
      <div style={{background:C.bg3,borderRadius:14,padding:"14px",marginBottom:16,
        border:`1px solid ${scanInvStatus==="ok"?C.green:scanInvStatus==="notfound"?C.amber:C.sep}`}}>
        <div style={{fontSize:12,fontWeight:700,color:C.label3,textTransform:"uppercase",
          letterSpacing:.6,marginBottom:10}}>Escanear etiqueta existente (opcional)</div>
        <input ref={scanInvRef} type="file" accept="image/*" capture="environment"
          onChange={handleScanEtiqueta} style={{display:"none"}}/>
        <IOSBtn onPress={()=>scanInvRef.current?.click()} variant="fill" small icon="📷">
          {scanInvStatus==="leyendo"?"Leyendo…":"Fotografiar código"}
        </IOSBtn>
        {scanInvMsg&&(
          <div style={{marginTop:8,padding:"8px 12px",borderRadius:8,fontSize:13,fontFamily:FONT,
            background:scanInvStatus==="ok"?`${C.green}15`:scanInvStatus==="notfound"?`${C.amber}15`:C.fill2,
            color:scanInvStatus==="ok"?C.green:scanInvStatus==="notfound"?C.amber:C.label2}}>
            {scanInvMsg}
          </div>
        )}
      </div>

      {/* Formulario */}
      <IOSSel label="Marca" value={fInv.marcaId} onChange={e=>setFInv(p=>({...p,marcaId:e.target.value}))}>
        <option value="">Seleccionar marca…</option>
        {MARCAS.map(m=><option key={m.id} value={m.id}>{m.emoji} {m.nombre}</option>)}
      </IOSSel>
      <IOSInput label="Nombre del producto" value={fInv.nombre}
        onChange={e=>setFInv(p=>({...p,nombre:e.target.value}))} placeholder="Ej: Vestido floral talla M"/>
      <IOSInput label="Categoría" value={fInv.categoria}
        onChange={e=>setFInv(p=>({...p,categoria:e.target.value}))} placeholder="Ej: Ropa, Accesorios…"/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <IOSInput label="Precio (Bs)" prefix="Bs" type="number" value={fInv.precio}
          onChange={e=>setFInv(p=>({...p,precio:e.target.value}))} placeholder="0"/>
        <IOSInput label="Unidades" type="number" value={fInv.stock}
          onChange={e=>setFInv(p=>({...p,stock:e.target.value}))} placeholder="0"/>
      </div>
      <IOSInput label="Fecha de ingreso" type="date" value={fInv.fecha}
        onChange={e=>setFInv(p=>({...p,fecha:e.target.value}))}/>

      {/* Código de barras generado */}
      {codigoGenerado&&(
        <div style={{padding:"14px",background:"#FFFFFF",borderRadius:14,
          border:`1px solid ${C.sep}`,marginBottom:14,textAlign:"center"}}>
          <div style={{fontSize:11,fontWeight:700,color:C.label3,textTransform:"uppercase",
            letterSpacing:.8,marginBottom:8}}>Código generado para esta prenda</div>
          <div style={{fontSize:14,fontFamily:"monospace",fontWeight:700,
            color:C.gold,marginBottom:10}}>{codigoGenerado}</div>
          <BarcodeDisplay codigo={codigoGenerado}/>
          <div style={{fontSize:11,color:C.label3,fontFamily:FONT,marginTop:8}}>
            {fInv.nombre && <strong style={{color:C.label2}}>{fInv.nombre}</strong>}
            {fInv.categoria && <span style={{color:C.label3}}> · {fInv.categoria}</span>}
          </div>
        </div>
      )}

      <IOSBtn onPress={onAdd} full variant="primary">Registrar e Imprimir Ticket</IOSBtn>
    </Sheet>
  );
}

// ══════════════════════════════════════════════════════════
// INVENTARIO POR MARCA — pestaña con scroll horizontal
// ══════════════════════════════════════════════════════════
function InventarioPorMarca({inv, ventas, onRecibir, onBaja}){
  var _hN149 = useState(MARCAS[0].id); var marcaSelec = _hN149[0]; var setMarcaSelec = _hN149[1];;
  const marca = MARCAS.find(m=>m.id===marcaSelec);

  // Calcular unidades vendidas por producto
  const vendidosPorProd = useMemo(()=>{
    const map = {};
    ventas.forEach(v=>v.items.forEach(it=>{
      map[it.prodId] = (map[it.prodId]||0) + it.cantidad;
    }));
    return map;
  },[ventas]);

  const productos = inv.filter(i=>i.marcaId===marcaSelec);
  const totalStock = productos.reduce((s,p)=>s+p.stock,0);
  const totalVendidas = productos.reduce((s,p)=>s+(vendidosPorProd[p.id]||0),0);
  const agotados = productos.filter(p=>p.stock===0).length;

  return (
    <div>
      {/* Selector de marcas — scroll horizontal */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:C.label3,textTransform:"uppercase",
          letterSpacing:.8,marginBottom:10,paddingLeft:2}}>Seleccionar Marca</div>
        <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8,
          scrollbarWidth:"none",WebkitOverflowScrolling:"touch"}}>
          {MARCAS.map(m=>{
            const prods=inv.filter(i=>i.marcaId===m.id);
            const stock=prods.reduce((s,p)=>s+p.stock,0);
            const activa=m.id===marcaSelec;
            return (
              <button key={m.id} onClick={()=>setMarcaSelec(m.id)} style={{
                flexShrink:0,padding:"10px 16px",borderRadius:14,
                border:`2px solid ${activa?m.color:C.sep}`,
                background:activa?m.color+"30":C.bg2,
                cursor:"pointer",fontFamily:FONT,
                WebkitTapHighlightColor:"transparent",
                display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                minWidth:80,transition:"all .2s",
              }}>
                <span style={{fontSize:20}}>{m.emoji}</span>
                <span style={{fontSize:11,fontWeight:activa?700:500,
                  color:activa?m.color:C.label2,whiteSpace:"nowrap"}}>{m.nombre}</span>
                <span style={{fontSize:10,color:activa?m.color:C.label3}}>
                  {stock} uds
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stats de la marca */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
        {[
          {icon:"📦",label:"En stock",value:totalStock,color:C.green},
          {icon:"✅",label:"Vendidas",value:totalVendidas,color:C.blue},
          {icon:"❌",label:"Agotados",value:agotados,color:C.red},
        ].map(s=>(
          <div key={s.label} style={{background:C.bg2,borderRadius:14,padding:"12px 10px",
            border:`1px solid ${C.sep}`,textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
            <div style={{fontSize:18,fontWeight:800,color:s.color,fontFamily:FONT}}>{s.value}</div>
            <div style={{fontSize:10,color:C.label3,fontFamily:FONT,textTransform:"uppercase",letterSpacing:.5}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Lista de productos */}
      {productos.length===0
        ? <div style={{textAlign:"center",padding:"48px 20px",color:C.label3}}>
            <div style={{fontSize:40,marginBottom:10,opacity:.5}}>📦</div>
            <div style={{fontSize:16,fontWeight:600,color:C.label2,fontFamily:FONT}}>
              Sin productos para {marca?.nombre}
            </div>
            <div style={{fontSize:13,color:C.label3,fontFamily:FONT,marginTop:6}}>
              Usa "Recibir" para agregar ítems
            </div>
          </div>
        : <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
            {/* Leyenda */}
            <div style={{display:"flex",gap:12,padding:"8px 12px",background:C.bg2,
              borderRadius:10,marginBottom:4}}>
              {[
                {color:C.stockOk,label:"En stock"},
                {color:C.stockLow,label:"Stock bajo"},
                {color:C.stockOut,label:"Agotado"},
                {color:C.stockSold,label:"Vendido"},
              ].map(l=>(
                <div key={l.label} style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:10,height:10,borderRadius:3,background:l.color,
                    border:`1px solid ${C.sep}`}}/>
                  <span style={{fontSize:10,color:C.label3,fontFamily:FONT}}>{l.label}</span>
                </div>
              ))}
            </div>

            {productos.map(prod=>{
              const vendidas=vendidosPorProd[prod.id]||0;
              const pctVendido=prod.stockInicial>0?Math.round((vendidas/prod.stockInicial)*100):0;
              const estado=prod.stock===0?"agotado":prod.stock<3?"bajo":"ok";
              const bgColor=prod.stock===0?C.stockOut:prod.stock<3?C.stockLow:C.stockOk;
              const borderColor=prod.stock===0?"#F4A8A8":prod.stock<3?"#F4D4A8":"#A8D4A8";

              return (
                <div key={prod.id} style={{
                  background:bgColor,
                  border:`1.5px solid ${borderColor}`,
                  borderRadius:16,padding:"14px 16px",
                }}>
                  {/* Header producto */}
                  <div style={{display:"flex",justifyContent:"space-between",
                    alignItems:"flex-start",marginBottom:10}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:15,fontWeight:700,color:C.label,
                        fontFamily:FONT,marginBottom:4}}>{prod.nombre}</div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontFamily:"monospace",fontSize:11,color:C.gold,
                          background:C.gold+"18",padding:"2px 7px",borderRadius:5,
                          fontWeight:700}}>{prod.codigo}</span>
                        <span style={{fontSize:12,color:C.label3,fontFamily:FONT}}>
                          {prod.categoria}
                        </span>
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:16,fontWeight:800,color:C.gold,fontFamily:FONT}}>
                        {$(prod.precio)}
                      </div>
                      <div style={{fontSize:12,fontFamily:FONT,fontWeight:600,
                        color:prod.stock===0?C.red:prod.stock<3?C.amber:C.green}}>
                        {prod.stock===0?"AGOTADO":prod.stock<3?`⚠ ${prod.stock} restantes`:`✓ ${prod.stock} en stock`}
                      </div>
                    </div>
                  </div>

                  {/* Barra de progreso vendido/stock */}
                  <div style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",
                      fontSize:11,color:C.label3,fontFamily:FONT,marginBottom:4}}>
                      <span>Vendidas: <strong style={{color:C.blue}}>{vendidas}</strong></span>
                      <span>Inicial: <strong>{prod.stockInicial}</strong></span>
                      <span>{pctVendido}% vendido</span>
                    </div>
                    <div style={{background:"rgba(0,0,0,0.08)",borderRadius:6,height:8,overflow:"hidden"}}>
                      <div style={{
                        width:`${pctVendido}%`,
                        background:prod.stock===0?"#C0504A":prod.stock<3?"#C8922A":"#4A9B6F",
                        height:8,borderRadius:6,
                        transition:"width .4s ease",
                        minWidth:pctVendido>0?4:0,
                      }}/>
                    </div>
                  </div>

                  {/* Footer: vendidas + botón imprimir */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    {vendidas>0&&(
                      <div style={{padding:"6px 10px",background:C.stockSold,
                        borderRadius:8,border:`1px solid #C8D4F4`,
                        fontSize:12,color:C.blue,fontFamily:FONT,flex:1}}>
                        🛒 {vendidas} vendida{vendidas!==1?"s":""} · {prod.fecha}
                      </div>
                    )}
                    <button
                      onClick={()=>imprimirTicket(prod, marca?.nombre||"")}
                      style={{
                        padding:"7px 14px",borderRadius:10,border:`1.5px solid ${C.gold}`,
                        background:"white",color:C.gold,fontSize:12,fontFamily:FONT,
                        fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6,
                        WebkitTapHighlightColor:"transparent",whiteSpace:"nowrap",flexShrink:0,
                      }}>
                      🖨 Imprimir ticket
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
      }

      {/* Botones acción */}
      <div style={{display:"flex",gap:10,marginBottom:20}}>
        <IOSBtn onPress={onBaja} variant="fill" full icon="🗑">Dar de Baja</IOSBtn>
        <IOSBtn onPress={onRecibir} full icon="+">Recibir</IOSBtn>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MARCA DETALLE — iOS navigation push style
// ══════════════════════════════════════════════════════════
function MarcaDetalle({marcaId,inv,ventas,vMes,mes,anio,MK,cierres,setCierres,getHist,getLiq}){
  var _hN150 = useState("historial"); var sub = _hN150[0]; var setSub = _hN150[1];;
  var _hN151 = useState(""); var filtroMk = _hN151[0]; var setFMk = _hN151[1];;
  const marca   =MARCAS.find(m=>m.id===marcaId);
  const liq     =getLiq(marcaId);
  const cerrado =cierres[`${MK}-${marcaId}`]?.cerrado;
  const historial=getHist(marcaId);
  const prods   =inv.filter(i=>i.marcaId===marcaId);
  const histFil =filtroMk?historial.filter(h=>h.mk===filtroMk):historial;
  const totalHist=historial.reduce((s,h)=>s+h.bruto,0);

  return (
    <div>
      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
        <StatCard icon={marca?.emoji||"◆"} label="Total histórico" value={$(totalHist)}
          sub={`${historial.reduce((s,h)=>s+h.ventas.length,0)} ventas`} color={marca?.color}/>
        <StatCard icon="📅" label={MESES[mes]} value={$(liq.bruto)}
          sub={`${liq.vMarca.length} ventas`} color={C.gold}/>
        <StatCard icon="📦" label="Productos" value={prods.filter(p=>p.stock>0).length}
          sub={`${prods.reduce((s,p)=>s+p.stock,0)} uds`} color={C.blue}/>
        <StatCard icon="🗓" label="Períodos" value={historial.length} color={C.indigo}/>
      </div>

      {/* Segmented */}
      <div style={{marginBottom:16}}>
        <SegControl
          options={[{value:"historial",label:"Historial"},{value:"productos",label:"Productos"},{value:"liquidacion",label:"Liquidación"}]}
          value={sub} onChange={setSub}
        />
      </div>

      {/* HISTORIAL */}
      {sub==="historial"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontSize:13,color:C.label3,fontFamily:FONT}}>{historial.length} período{historial.length!==1?"s":""}</span>
            <select value={filtroMk} onChange={e=>setFMk(e.target.value)}
              style={{background:C.bg2,border:`1px solid ${C.sep}`,color:C.label,
                borderRadius:10,padding:"6px 12px",fontSize:13,fontFamily:FONT,cursor:"pointer",
                outline:"none",WebkitAppearance:"none"}}>
              <option value="">Todo</option>
              {historial.map(h=><option key={h.mk} value={h.mk}>{MESES[h.mes]} {h.anio}</option>)}
            </select>
          </div>
          {histFil.length===0
            ? <EmptyState icon="📋" title="Sin ventas registradas" sub={`No hay ventas para ${marca?.nombre}`}/>
            : histFil.map(periodo=>(
                <div key={periodo.mk} style={{background:C.bg2,borderRadius:16,overflow:"hidden",marginBottom:14}}>
                  {/* Header período */}
                  <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.sep}`,
                    display:"flex",justifyContent:"space-between",alignItems:"center",
                    background:`${marca?.color}10`}}>
                    <div>
                      <div style={{fontSize:17,fontWeight:600,color:C.label,fontFamily:FONT}}>
                        {MESES[periodo.mes]} {periodo.anio}
                      </div>
                      <div style={{fontSize:13,color:C.label3,fontFamily:FONT}}>
                        {periodo.ventas.length} transacciones
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:22,fontWeight:800,color:marca?.color,fontFamily:FONT}}>
                        {$(periodo.bruto)}
                      </div>
                      {cierres[`${periodo.mk}-${marcaId}`]?.cerrado&&<Chip color={C.green} small>✓ Cerrado</Chip>}
                    </div>
                  </div>
                  {/* Ventas del período */}
                  {periodo.ventas.map((v,i)=>(
                    <div key={v.id} style={{padding:"13px 16px",
                      borderBottom:i<periodo.ventas.length-1?`1px solid ${C.sep}`:""}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontFamily:"monospace",fontSize:12,color:C.gold}}>{v.id}</span>
                          <Chip color={colorPago(v.metodoPago)} small>
                            {iconPago(v.metodoPago)} {labelPago(v.metodoPago)}
                          </Chip>
                        </div>
                        <span style={{fontSize:16,fontWeight:700,color:C.gold,fontFamily:FONT}}>{$(v.subMarca)}</span>
                      </div>
                      <div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginBottom:6}}>
                        {v.fecha} {v.hora}
                      </div>
                      {v.itsMarca.map((it,ii)=>(
                        <div key={`${v.id}-${it.prodId}-${ii}`} style={{fontSize:13,color:C.label2,fontFamily:FONT}}>
                          · {it.nombre}{" "}
                          <span style={{fontFamily:"monospace",fontSize:11,color:C.label3}}>{it.codigo}</span>
                          {" "}×{it.cantidad}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))
          }
        </div>
      )}

      {/* PRODUCTOS */}
      {sub==="productos"&&(
        <div>
          {prods.length===0
            ? <EmptyState icon="📦" title="Sin productos" sub={`No hay ítems registrados para ${marca?.nombre}`}/>
            : prods.map((p,i)=>{
                const vendidas=p.stockInicial-p.stock;
                return (
                  <div key={p.id} style={{
                    background:C.bg2,
                    borderRadius:i===0?"14px 14px 2px 2px":i===prods.length-1?"2px 2px 14px 14px":"2px",
                    padding:"14px 16px",
                    borderBottom:i<prods.length-1?`1px solid ${C.sep}`:"",
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:15,fontWeight:500,color:C.label,fontFamily:FONT,marginBottom:4}}>
                          {p.nombre}
                        </div>
                        <span style={{fontFamily:"monospace",fontSize:11,color:C.gold,
                          background:`${C.gold}18`,padding:"1px 7px",borderRadius:5}}>{p.codigo}</span>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:16,fontWeight:700,color:C.gold,fontFamily:FONT}}>{$(p.precio)}</div>
                        <div style={{fontSize:13,fontFamily:FONT,marginTop:2,
                          color:p.stock===0?C.red:p.stock<3?C.amber:C.green}}>
                          {p.stock===0?"Agotado":p.stock<3?`${p.stock} (bajo)`:`${p.stock} disponibles`}
                        </div>
                        {vendidas>0&&<div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>{vendidas} vendidas</div>}
                      </div>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* LIQUIDACIÓN */}
      {sub==="liquidacion"&&(
        <div>
          {cerrado&&(
            <div style={{padding:"12px 16px",background:`${C.green}15`,borderRadius:14,
              border:`1px solid ${C.green}30`,marginBottom:16,fontSize:15,
              color:C.green,fontFamily:FONT,textAlign:"center",fontWeight:600}}>
              ✓ Cierre de {MESES[mes]} confirmado
            </div>
          )}
          <div style={{background:C.bg2,borderRadius:16,overflow:"hidden",marginBottom:16}}>
            {[["Ventas brutas",$(liq.bruto),C.label],["Comisión (10%)",`-${$(liq.comision)}`,C.red],["Neto a liquidar",$(liq.neto),C.green]].map(([k,v,c],i,arr)=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"15px 16px",borderBottom:i<arr.length-1?`1px solid ${C.sep}`:""}}>
                <span style={{fontSize:16,color:C.label2,fontFamily:FONT}}>{k}</span>
                <span style={{fontSize:16,fontWeight:600,color:c,fontFamily:FONT}}>{v}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"18px 16px",background:`${C.gold}12`}}>
              <span style={{fontSize:17,fontWeight:700,color:C.label,fontFamily:FONT}}>TOTAL A PAGAR</span>
              <span style={{fontSize:24,fontWeight:800,color:C.gold,fontFamily:FONT}}>{$(liq.neto)}</span>
            </div>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <IOSBtn onPress={()=>exportCSV(MARCAS.find(m=>m.id===marcaId),ventas,mes,anio)} variant="fill" full icon="⬇">
              Exportar CSV
            </IOSBtn>
            {!cerrado
              ? <IOSBtn variant="success" full icon="✓"
                  onPress={()=>setCierres(p=>({...p,[`${MK}-${marcaId}`]:{cerrado:true,fecha:hoy(),mk:MK}}))}>
                  Confirmar Cierre Mensual
                </IOSBtn>
              : <IOSBtn variant="danger" full
                  onPress={()=>setCierres(p=>({...p,[`${MK}-${marcaId}`]:{cerrado:false,mk:MK}}))}>
                  Reabrir Liquidación
                </IOSBtn>
            }
          </div>

          {/* Detalle ventas */}
          {liq.vMarca.length>0&&(
            <div style={{marginTop:20}}>
              <div style={{fontSize:13,fontWeight:600,color:C.label3,textTransform:"uppercase",
                letterSpacing:.6,marginBottom:12}}>Ventas del período</div>
              {liq.vMarca.map(v=>{
                const its=v.items.filter(i=>i.marcaId===marcaId);
                const sub2=its.reduce((s,i)=>s+i.subtotal,0);
                return (
                  <div key={v.id} style={{background:C.bg2,borderRadius:14,padding:14,marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontFamily:"monospace",fontSize:12,color:C.gold}}>{v.id}</span>
                      <span style={{fontSize:16,fontWeight:700,color:C.gold,fontFamily:FONT}}>{$(sub2)}</span>
                    </div>
                    <div style={{fontSize:13,color:C.label3,fontFamily:FONT,marginBottom:4}}>
                      {v.fecha} {v.hora} · {labelPago(v.metodoPago)}
                    </div>
                    {its.map((it,ii)=>(
                      <div key={`liq-${v.id}-${it.prodId}-${ii}`} style={{fontSize:13,color:C.label2,fontFamily:FONT}}>
                        · {it.nombre} ×{it.cantidad} = {$(it.subtotal)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// HISTORIAL TAB — Navegación por mes/año
// ══════════════════════════════════════════════════════════
function HistorialTab({ventas, inv, cierres, onVentaClick}){
  const now = new Date();
  var _hN152 = useState(now.getMonth()); var mesSel = _hN152[0]; var setMesSel = _hN152[1];
  var _hN153 = useState(now.getFullYear()); var anioSel = _hN153[0]; var setAnioSel = _hN153[1];
  var _hN154 = useState("resumen"); var vista = _hN154[0]; var setVista = _hN154[1];; // resumen | marcas | ventas | stock

  const MKSel = mkKey(mesSel, anioSel);

  // Ventas del período seleccionado
  const ventasPer = useMemo(()=>
    ventas.filter(v=>v.mk===MKSel),
  [ventas, MKSel]);

  // Períodos con datos (para el selector)
  const periodosConDatos = useMemo(()=>{
    const set = new Set(ventas.map(v=>v.mk));
    return Array.from(set).sort((a,b)=>b.localeCompare(a)).map(mk=>{
      const [anio,mes] = mk.split("-");
      return { mk, mes:Number(mes)-1, anio:Number(anio) };
    });
  },[ventas]);

  // Stats del período
  const totalPer    = ventasPer.reduce((s,v)=>s+v.total,0);
  const efectivoPer = ventasPer.filter(v=>v.metodoPago==="efectivo").reduce((s,v)=>s+v.total,0);
  const qrPer       = ventasPer.filter(v=>v.metodoPago==="qr").reduce((s,v)=>s+v.total,0);
  const tarjetaPer  = ventasPer.filter(v=>v.metodoPago==="tarjeta").reduce((s,v)=>s+v.total,0);

  // Ventas por marca del período
  const porMarcaPer = useMemo(()=>
    MARCAS.map(m=>{
      const total = ventasPer.reduce((s,v)=>s+v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0),0);
      const ef    = ventasPer.filter(v=>v.metodoPago==="efectivo").reduce((s,v)=>s+v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0),0);
      const qr    = ventasPer.filter(v=>v.metodoPago==="qr").reduce((s,v)=>s+v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0),0);
      const tj    = ventasPer.filter(v=>v.metodoPago==="tarjeta").reduce((s,v)=>s+v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0),0);
      const txs   = ventasPer.filter(v=>v.items.some(i=>i.marcaId===m.id)).length;
      return {marca:m, total, ef, qr, tj, txs};
    }).filter(x=>x.total>0).sort((a,b)=>b.total-a.total)
  ,[ventasPer]);

  // Años disponibles (entre 2024 y año actual+1)
  const anios = [];
  for(let a=2024; a<=now.getFullYear()+1; a++) anios.push(a);

  return (
    <div>
      {/* ── SELECTOR MES/AÑO ── */}
      <div style={{background:C.bg2,borderRadius:16,padding:16,marginBottom:16,
        border:`1px solid ${C.sep}`}}>
        <div style={{fontSize:11,fontWeight:700,color:C.label3,textTransform:"uppercase",
          letterSpacing:.8,marginBottom:12}}>Seleccionar período</div>

        {/* Año */}
        <div style={{display:"flex",gap:8,marginBottom:12,overflowX:"auto",
          scrollbarWidth:"none",WebkitOverflowScrolling:"touch",paddingBottom:4}}>
          {anios.map(a=>(
            <button key={a} onClick={()=>setAnioSel(a)} style={{
              flexShrink:0,padding:"8px 18px",borderRadius:20,
              border:`2px solid ${anioSel===a?C.gold:C.sep}`,
              background:anioSel===a?`${C.gold}20`:C.bg3,
              color:anioSel===a?C.gold:C.label2,
              fontSize:15,fontWeight:anioSel===a?700:400,
              fontFamily:FONT,cursor:"pointer",
              WebkitTapHighlightColor:"transparent",
            }}>{a}</button>
          ))}
        </div>

        {/* Mes — grid 3x4 */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
          {MESES.map((m,i)=>{
            const mk = mkKey(i,anioSel);
            const tieneDatos = ventas.some(v=>v.mk===mk);
            const esSel = mesSel===i && anioSel===anioSel;
            return (
              <button key={i} onClick={()=>setMesSel(i)} style={{
                padding:"10px 4px",borderRadius:10,
                border:`2px solid ${mesSel===i?C.gold:tieneDatos?C.sep+"88":C.sep}`,
                background:mesSel===i?`${C.gold}20`:tieneDatos?C.bg3:"transparent",
                color:mesSel===i?C.gold:tieneDatos?C.label:C.label3,
                fontSize:12,fontWeight:mesSel===i?700:400,
                fontFamily:FONT,cursor:"pointer",textAlign:"center",
                WebkitTapHighlightColor:"transparent",
                opacity:tieneDatos||mesSel===i?1:.5,
                position:"relative",
              }}>
                {m.slice(0,3)}
                {tieneDatos&&mesSel!==i&&(
                  <div style={{position:"absolute",top:3,right:5,width:5,height:5,
                    borderRadius:"50%",background:C.green}}/>
                )}
              </button>
            );
          })}
        </div>

        {/* Resumen rápido del período */}
        <div style={{marginTop:12,padding:"10px 12px",background:C.bg3,borderRadius:10,
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:14,fontWeight:700,color:C.label,fontFamily:FONT}}>
            {MESES[mesSel]} {anioSel}
          </span>
          <span style={{fontSize:14,fontWeight:800,color:totalPer>0?C.gold:C.label3,fontFamily:FONT}}>
            {totalPer>0?$(totalPer):"Sin ventas"}
          </span>
        </div>
      </div>

      {/* ── SELECTOR VISTA ── */}
      <div style={{marginBottom:16}}>
        <SegControl
          options={[
            {value:"resumen",label:"Resumen"},
            {value:"marcas", label:"Marcas"},
            {value:"ventas", label:"Ventas"},
            {value:"stock",  label:"Stock"},
          ]}
          value={vista} onChange={setVista}
        />
      </div>

      {/* ── RESUMEN ── */}
      {vista==="resumen"&&(
        <div>
          {ventasPer.length===0
            ? <EmptyState icon="📅" title={`Sin datos en ${MESES[mesSel]} ${anioSel}`}
                sub="Los puntos verdes indican meses con ventas"/>
            : <>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                <div style={{gridColumn:"1/-1"}}>
                  <StatCard icon="💰" label={`Total ${MESES[mesSel]} ${anioSel}`}
                    value={$(totalPer)} sub={`${ventasPer.length} transacciones · ${porMarcaPer.length} marcas`}/>
                </div>
                <StatCard icon="💵" label="Efectivo" value={$(efectivoPer)} color="#4A9B6F" small/>
                <StatCard icon="📱" label="QR"       value={$(qrPer)}       color="#5B8DB8" small/>
                <StatCard icon="💳" label="Tarjeta"  value={$(tarjetaPer)}  color="#C8922A" small/>
                <StatCard icon="🏷" label="Comisión 10%" value={$(totalPer*.1)} color={C.red} small/>
                <StatCard icon="✅" label="Neto marcas"  value={$(totalPer*.9)} color={C.green} small/>
              </div>

              {/* Cierre status */}
              <div style={{background:C.bg2,borderRadius:14,padding:"14px 16px",marginBottom:16}}>
                <div style={{fontSize:12,fontWeight:700,color:C.label3,textTransform:"uppercase",
                  letterSpacing:.6,marginBottom:10}}>Estado de cierres</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {MARCAS.filter(m=>ventasPer.some(v=>v.items.some(i=>i.marcaId===m.id))).map(m=>{
                    const cerrado = cierres[`${MKSel}-${m.id}`]?.cerrado;
                    return (
                      <div key={m.id} style={{display:"flex",alignItems:"center",gap:5,
                        padding:"4px 10px",borderRadius:20,
                        background:cerrado?`${C.green}15`:`${C.amber}15`,
                        border:`1px solid ${cerrado?C.green:C.amber}30`}}>
                        <span style={{fontSize:13}}>{m.emoji}</span>
                        <span style={{fontSize:12,fontFamily:FONT,
                          color:cerrado?C.green:C.amber}}>{m.nombre}</span>
                        <span style={{fontSize:11}}>{cerrado?"✓":"⏳"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          }
        </div>
      )}

      {/* ── POR MARCA ── */}
      {vista==="marcas"&&(
        <div>
          {porMarcaPer.length===0
            ? <EmptyState icon="🏷" title="Sin ventas por marca" sub={`${MESES[mesSel]} ${anioSel}`}/>
            : porMarcaPer.map((x,i)=>{
                const maxT = Math.max(...porMarcaPer.map(p=>p.total),1);
                return (
                  <div key={x.marca.id} style={{
                    background:C.bg2,
                    borderRadius:i===0?"16px 16px 4px 4px":i===porMarcaPer.length-1?"4px 4px 16px 16px":"4px",
                    borderBottom:i<porMarcaPer.length-1?`1px solid ${C.sep}`:"",
                    padding:"14px 16px",
                    borderLeft:`4px solid ${x.marca.color}`,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:20}}>{x.marca.emoji}</span>
                        <div>
                          <div style={{fontSize:15,fontWeight:700,color:C.label,fontFamily:FONT}}>{x.marca.nombre}</div>
                          <div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>{x.txs} venta{x.txs!==1?"s":""}</div>
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:18,fontWeight:800,color:x.marca.color,fontFamily:FONT}}>{$(x.total)}</div>
                        <div style={{fontSize:11,color:C.green,fontFamily:FONT}}>Neto: {$(x.total*.9)}</div>
                      </div>
                    </div>
                    <div style={{background:"rgba(0,0,0,0.06)",borderRadius:4,height:5,marginBottom:10}}>
                      <div style={{width:`${(x.total/maxT)*100}%`,background:x.marca.color,height:5,borderRadius:4}}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                      {[["💵",x.ef,"#4A9B6F"],["📱",x.qr,"#5B8DB8"],["💳",x.tj,"#C8922A"]].map(([icon,val,color])=>(
                        <div key={icon} style={{padding:"7px",background:`${color}10`,borderRadius:8,textAlign:"center",
                          opacity:val>0?1:.4}}>
                          <div style={{fontSize:13}}>{icon}</div>
                          <div style={{fontSize:12,fontWeight:700,color,fontFamily:FONT}}>{val>0?$(val):"—"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── VENTAS DETALLE ── */}
      {vista==="ventas"&&(
        <div>
          {ventasPer.length===0
            ? <EmptyState icon="📊" title="Sin ventas" sub={`${MESES[mesSel]} ${anioSel}`}/>
            : [...ventasPer].reverse().map(v=>{
                return (
                  <div key={v.id} onClick={()=>onVentaClick&&onVentaClick(v)}
                    style={{background:C.bg2,borderRadius:14,padding:"14px 16px",marginBottom:10,
                      cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <div>
                        <span style={{fontFamily:"monospace",fontSize:12,color:C.gold}}>{v.id}</span>
                        <div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>{v.fecha} {v.hora}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Chip color={colorPago(v.metodoPago)}>{iconPago(v.metodoPago)} {labelPago(v.metodoPago)}</Chip>
                        <span style={{fontSize:17,fontWeight:800,color:C.gold,fontFamily:FONT}}>{$(v.total)}</span>
                      </div>
                    </div>
                    {v.items.map((it,ii)=>{
                      const m=MARCAS.find(x=>x.id===it.marcaId);
                      return (
                        <div key={ii} style={{fontSize:13,color:C.label2,fontFamily:FONT,
                          display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                          <div style={{width:6,height:6,borderRadius:"50%",background:m?.color,flexShrink:0}}/>
                          {it.nombre} ×{it.cantidad} = {$(it.subtotal)}
                        </div>
                      );
                    })}
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── STOCK ── */}
      {vista==="stock"&&(
        <div>
          <div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginBottom:12}}>
            Inventario registrado — estado actual
          </div>
          {inv.length===0
            ? <EmptyState icon="📦" title="Sin productos en inventario"/>
            : MARCAS.map(m=>{
                const prods=inv.filter(i=>i.marcaId===m.id);
                if(!prods.length) return null;
                const stockTotal=prods.reduce((s,p)=>s+p.stock,0);
                const vendTotal=prods.reduce((s,p)=>s+(p.stockInicial-p.stock),0);
                return (
                  <div key={m.id} style={{background:C.bg2,borderRadius:14,
                    padding:"14px 16px",marginBottom:10,borderLeft:`4px solid ${m.color}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",
                      alignItems:"center",marginBottom:10}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:18}}>{m.emoji}</span>
                        <span style={{fontSize:15,fontWeight:700,color:C.label,fontFamily:FONT}}>{m.nombre}</span>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:13,color:C.green,fontFamily:FONT}}>{stockTotal} en stock</div>
                        <div style={{fontSize:12,color:C.blue,fontFamily:FONT}}>{vendTotal} vendidas</div>
                      </div>
                    </div>
                    {prods.map(p=>(
                      <div key={p.id} style={{display:"flex",justifyContent:"space-between",
                        alignItems:"center",padding:"8px 0",
                        borderTop:`1px solid ${C.sep}`}}>
                        <div>
                          <div style={{fontSize:13,color:C.label,fontFamily:FONT}}>{p.nombre}</div>
                          <span style={{fontFamily:"monospace",fontSize:10,color:C.gold,
                            background:`${C.gold}18`,padding:"1px 6px",borderRadius:4}}>{p.codigo}</span>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:14,fontWeight:700,
                            color:p.stock===0?C.red:p.stock<3?C.amber:C.green,fontFamily:FONT}}>
                            {p.stock} uds
                          </div>
                          <div style={{fontSize:11,color:C.label3,fontFamily:FONT}}>{$(p.precio)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
          }
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// CONFIG TAB — Gestión de usuarios y contraseñas
// ══════════════════════════════════════════════════════════
function ConfigTab({user, logout}){
  var _hN155 = useState("cuenta"); var subTab = _hN155[0]; var setSubTab = _hN155[1];;
  // Usuarios guardados en localStorage (sobre los defaults)
  var _hN156 = useState(function(){ try{return JSON.parse(localStorage.getItem("th_usuarios")||"null")||USUARIOS;}catch{return USUARIOS;} }); var usuarios = _hN156[0]; var setUsuarios = _hN156[1];
  function guardarUsuarios(u){
    setUsuarios(u);
    localStorage.setItem("th_usuarios", JSON.stringify(u));
  }

  return (
    <div>
      {/* Header */}
      <div style={{marginBottom:20}}>
        <h2 style={{margin:0,fontSize:22,fontWeight:800,color:C.label,fontFamily:FONT}}>Configuración</h2>
        <p style={{margin:"4px 0 0",color:C.label3,fontFamily:FONT,fontSize:13}}>
          Sesión activa: <strong style={{color:C.gold}}>{user.nombre}</strong> · {user.rol}
        </p>
      </div>

      {/* Sub tabs */}
      <div style={{marginBottom:20}}>
        <SegControl
          options={[
            {value:"cuenta",  label:"Mi cuenta"},
            {value:"usuarios",label:"Usuarios"},
            {value:"sistema", label:"Sistema"},
          ]}
          value={subTab} onChange={setSubTab}
        />
      </div>

      {/* ── MI CUENTA ── */}
      {subTab==="cuenta" && <CambiarContrasena user={user} usuarios={usuarios} onGuardar={guardarUsuarios}/>}

      {/* ── USUARIOS ── */}
      {subTab==="usuarios" && <GestionUsuarios user={user} usuarios={usuarios} onGuardar={guardarUsuarios}/>}

      {/* ── SISTEMA ── */}
      {subTab==="sistema" && (
        <div>
          {/* Info sistema */}
          <div style={{background:C.bg2,borderRadius:16,overflow:"hidden",marginBottom:16}}>
            {[
              ["Versión","Toscana House v3.0"],
              ["Base de datos","Supabase (nube)"],
              ["Usuario activo",user.nombre],
              ["Rol",user.rol==="admin"?"Administrador":"Cajero"],
            ].map(([k,v],i,arr)=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",
                padding:"14px 16px",borderBottom:i<arr.length-1?`1px solid ${C.sep}`:""}}>
                <span style={{fontSize:15,color:C.label2,fontFamily:FONT}}>{k}</span>
                <span style={{fontSize:15,color:C.label,fontFamily:FONT,fontWeight:500}}>{v}</span>
              </div>
            ))}
          </div>

          {/* Cerrar sesión */}
          <IOSBtn onPress={logout} variant="danger" full icon="🚪">
            Cerrar sesión
          </IOSBtn>
        </div>
      )}
    </div>
  );
}

// ── Cambiar contraseña ────────────────────────────────────
function CambiarContrasena({user, usuarios, onGuardar}){
  var _hN157 = useState(""); var passActual = _hN157[0]; var setPassActual = _hN157[1];;
  var _hN158 = useState(""); var passNueva = _hN158[0]; var setPassNueva = _hN158[1];;
  var _hN159 = useState(""); var passConfirm = _hN159[0]; var setPassConfirm = _hN159[1];;
  var _hN160 = useState(null); var msg = _hN160[0]; var setMsg = _hN160[1];;
  var _hN161 = useState(false); var show = _hN161[0]; var setShow = _hN161[1];;

  function cambiar(){
    setMsg(null);
    const u = usuarios.find(x=>x.usuario===user.usuario);
    if (!u) { setMsg({ok:false,txt:"Usuario no encontrado"}); return; }
    if (u.password !== passActual) { setMsg({ok:false,txt:"Contraseña actual incorrecta"}); return; }
    if (passNueva.length < 6) { setMsg({ok:false,txt:"La nueva contraseña debe tener al menos 6 caracteres"}); return; }
    if (passNueva !== passConfirm) { setMsg({ok:false,txt:"Las contraseñas no coinciden"}); return; }
    const nuevos = usuarios.map(x=>x.usuario===user.usuario?{...x,password:passNueva}:x);
    onGuardar(nuevos);
    setMsg({ok:true,txt:"✓ Contraseña actualizada correctamente"});
    setPassActual(""); setPassNueva(""); setPassConfirm("");
  }

  return (
    <div>
      <div style={{background:C.bg2,borderRadius:16,padding:16,marginBottom:16,
        border:`1px solid ${C.sep}`}}>
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
          <div style={{width:48,height:48,borderRadius:"50%",
            background:`${C.gold}20`,display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:22}}>👤</div>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:C.label,fontFamily:FONT}}>{user.nombre}</div>
            <div style={{fontSize:13,color:C.label3,fontFamily:FONT}}>@{user.usuario}</div>
          </div>
        </div>
      </div>

      <div style={{fontSize:13,fontWeight:700,color:C.label3,textTransform:"uppercase",
        letterSpacing:.8,marginBottom:12}}>Cambiar contraseña</div>

      <IOSInput label="Contraseña actual" type={show?"text":"password"}
        value={passActual} onChange={e=>setPassActual(e.target.value)} placeholder="••••••••"/>
      <IOSInput label="Nueva contraseña" type={show?"text":"password"}
        value={passNueva} onChange={e=>setPassNueva(e.target.value)} placeholder="Mínimo 6 caracteres"/>
      <IOSInput label="Confirmar nueva contraseña" type={show?"text":"password"}
        value={passConfirm} onChange={e=>setPassConfirm(e.target.value)} placeholder="Repetir contraseña"/>

      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
        <input type="checkbox" id="showPass" checked={show} onChange={e=>setShow(e.target.checked)}/>
        <label htmlFor="showPass" style={{fontSize:13,color:C.label3,fontFamily:FONT,cursor:"pointer"}}>
          Mostrar contraseñas
        </label>
      </div>

      {msg&&(
        <div style={{padding:"12px 14px",borderRadius:12,marginBottom:12,
          background:msg.ok?`${C.green}15`:`${C.red}15`,
          border:`1px solid ${msg.ok?C.green:C.red}40`,
          color:msg.ok?C.green:C.red,fontSize:14,fontFamily:FONT}}>{msg.txt}</div>
      )}

      <IOSBtn onPress={cambiar} variant="primary" full icon="🔒">
        Actualizar contraseña
      </IOSBtn>
    </div>
  );
}

// ── Gestión de usuarios ───────────────────────────────────
function GestionUsuarios({user, usuarios, onGuardar}){
  var _hN162 = useState(null); var modo = _hN162[0]; var setModo = _hN162[1];; // null | "nuevo" | "editar"
  var _hN163 = useState(null); var editUser = _hN163[0]; var setEditUser = _hN163[1];;
  var _hN164 = useState({usuario:"",password:"",nombre:"",rol:"caja"}); var fUser = _hN164[0]; var setFUser = _hN164[1];;
  var _hN165 = useState(null); var msg = _hN165[0]; var setMsg = _hN165[1];;

  if (user.rol !== "admin") {
    return (
      <div style={{textAlign:"center",padding:"48px 20px",color:C.label3}}>
        <div style={{fontSize:40,marginBottom:12,opacity:.4}}>🔒</div>
        <div style={{fontSize:16,fontWeight:600,color:C.label2,fontFamily:FONT}}>
          Solo administradores
        </div>
        <div style={{fontSize:13,color:C.label3,fontFamily:FONT,marginTop:6}}>
          Tu cuenta no tiene permisos para gestionar usuarios
        </div>
      </div>
    );
  }

  function guardar(){
    setMsg(null);
    if(!fUser.usuario||!fUser.password||!fUser.nombre){setMsg({ok:false,txt:"Completa todos los campos"});return;}
    if(fUser.password.length<6){setMsg({ok:false,txt:"La contraseña debe tener al menos 6 caracteres"});return;}
    if(modo==="nuevo"){
      if(usuarios.find(u=>u.usuario===fUser.usuario)){setMsg({ok:false,txt:"Ese usuario ya existe"});return;}
      onGuardar([...usuarios,{...fUser}]);
    } else {
      onGuardar(usuarios.map(u=>u.usuario===editUser?{...u,...fUser}:u));
    }
    setMsg({ok:true,txt:`✓ Usuario ${modo==="nuevo"?"creado":"actualizado"}`});
    setTimeout(()=>{setModo(null);setMsg(null);},1500);
  }

  function eliminar(usr){
    if(usr===user.usuario){setMsg({ok:false,txt:"No puedes eliminar tu propio usuario"});return;}
    if(!window.confirm(`¿Eliminar usuario "${usr}"?`)) return;
    onGuardar(usuarios.filter(u=>u.usuario!==usr));
  }

  if(modo){
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
          <IOSBtn onPress={()=>{setModo(null);setMsg(null);}} variant="fill" small>← Volver</IOSBtn>
          <span style={{fontSize:17,fontWeight:700,color:C.label,fontFamily:FONT}}>
            {modo==="nuevo"?"Nuevo usuario":"Editar usuario"}
          </span>
        </div>
        <IOSInput label="Nombre completo" value={fUser.nombre}
          onChange={e=>setFUser(p=>({...p,nombre:e.target.value}))} placeholder="Ej: María García"/>
        <IOSInput label="Usuario (para login)" value={fUser.usuario}
          onChange={e=>setFUser(p=>({...p,usuario:e.target.value.toLowerCase().replace(/ /g,"")}))}
          placeholder="Ej: maria" autoCapitalize="none"/>
        <IOSInput label="Contraseña" type="password" value={fUser.password}
          onChange={e=>setFUser(p=>({...p,password:e.target.value}))} placeholder="Mínimo 6 caracteres"/>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:700,color:C.label2,textTransform:"uppercase",
            letterSpacing:.8,marginBottom:8}}>Rol</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[["admin","👑 Admin","Acceso total"],["caja","🛒 Cajero","Solo POS y ventas"]].map(([r,label,desc])=>(
              <button key={r} onClick={()=>setFUser(p=>({...p,rol:r}))} style={{
                padding:"12px",borderRadius:12,cursor:"pointer",fontFamily:FONT,
                border:`2px solid ${fUser.rol===r?C.gold:C.sep}`,
                background:fUser.rol===r?`${C.gold}15`:C.bg2,
                textAlign:"left",
              }}>
                <div style={{fontSize:14,fontWeight:700,color:fUser.rol===r?C.gold:C.label}}>{label}</div>
                <div style={{fontSize:11,color:C.label3,marginTop:2}}>{desc}</div>
              </button>
            ))}
          </div>
        </div>
        {msg&&(
          <div style={{padding:"12px 14px",borderRadius:12,marginBottom:12,
            background:msg.ok?`${C.green}15`:`${C.red}15`,
            border:`1px solid ${msg.ok?C.green:C.red}40`,
            color:msg.ok?C.green:C.red,fontSize:14,fontFamily:FONT}}>{msg.txt}</div>
        )}
        <IOSBtn onPress={guardar} variant="primary" full icon="💾">
          {modo==="nuevo"?"Crear usuario":"Guardar cambios"}
        </IOSBtn>
      </div>
    );
  }

  return (
    <div>
      {msg&&(
        <div style={{padding:"12px 14px",borderRadius:12,marginBottom:12,
          background:msg.ok?`${C.green}15`:`${C.red}15`,
          border:`1px solid ${msg.ok?C.green:C.red}40`,
          color:msg.ok?C.green:C.red,fontSize:14,fontFamily:FONT}}>{msg.txt}</div>
      )}

      {/* Lista usuarios */}
      <div style={{display:"flex",flexDirection:"column",gap:2,marginBottom:16}}>
        {usuarios.map((u,i)=>(
          <div key={u.usuario} style={{
            background:C.bg2,
            borderRadius:i===0?"14px 14px 2px 2px":i===usuarios.length-1?"2px 2px 14px 14px":"2px",
            padding:"14px 16px",
            borderBottom:i<usuarios.length-1?`1px solid ${C.sep}`:"",
            display:"flex",alignItems:"center",gap:12,
          }}>
            <div style={{width:40,height:40,borderRadius:"50%",
              background:u.rol==="admin"?`${C.gold}20`:`${C.green}20`,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
              {u.rol==="admin"?"👑":"🛒"}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:15,fontWeight:600,color:C.label,fontFamily:FONT}}>{u.nombre}</div>
              <div style={{fontSize:13,color:C.label3,fontFamily:FONT}}>
                @{u.usuario} · {u.rol==="admin"?"Administrador":"Cajero"}
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexShrink:0}}>
              <button onClick={()=>{setEditUser(u.usuario);setFUser({...u});setModo("editar");}} style={{
                background:`${C.gold}15`,border:`1px solid ${C.gold}30`,
                borderRadius:8,padding:"6px 12px",color:C.gold,
                fontSize:12,fontFamily:FONT,fontWeight:600,cursor:"pointer",
              }}>Editar</button>
              {u.usuario!==user.usuario&&(
                <button onClick={()=>eliminar(u.usuario)} style={{
                  background:`${C.red}10`,border:`1px solid ${C.red}30`,
                  borderRadius:8,padding:"6px 12px",color:C.red,
                  fontSize:12,fontFamily:FONT,fontWeight:600,cursor:"pointer",
                }}>Eliminar</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <IOSBtn onPress={()=>{setFUser({usuario:"",password:"",nombre:"",rol:"caja"});setModo("nuevo");}}
        variant="primary" full icon="+ ">
        Agregar nuevo usuario
      </IOSBtn>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// DASHBOARD VENTAS — con filtro de fechas y buscador
// ══════════════════════════════════════════════════════════
function DashboardVentas({ventas, onVentaClick}){
  const now=new Date();
  const [fechaIni, setFechaIni] = useState(now.toISOString().slice(0,7)+"-01");
  const [fechaFin, setFechaFin] = useState(now.toISOString().slice(0,10));
  const [codBusq, setCodBusq] = useState("");
  const [vistaD, setVistaD] = useState("dashboard"); // "dashboard" | "lista" | "busqueda"

  const ventasFiltradas = useMemo(()=>{
    return ventas.filter(v=>v.fecha>=fechaIni && v.fecha<=fechaFin);
  },[ventas,fechaIni,fechaFin]);

  const ventasBusqueda = useMemo(()=>{
    if(!codBusq.trim()) return [];
    const q=codBusq.trim().toLowerCase();
    return [...ventas].reverse().filter(v=>
      v.items.some(it=>it.codigo.toLowerCase().includes(q)||it.nombre.toLowerCase().includes(q))
    );
  },[ventas,codBusq]);

  const totalFil = ventasFiltradas.reduce((s,v)=>s+v.total,0);
  const efectivoFil = ventasFiltradas.filter(v=>v.metodoPago==="efectivo").reduce((s,v)=>s+v.total,0);
  const qrFil = ventasFiltradas.filter(v=>v.metodoPago==="qr").reduce((s,v)=>s+v.total,0);
  const tarjetaFil = ventasFiltradas.filter(v=>v.metodoPago==="tarjeta").reduce((s,v)=>s+v.total,0);
  const mixtoFil = ventasFiltradas.filter(v=>v.metodoPago?.startsWith("mixto|")).reduce((s,v)=>s+v.total,0);

  const porMarcaFil = useMemo(()=>{
    const map={};
    ventasFiltradas.forEach(v=>v.items.forEach(it=>{
      if(!map[it.marcaId])map[it.marcaId]={marcaId:it.marcaId,marcaNombre:it.marcaNombre,total:0,cant:0};
      map[it.marcaId].total+=it.subtotal; map[it.marcaId].cant+=it.cantidad;
    }));
    return Object.values(map).sort((a,b)=>b.total-a.total);
  },[ventasFiltradas]);

  const fmtDate = d=>d?d.split("-").reverse().join("/"):"";

  return (
    <div>
      {/* Filtro fechas */}
      <div style={{background:C.bg1,borderRadius:14,padding:16,marginBottom:14,
        border:`1px solid ${C.sep}`,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        <div style={{fontSize:12,fontWeight:600,color:C.label3,textTransform:"uppercase",
          letterSpacing:.6,marginBottom:10,fontFamily:FONT}}>Período</div>
        <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:120}}>
            <div style={{fontSize:11,color:C.label3,fontFamily:FONT,marginBottom:4}}>Desde</div>
            <input type="date" value={fechaIni} onChange={e=>setFechaIni(e.target.value)}
              style={{width:"100%",padding:"9px 12px",border:`1px solid ${C.sep}`,
                borderRadius:8,background:C.bg2,fontSize:13,color:C.label,
                fontFamily:FONT,outline:"none",boxSizing:"border-box"}}/>
          </div>
          <div style={{flex:1,minWidth:120}}>
            <div style={{fontSize:11,color:C.label3,fontFamily:FONT,marginBottom:4}}>Hasta</div>
            <input type="date" value={fechaFin} onChange={e=>setFechaFin(e.target.value)}
              style={{width:"100%",padding:"9px 12px",border:`1px solid ${C.sep}`,
                borderRadius:8,background:C.bg2,fontSize:13,color:C.label,
                fontFamily:FONT,outline:"none",boxSizing:"border-box"}}/>
          </div>
        </div>
      </div>

      {/* Sub-navegación */}
      <div style={{display:"flex",gap:4,marginBottom:14,background:C.bg2,
        borderRadius:10,padding:3,border:`1px solid ${C.sep}`}}>
        {[{id:"dashboard",label:"📊 Dashboard"},{id:"lista",label:"📋 Lista"},{id:"busqueda",label:"🔍 Por Código"}].map(t=>(
          <button key={t.id} onClick={()=>setVistaD(t.id)} style={{
            flex:1,border:"none",borderRadius:8,padding:"8px 4px",
            fontSize:11,fontWeight:vistaD===t.id?700:400,cursor:"pointer",
            fontFamily:FONT,background:vistaD===t.id?C.bg1:"transparent",
            color:vistaD===t.id?C.blue:C.label3,
            boxShadow:vistaD===t.id?"0 1px 3px rgba(0,0,0,0.08)":"none",
            transition:"all .15s",WebkitTapHighlightColor:"transparent"}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── DASHBOARD ── */}
      {vistaD==="dashboard"&&(
        <div>
          {/* KPI principal */}
          <div style={{background:C.blue,borderRadius:16,padding:"20px 24px",marginBottom:12,
            boxShadow:"0 4px 16px rgba(21,101,192,0.25)"}}>
            <div style={{fontSize:12,color:"rgba(255,255,255,0.8)",fontFamily:FONT,
              marginBottom:6,textTransform:"uppercase",letterSpacing:.8}}>
              Total facturado · {fmtDate(fechaIni)} – {fmtDate(fechaFin)}
            </div>
            <div style={{fontSize:32,fontWeight:800,color:"#fff",fontFamily:FONT,lineHeight:1}}>
              {$(totalFil)}
            </div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.75)",fontFamily:FONT,marginTop:6}}>
              {ventasFiltradas.length} venta{ventasFiltradas.length!==1?"s":""} en el período
            </div>
          </div>

          {/* KPIs por método de pago */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            {[
              {icon:"💵",label:"Efectivo",val:efectivoFil,color:C.green},
              {icon:"📱",label:"QR",val:qrFil,color:C.blue},
              {icon:"💳",label:"Tarjeta",val:tarjetaFil,color:C.amber},
              ...(mixtoFil>0?[{icon:"🔀",label:"Mixto",val:mixtoFil,color:"#6A1B9A"}]:[]),
            ].map(s=>(
              <div key={s.label} style={{background:C.bg1,borderRadius:12,padding:"14px 16px",
                border:`1px solid ${C.sep}`,boxShadow:"0 1px 3px rgba(0,0,0,0.05)"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:18}}>{s.icon}</span>
                  <span style={{fontSize:12,color:C.label3,fontFamily:FONT}}>{s.label}</span>
                </div>
                <div style={{fontSize:16,fontWeight:800,color:s.color,fontFamily:FONT}}>{$(s.val)}</div>
                <div style={{fontSize:11,color:C.label3,fontFamily:FONT,marginTop:2}}>
                  {Math.round(totalFil>0?(s.val/totalFil)*100:0)}% del total
                </div>
              </div>
            ))}
          </div>

          {/* Por marca */}
          {porMarcaFil.length>0&&(
            <div style={{background:C.bg1,borderRadius:14,padding:16,
              border:`1px solid ${C.sep}`,boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
              <div style={{fontSize:13,fontWeight:700,color:C.label,fontFamily:FONT,marginBottom:12}}>
                Ventas por marca
              </div>
              {porMarcaFil.map((x,i)=>{
                const marca=MARCAS.find(m=>m.id===x.marcaId);
                const pct=totalFil>0?Math.round((x.total/totalFil)*100):0;
                return (
                  <div key={x.marcaId} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:14}}>{marca?.emoji||"🏷"}</span>
                        <span style={{fontSize:13,color:C.label,fontFamily:FONT,fontWeight:500}}>
                          {x.marcaNombre}
                        </span>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <span style={{fontSize:13,fontWeight:700,color:marca?.color||C.label,fontFamily:FONT}}>
                          {$(x.total)}
                        </span>
                        <span style={{fontSize:11,color:C.label3,fontFamily:FONT,marginLeft:6}}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                    <div style={{background:C.sep,borderRadius:4,height:5,overflow:"hidden"}}>
                      <div style={{width:`${pct}%`,height:5,borderRadius:4,
                        background:marca?.color||C.blue,transition:"width .5s"}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {porMarcaFil.length===0&&(
            <div style={{textAlign:"center",padding:"30px 0",color:C.label3,fontFamily:FONT,fontSize:13}}>
              Sin ventas en el período seleccionado
            </div>
          )}
        </div>
      )}

      {/* ── LISTA DE VENTAS ── */}
      {vistaD==="lista"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:13,color:C.label3,fontFamily:FONT}}>
              {ventasFiltradas.length} venta{ventasFiltradas.length!==1?"s":""} · {$(totalFil)}
            </span>
          </div>
          {ventasFiltradas.length===0
            ? <div style={{textAlign:"center",padding:"30px 0",color:C.label3,fontFamily:FONT,fontSize:13}}>
                Sin ventas en el período
              </div>
            : [...ventasFiltradas].reverse().map(v=>(
                <div key={v.id} onClick={()=>onVentaClick&&onVentaClick(v)}
                  style={{background:C.bg1,borderRadius:12,padding:"14px 16px",marginBottom:8,
                    border:`1px solid ${C.sep}`,cursor:"pointer",
                    boxShadow:"0 1px 3px rgba(0,0,0,0.05)",
                    WebkitTapHighlightColor:"transparent"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <div>
                      <span style={{fontFamily:"monospace",fontSize:11,color:C.label3}}>{v.id}</span>
                      <div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>{v.fecha} {v.hora} · {v.vendedor||"Tienda"}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:15,fontWeight:800,color:C.blue,fontFamily:FONT}}>{$(v.total)}</div>
                      <Chip color={colorPago(v.metodoPago)} small>{iconPago(v.metodoPago)} {labelPago(v.metodoPago)}</Chip>
                    </div>
                  </div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {v.items.map((it,i)=>(
                      <span key={i} style={{fontSize:11,color:C.label3,fontFamily:FONT}}>
                        {it.nombre} ×{it.cantidad}{i<v.items.length-1?" ·":""}
                      </span>
                    ))}
                  </div>
                </div>
              ))
          }
        </div>
      )}

      {/* ── BÚSQUEDA POR CÓDIGO ── */}
      {vistaD==="busqueda"&&(
        <div>
          <div style={{position:"relative",marginBottom:14}}>
            <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",
              fontSize:16,color:C.label3}}>🔍</span>
            <input
              value={codBusq}
              onChange={e=>setCodBusq(e.target.value)}
              placeholder="Código de producto o nombre del ítem…"
              style={{width:"100%",padding:"12px 12px 12px 40px",border:`1px solid ${C.sep}`,
                borderRadius:10,background:C.bg1,fontSize:14,color:C.label,
                fontFamily:FONT,outline:"none",boxSizing:"border-box",
                boxShadow:"0 1px 3px rgba(0,0,0,0.05)"}}
            />
          </div>

          {codBusq.trim()&&(
            <div style={{marginBottom:8,fontSize:12,color:C.label3,fontFamily:FONT}}>
              {ventasBusqueda.length} resultado{ventasBusqueda.length!==1?"s":""}
              {ventasBusqueda.length>0&&` · Total: ${$(ventasBusqueda.reduce((s,v)=>s+v.total,0))}`}
            </div>
          )}

          {!codBusq.trim()&&(
            <div style={{textAlign:"center",padding:"40px 0",color:C.label3,fontFamily:FONT,fontSize:13}}>
              Escribe un código o nombre para buscar en todas las ventas
            </div>
          )}

          {ventasBusqueda.map(v=>{
            const itsMatch=v.items.filter(it=>{
              const q=codBusq.trim().toLowerCase();
              return it.codigo.toLowerCase().includes(q)||it.nombre.toLowerCase().includes(q);
            });
            return (
              <div key={v.id} onClick={()=>onVentaClick&&onVentaClick(v)}
                style={{background:C.bg1,borderRadius:12,padding:"14px 16px",marginBottom:8,
                  border:`1px solid ${C.sep}`,cursor:"pointer",
                  boxShadow:"0 1px 3px rgba(0,0,0,0.05)",
                  WebkitTapHighlightColor:"transparent"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <div>
                    <span style={{fontFamily:"monospace",fontSize:11,color:C.label3}}>{v.id}</span>
                    <div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>{v.fecha} · {v.vendedor||"Tienda"}</div>
                  </div>
                  <div style={{fontSize:15,fontWeight:800,color:C.blue,fontFamily:FONT}}>{$(v.total)}</div>
                </div>
                <div style={{borderTop:`1px solid ${C.sep}`,paddingTop:8}}>
                  {itsMatch.map((it,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",
                      fontSize:13,color:C.label,fontFamily:FONT,marginBottom:4}}>
                      <div>
                        <span style={{fontFamily:"monospace",fontSize:11,
                          background:C.accent,color:C.blue,padding:"1px 6px",borderRadius:4,marginRight:6}}>
                          {it.codigo}
                        </span>
                        {it.nombre} ×{it.cantidad}
                      </div>
                      <span style={{fontWeight:600,color:C.label2}}>{$(it.subtotal)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// VENTAS TAB — totales globales + desglose por marca
// ══════════════════════════════════════════════════════════
function VentasTab({vMes, totalVtas, mes, anio, onVentaClick}){
  var _hN166 = useState("marcas"); var vistaActiva = _hN166[0]; var setVistaActiva = _hN166[1];; // "marcas" | "historial"
  var _hN167 = useState(null); var marcaFiltro = _hN167[0]; var setMarcaFiltro = _hN167[1];; // id marca o null = todas

  // Calcular ventas por marca con desglose de método de pago
  const porMarca = useMemo(()=>{
    return MARCAS.map(m=>{
      const efectivo = vMes.filter(v=>v.metodoPago==="efectivo")
        .reduce((s,v)=>s+v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0),0);
      const qr = vMes.filter(v=>v.metodoPago==="qr")
        .reduce((s,v)=>s+v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0),0);
      const tarjeta = vMes.filter(v=>v.metodoPago==="tarjeta")
        .reduce((s,v)=>s+v.items.filter(i=>i.marcaId===m.id).reduce((ss,i)=>ss+i.subtotal,0),0);
      const total = efectivo+qr+tarjeta;
      const txs = vMes.filter(v=>v.items.some(i=>i.marcaId===m.id)).length;
      return {marca:m, total, efectivo, qr, tarjeta, txs};
    }).filter(x=>x.total>0).sort((a,b)=>b.total-a.total);
  },[vMes]);

  const totalEfectivo = vMes.filter(v=>v.metodoPago==="efectivo").reduce((s,v)=>s+v.total,0);
  const totalQR       = vMes.filter(v=>v.metodoPago==="qr").reduce((s,v)=>s+v.total,0);
  const totalTarjeta  = vMes.filter(v=>v.metodoPago==="tarjeta").reduce((s,v)=>s+v.total,0);
  const totalMixto    = vMes.filter(v=>v.metodoPago?.startsWith("mixto|")).reduce((s,v)=>s+v.total,0);
  const maxVenta      = Math.max(...porMarca.map(x=>x.total), 1);

  // Ventas filtradas por marca para el historial
  const ventasFiltradas = useMemo(()=>{
    if(!marcaFiltro) return [...vMes].reverse();
    return [...vMes].filter(v=>v.items.some(i=>i.marcaId===marcaFiltro)).reverse();
  },[vMes, marcaFiltro]);

  return (
    <div>
      {/* Stats globales */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
        <div style={{gridColumn:"1/-1",background:C.bg2,borderRadius:16,padding:"16px 20px",
          border:`1px solid ${C.sep}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:11,color:C.label3,fontWeight:700,textTransform:"uppercase",letterSpacing:.7,marginBottom:3}}>Total {MESES[mes]}</div>
            <div style={{fontSize:28,fontWeight:800,color:C.gold,fontFamily:FONT,lineHeight:1}}>{$(totalVtas)}</div>
            <div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginTop:3}}>{vMes.length} transacciones · {porMarca.length} marcas activas</div>
          </div>
          <div style={{fontSize:36,opacity:.4}}>💰</div>
        </div>
        {[
          {icon:"💵",label:"Efectivo",value:totalEfectivo,color:"#4A9B6F"},
          {icon:"📱",label:"QR",value:totalQR,color:"#5B8DB8"},
          {icon:"💳",label:"Tarjeta",value:totalTarjeta,color:"#C8922A"},
          ...(totalMixto>0?[{icon:"🔀",label:"Mixto",value:totalMixto,color:"#6C5CE7"}]:[]),
        ].map(s=>(
          <StatCard key={s.label} icon={s.icon} label={s.label} value={$(s.value)}
            sub={`${Math.round(totalVtas>0?(s.value/totalVtas)*100:0)}% del total`} color={s.color}/>
        ))}
      </div>

      {/* Selector vista */}
      <div style={{marginBottom:16}}>
        <SegControl
          options={[{value:"marcas",label:"Por Marca"},{value:"historial",label:"Historial"}]}
          value={vistaActiva} onChange={setVistaActiva}
        />
      </div>

      {/* ── VISTA POR MARCA ── */}
      {vistaActiva==="marcas"&&(
        <div>
          {porMarca.length===0
            ? <EmptyState icon="📊" title={`Sin ventas en ${MESES[mes]}`} sub="Las ventas aparecerán aquí"/>
            : porMarca.map((x,i)=>(
                <div key={x.marca.id} style={{
                  background:C.bg2,
                  borderRadius:i===0?"16px 16px 4px 4px":i===porMarca.length-1?"4px 4px 16px 16px":"4px",
                  borderBottom:i<porMarca.length-1?`1px solid ${C.sep}`:"",
                  padding:"14px 16px",
                  cursor:"pointer",
                  WebkitTapHighlightColor:"transparent",
                  borderLeft:`4px solid ${x.marca.color}`,
                }}
                onClick={()=>{setMarcaFiltro(marcaFiltro===x.marca.id?null:x.marca.id);setVistaActiva("historial");}}>
                  {/* Cabecera marca */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{width:36,height:36,borderRadius:10,
                        background:`${x.marca.color}22`,display:"flex",
                        alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                        {x.marca.emoji}
                      </div>
                      <div>
                        <div style={{fontSize:15,fontWeight:700,color:C.label,fontFamily:FONT}}>{x.marca.nombre}</div>
                        <div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>{x.txs} venta{x.txs!==1?"s":""}</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:18,fontWeight:800,color:x.marca.color,fontFamily:FONT}}>{$(x.total)}</div>
                      <div style={{fontSize:11,color:C.label3,fontFamily:FONT}}>
                        {Math.round((x.total/totalVtas)*100)}% del total
                      </div>
                    </div>
                  </div>

                  {/* Barra total */}
                  <div style={{background:"rgba(0,0,0,0.06)",borderRadius:6,height:6,marginBottom:10,overflow:"hidden"}}>
                    <div style={{width:`${(x.total/maxVenta)*100}%`,background:x.marca.color,
                      height:6,borderRadius:6,transition:"width .5s"}}/>
                  </div>

                  {/* Desglose métodos de pago */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                    {[
                      {icon:"💵",label:"Efectivo",value:x.efectivo,color:"#4A9B6F"},
                      {icon:"📱",label:"QR",value:x.qr,color:"#5B8DB8"},
                      {icon:"💳",label:"Tarjeta",value:x.tarjeta,color:"#C8922A"},
                    ].map(p=>(
                      <div key={p.label} style={{
                        padding:"8px 10px",borderRadius:10,
                        background:p.value>0?`${p.color}12`:"rgba(0,0,0,0.03)",
                        border:`1px solid ${p.value>0?p.color+"25":C.sep}`,
                        opacity:p.value>0?1:.5,
                      }}>
                        <div style={{fontSize:14,marginBottom:3}}>{p.icon}</div>
                        <div style={{fontSize:11,color:C.label3,fontFamily:FONT,marginBottom:2}}>{p.label}</div>
                        <div style={{fontSize:13,fontWeight:700,
                          color:p.value>0?p.color:C.label3,fontFamily:FONT}}>
                          {p.value>0?$(p.value):"—"}
                        </div>
                        {p.value>0&&x.total>0&&(
                          <div style={{fontSize:10,color:C.label3,fontFamily:FONT}}>
                            {Math.round((p.value/x.total)*100)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{marginTop:10,fontSize:11,color:x.marca.color,
                    fontFamily:FONT,textAlign:"right",fontWeight:600}}>
                    Ver ventas de {x.marca.nombre} →
                  </div>
                </div>
              ))
          }
        </div>
      )}

      {/* ── HISTORIAL ── */}
      {vistaActiva==="historial"&&(
        <div>
          {/* Filtro por marca */}
          <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8,marginBottom:14,
            scrollbarWidth:"none",WebkitOverflowScrolling:"touch"}}>
            <button onClick={()=>setMarcaFiltro(null)} style={{
              flexShrink:0,padding:"7px 16px",borderRadius:20,
              border:`1.5px solid ${!marcaFiltro?C.gold:C.sep}`,
              background:!marcaFiltro?`${C.gold}20`:"transparent",
              color:!marcaFiltro?C.gold:C.label3,
              fontSize:12,fontFamily:FONT,fontWeight:!marcaFiltro?700:400,
              cursor:"pointer",WebkitTapHighlightColor:"transparent",
            }}>Todas</button>
            {MARCAS.filter(m=>vMes.some(v=>v.items.some(i=>i.marcaId===m.id))).map(m=>(
              <button key={m.id} onClick={()=>setMarcaFiltro(marcaFiltro===m.id?null:m.id)} style={{
                flexShrink:0,padding:"7px 14px",borderRadius:20,
                border:`1.5px solid ${marcaFiltro===m.id?m.color:C.sep}`,
                background:marcaFiltro===m.id?`${m.color}20`:"transparent",
                color:marcaFiltro===m.id?m.color:C.label3,
                fontSize:12,fontFamily:FONT,fontWeight:marcaFiltro===m.id?700:400,
                cursor:"pointer",WebkitTapHighlightColor:"transparent",
                display:"flex",alignItems:"center",gap:5,
              }}>
                <span>{m.emoji}</span>{m.nombre}
              </button>
            ))}
          </div>

          {ventasFiltradas.length===0
            ? <EmptyState icon="📋" title="Sin ventas" sub={marcaFiltro?"Esta marca no tiene ventas":"Sin ventas en el período"}/>
            : ventasFiltradas.map(v=>{
                const itemsMostrar=marcaFiltro
                  ? v.items.filter(i=>i.marcaId===marcaFiltro)
                  : v.items;
                const totalMostrar=itemsMostrar.reduce((s,i)=>s+i.subtotal,0);
                return (
                  <div key={v.id} onClick={()=>onVentaClick&&onVentaClick(v)}
                    style={{background:C.bg2,borderRadius:16,padding:"14px 16px",marginBottom:10,
                      cursor:"pointer",WebkitTapHighlightColor:"transparent"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <span style={{fontFamily:"monospace",fontSize:12,color:C.gold,fontWeight:700}}>{v.id}</span>
                        <div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginTop:2}}>
                          {v.fecha} {v.hora} · {v.vendedor||"Tienda"}
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Chip color={colorPago(v.metodoPago)}>{iconPago(v.metodoPago)} {labelPago(v.metodoPago)}</Chip>
                        <span style={{fontSize:18,fontWeight:800,color:C.gold,fontFamily:FONT}}>{$(totalMostrar)}</span>
                      </div>
                    </div>
                    {/* Ítems agrupados por marca */}
                    {(()=>{
                      const byMarca={};
                      itemsMostrar.forEach(it=>{
                        if(!byMarca[it.marcaId])byMarca[it.marcaId]={marca:MARCAS.find(m=>m.id===it.marcaId),items:[],sub:0};
                        byMarca[it.marcaId].items.push(it);
                        byMarca[it.marcaId].sub+=it.subtotal;
                      });
                      return Object.values(byMarca).map(g=>(
                        <div key={g.marca?.id} style={{marginBottom:8,padding:"8px 10px",
                          background:`${g.marca?.color}10`,borderRadius:10,
                          borderLeft:`3px solid ${g.marca?.color}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              <span style={{fontSize:14}}>{g.marca?.emoji}</span>
                              <span style={{fontSize:13,fontWeight:700,color:g.marca?.color,fontFamily:FONT}}>{g.marca?.nombre}</span>
                            </div>
                            <span style={{fontSize:13,fontWeight:700,color:g.marca?.color,fontFamily:FONT}}>{$(g.sub)}</span>
                          </div>
                          {g.items.map((it,ii)=>(
                            <div key={ii} style={{fontSize:12,color:C.label2,fontFamily:FONT}}>
                              · {it.nombre} ×{it.cantidad} = {$(it.subtotal)}
                            </div>
                          ))}
                        </div>
                      ));
                    })()}
                    <IOSBtn onPress={()=>sendWA(v)} variant="fill" small full icon="📲">
                      Enviar por WhatsApp
                    </IOSBtn>
                    {v.etiquetaImg&&<img src={v.etiquetaImg} alt="etiqueta"
                      style={{width:"100%",maxHeight:80,objectFit:"cover",borderRadius:10,marginTop:10}}/>}
                  </div>
                );
              })
          }
        </div>
      )}
    </div>
  );
}

// ── Atoms aux ──
function FilterPill({label,color,active,onPress}){
  return (
    <button onClick={onPress} style={{
      padding:"7px 14px",borderRadius:20,
      background:active?(color?`${color}30`:C.fill3):C.bg2,
      border:`1px solid ${active?(color||C.gold):C.sep}`,
      color:active?(color||C.gold):C.label2,
      fontSize:13,fontFamily:FONT,fontWeight:active?600:400,
      cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,
      WebkitTapHighlightColor:"transparent",
      transition:"all .15s",
    }}>{label}</button>
  );
}

function EmptyState({icon,title,sub}){
  return (
    <div style={{textAlign:"center",padding:"48px 20px",color:C.label3}}>
      <div style={{fontSize:44,marginBottom:12,opacity:.5}}>{icon}</div>
      <div style={{fontSize:17,fontWeight:600,color:C.label2,fontFamily:FONT,marginBottom:6}}>{title}</div>
      {sub&&<div style={{fontSize:14,color:C.label3,fontFamily:FONT}}>{sub}</div>}
    </div>
  );
}
