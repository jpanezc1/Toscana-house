import { useState, useMemo, useRef, useCallback, useEffect } from "react";

// ════════════════════════════════════════════════════════════
// SUPABASE — Base de datos en la nube
// Proyecto: toscana house | uqphxiixdulqscbfyxhz
// ════════════════════════════════════════════════════════════
const SUPA_URL  = "https://uqphxiixdulqscbfyxhz.supabase.co";
const SUPA_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxcGh4aWl4ZHVscXNjYmZ5eGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzc0NjQsImV4cCI6MjA5MjYxMzQ2NH0.U1EIf4JWqfrvga7CApClLl7nzBuFoPpD8BlicxvfB-w";

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
  const [status, setStatus] = useState("connecting"); // connecting | ok | error
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
  const [qrDataUrl, setQrDataUrl] = useState("");

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
  const [url, setUrl] = useState(() => localStorage.getItem("th_drive_url") || "");
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState(() => { try { return JSON.parse(localStorage.getItem("th_sync_log") || "[]"); } catch { return []; } });

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

// ── Paleta Pastel — Toscana House Casa de Moda ──────────
const C = {
  bg0:   "#F2F7F2",
  bg1:   "#FFFFFF",
  bg2:   "#F7FAF7",
  bg3:   "#EAF3EA",
  label:    "#1A2E1A",
  label2:   "#4A6B4A",
  label3:   "#7A9A7A",
  label4:   "rgba(26,46,26,0.18)",
  sep:   "rgba(74,107,74,0.15)",
  sepH:  "rgba(74,107,74,0.28)",
  gold:  "#5C8A5C",
  goldL: "#8BB88B",
  goldD: "#3D6B3D",
  accent:"#B8D4B8",
  cream: "#F5F0E8",
  green: "#4A9B6F",
  red:   "#C0504A",
  blue:  "#5B8DB8",
  amber: "#C8922A",
  indigo:"#7B7BB8",
  tabPos:"#6BAE8B",
  tabInv:"#7AAE5C",
  tabMar:"#C8925A",
  tabVen:"#5A8BB8",
  tabLiq:"#AE5A8B",
  fill1: "rgba(74,107,74,0.04)",
  fill2: "rgba(74,107,74,0.08)",
  fill3: "rgba(74,107,74,0.14)",
  stockOk:  "#E8F5E8",
  stockLow: "#FFF8E8",
  stockOut: "#FFF0EE",
  stockSold:"#EEF2FF",
  greenBg:  "#E8F5E8",
  redBg:    "#FFF0EE",
  amberBg:  "#FFF8E8",
};

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
  const pg=PAGOS.find(p=>p.id===venta.metodoPago);
  const msg=[`🏡 *TOSCANA HOUSE — ${venta.id}*`,`📅 ${venta.fecha} ${venta.hora}`,`💳 ${pg?.label}${venta.descPct?` (-${venta.descPct}%)`:""}`,"",  ...lines,"",`💰 *TOTAL: ${$(venta.total)}*`].join("\n");
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`,"_blank");
}

// ══════════════════════════════════════════════════════════
// iOS DESIGN ATOMS
// ══════════════════════════════════════════════════════════

// Font stack
const FONT = "'Cormorant Garamond', 'Palatino', 'Georgia', serif";

// Logo SVG inline de Toscana House
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" fill="none">
  <text x="100" y="52" textAnchor="middle" fontFamily="Georgia,serif" fontSize="44" fontWeight="700" fill="currentColor" letterSpacing="2">TH</text>
  <text x="100" y="76" textAnchor="middle" fontFamily="Georgia,serif" fontSize="13" fontWeight="400" fill="currentColor" letterSpacing="8">TOSCANA</text>
  <text x="100" y="92" textAnchor="middle" fontFamily="Georgia,serif" fontSize="9" fontWeight="300" fill="currentColor" letterSpacing="6">CASA DE MODA</text>
  <line x1="30" y1="60" x2="170" y2="60" stroke="currentColor" strokeWidth="0.5" opacity="0.4"/>
</svg>`;

function LogoMark({size=36, color="#3D6B3D"}){
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
  const [pressed, setPressed] = useState(false);
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
      borderBottom:`2px solid ${C.sep}`,
      boxShadow:"0 2px 16px rgba(74,107,74,0.10)",
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
  pos:          C.tabPos,
  inventario:   C.tabInv,
  marcas:       C.tabMar,
  ventas:       C.tabVen,
  liquidaciones:C.tabLiq,
  config:       "#7A9A7A",
  historial:    "#6B8BAE",
};

function TabBar({tabs, active, onChange}){
  return (
    <div style={{
      position:"fixed",bottom:0,left:0,right:0,zIndex:200,
      background:"rgba(255,255,255,0.96)",
      backdropFilter:"blur(20px) saturate(180%)",
      WebkitBackdropFilter:"blur(20px) saturate(180%)",
      borderTop:`2px solid ${C.sep}`,
      display:"flex",
      paddingBottom:16,
      boxShadow:"0 -4px 24px rgba(74,107,74,0.10)",
    }}>
      {tabs.map(t=>{
        const isActive=active===t.id;
        const tabColor=TAB_COLORS[t.id]||C.gold;
        return (
          <button key={t.id} onClick={()=>onChange(t.id)} style={{
            flex:1,border:"none",
            background:isActive?`${tabColor}18`:"transparent",
            display:"flex",flexDirection:"column",alignItems:"center",
            padding:"10px 0 4px",
            cursor:"pointer",
            WebkitTapHighlightColor:"transparent",
            gap:4,
            borderTop:isActive?`3px solid ${tabColor}`:"3px solid transparent",
            transition:"all .2s",
          }}>
            <div style={{
              width:32,height:32,borderRadius:10,
              background:isActive?tabColor:"transparent",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:isActive?18:20,lineHeight:1,
              transform:isActive?"scale(1.05)":"scale(1)",
              transition:"all .2s cubic-bezier(.34,1.56,.64,1)",
              boxShadow:isActive?`0 4px 12px ${tabColor}50`:"none",
            }}>{t.icon}</div>
            <span style={{
              fontSize:10,fontFamily:FONT,fontWeight:isActive?700:400,
              color:isActive?tabColor:C.label3,
              transition:"color .2s",letterSpacing:.3,
            }}>{t.label}</span>
          </button>
        );
      })}
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
  const [visible, setVisible] = useState(false);
  const [anim, setAnim] = useState(false);
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
        paddingBottom:24,
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
                  {v.fecha} {v.hora} · {PAGOS.find(p=>p.id===v.metodoPago)?.label}
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
  const [user, setUser] = useState(()=>{ } catch { return null; }
  });

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
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

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
// APP PRINCIPAL
// ══════════════════════════════════════════════════════════
export default function App(){
  const { user, login, logout } = useAuth();
  const now=new Date();
  const [tab, setTab] = useState("pos");
  const [inv, setInv] = useState([]);
  const [ventas, setVentas] = useState([]);
  const [alq, setAlq] = useState([]);
  const [cierres, setCierres] = useState({});
  const [cargando, setCargando] = useState(true);
  const [dbStatus, setDbStatus] = useState("connecting");
  const [mes, setMes] = useState(now.getMonth());
  const [anio, setAnio] = useState(now.getFullYear());
  const [marcaDetalle, setMD] = useState(null);
  const [sheetInv, setShInv] = useState(false);
  const [sheetBaja, setShBaja] = useState(false);
  const [sheetDrive, setShDrive] = useState(false);
  const [mLiq, setMLiq] = useState(null);
  const [fInv, setFInv] = useState({marcaId:"",nombre:"",categoria:"",precio:"",stock:"",fecha:hoy()});
  const [bajaCod, setBajaCod] = useState("");
  const [bajaMsg, setBajaMsg] = useState(null);
  const [busqInv, setBusqInv] = useState("");
  const [filInvM, setFilInvM] = useState("");
  const [driveUrl, setDriveUrlLocal] = useState(()=>{ try{return localStorage.getItem("th_drive_url")||"";}catch{return "";} });
  const [generando, setGenerando] = useState(false);
  const drive = useDriveSync();

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
    {id:"pos",icon:"⊕",label:"Caja"},
    {id:"inventario",icon:"◫",label:"Inventario"},
    {id:"marcas",icon:"◆",label:"Marcas"},
    {id:"ventas",icon:"◈",label:"Ventas"},
    {id:"liquidaciones",icon:"◎",label:"Liquidar"},
    {id:"historial",icon:"📅",label:"Historial"},
    {id:"config",icon:"⚙",label:"Config"},
  ];

  // Pantallas con vista de detalle (back button)
  const showingDetail = tab==="marcas" && marcaDetalle;
  // Pasar dbStatus al NavBar via closure (ya está en scope)

  // Early return si no hay sesión
  if (!user) return <LoginScreen onLogin={login}/>;

  return (
    <div style={{
      minHeight:"100vh",
      background:`linear-gradient(160deg, ${C.bg0} 0%, #E8F2E8 50%, #F0F5F0 100%)`,
      color:C.label,
      fontFamily:FONT,
      paddingBottom:84, // espacio para tab bar + safe area
      WebkitFontSmoothing:"antialiased",
      MozOsxFontSmoothing:"grayscale",
    }}>

      {/* ── LOADING SCREEN ── */}
      {cargando&&(
        <div style={{position:"fixed",inset:0,background:"rgba(242,247,242,0.97)",
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
                background:"none",border:"none",fontSize:13,cursor:"pointer",
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

        {/* POS */}
        {tab==="pos" && <POS inv={inv} onVenta={handleVenta}/>}

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
          <VentasTab vMes={vMes} totalVtas={totalVtas} mes={mes} anio={anio}/>
        )}

        {/* LIQUIDACIONES */}
        {tab==="liquidaciones" && (
          <div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:600,color:C.label3,textTransform:"uppercase",letterSpacing:.8,marginBottom:12}}>
                {MESES[mes]} {anio}
              </div>
              <div style={{display:"flex",gap:10}}>
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

        {/* HISTORIAL */}
        {tab==="historial" && (
          <HistorialTab ventas={ventas} inv={inv} cierres={cierres}/>
        )}

        {/* CONFIG */}
        {tab==="config" && (
          <ConfigTab user={user} logout={logout}/>
        )}
      </div>

      {/* ── BOTTOM TAB BAR ── */}
      <TabBar tabs={TABS} active={tab} onChange={t=>{setTab(t);setMD(null);}}/>

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


// ════════════════════════════════════════════════════════════
// ESCÁNER QR EN VIVO — usa cámara nativa del iPhone
// Lee QR en tiempo real sin necesidad de tomar foto
// ════════════════════════════════════════════════════════════
function QRScanner({ onDetect, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef  = useRef(null);
  const [status, setStatus] = useState("iniciando"); // iniciando | activo | error
  const [msg, setMsg] = useState("");

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 1280, height: 720 }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setStatus("activo");
        setMsg("Apunta al código QR de la prenda");
        // Start scanning loop
        timerRef.current = setInterval(scanFrame, 300);
      }
    } catch (e) {
      setStatus("error");
      setMsg("No se pudo acceder a la cámara. Permite el acceso en Ajustes.");
    }
  }

  function stopCamera() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
  }

  async function scanFrame() {
    if (!videoRef.current || !canvasRef.current) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Use BarcodeDetector API (native, works on iOS 17+)
    if (window.BarcodeDetector) {
      try {
        const detector = new window.BarcodeDetector({ formats: ["qr_code","code_128","ean_13","code_39"] });
        const codes = await detector.detect(canvas);
        if (codes.length > 0) {
          const raw = codes[0].rawValue;
          clearInterval(timerRef.current);
          stopCamera();
          onDetect(raw);
          return;
        }
      } catch(e) {}
    }
    // Fallback: ZXing
    try {
      const ZXing = await loadZXing();
      if (!ZXing) return;
      const luminance = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      const reader = new ZXing.MultiFormatReader();
      reader.setHints(hints);
      const result = reader.decode(bitmap);
      if (result?.text) {
        clearInterval(timerRef.current);
        stopCamera();
        onDetect(result.text);
      }
    } catch(e) {}
  }

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9999,
      background:"#000",
      display:"flex", flexDirection:"column",
    }}>
      {/* Header */}
      <div style={{
        padding:"16px 20px",
        display:"flex", justifyContent:"space-between", alignItems:"center",
        background:"rgba(0,0,0,0.8)",
      }}>
        <div>
          <div style={{fontSize:17,fontWeight:700,color:"#fff",fontFamily:FONT}}>Escanear QR</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",fontFamily:FONT,marginTop:2}}>{msg}</div>
        </div>
        <button onClick={()=>{stopCamera();onClose();}} style={{
          background:"rgba(255,255,255,0.15)",border:"none",
          width:36,height:36,borderRadius:"50%",cursor:"pointer",
          color:"#fff",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",
          WebkitTapHighlightColor:"transparent",
        }}>✕</button>
      </div>

      {/* Cámara */}
      <div style={{flex:1,position:"relative",overflow:"hidden"}}>
        <video
          ref={videoRef}
          playsInline muted autoPlay
          style={{width:"100%",height:"100%",objectFit:"cover"}}
        />
        <canvas ref={canvasRef} style={{display:"none"}}/>

        {/* Marco de escaneo */}
        {status==="activo"&&(
          <div style={{
            position:"absolute",
            top:"50%",left:"50%",
            transform:"translate(-50%,-60%)",
            width:220,height:220,
          }}>
            {/* Esquinas del marco */}
            {[
              {top:0,left:0,borderTop:"3px solid #4A9B6F",borderLeft:"3px solid #4A9B6F"},
              {top:0,right:0,borderTop:"3px solid #4A9B6F",borderRight:"3px solid #4A9B6F"},
              {bottom:0,left:0,borderBottom:"3px solid #4A9B6F",borderLeft:"3px solid #4A9B6F"},
              {bottom:0,right:0,borderBottom:"3px solid #4A9B6F",borderRight:"3px solid #4A9B6F"},
            ].map((s,i)=>(
              <div key={i} style={{position:"absolute",width:30,height:30,...s}}/>
            ))}
            {/* Línea de escaneo animada */}
            <div style={{
              position:"absolute",left:0,right:0,height:2,
              background:"rgba(74,155,111,0.8)",
              animation:"scanline 2s linear infinite",
              top:"50%",
            }}/>
            <style>{`@keyframes scanline{0%{top:10%}50%{top:90%}100%{top:10%}}`}</style>
          </div>
        )}

        {status==="error"&&(
          <div style={{
            position:"absolute",inset:0,
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            background:"rgba(0,0,0,0.7)",padding:24,textAlign:"center",
          }}>
            <div style={{fontSize:48,marginBottom:16}}>📷</div>
            <div style={{fontSize:16,color:"#fff",fontFamily:FONT,marginBottom:8}}>Sin acceso a la cámara</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",fontFamily:FONT,marginBottom:20}}>{msg}</div>
            <button onClick={()=>{stopCamera();onClose();}} style={{
              background:C.green,border:"none",borderRadius:12,
              padding:"12px 24px",color:"#fff",fontSize:15,
              fontFamily:FONT,fontWeight:600,cursor:"pointer",
            }}>Cerrar</button>
          </div>
        )}

        {status==="iniciando"&&(
          <div style={{
            position:"absolute",inset:0,
            display:"flex",alignItems:"center",justifyContent:"center",
            background:"rgba(0,0,0,0.5)",
          }}>
            <div style={{fontSize:15,color:"#fff",fontFamily:FONT}}>Iniciando cámara…</div>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        padding:"16px 20px",
        background:"rgba(0,0,0,0.8)",
        textAlign:"center",
        fontSize:13,color:"rgba(255,255,255,0.5)",fontFamily:FONT,
      }}>
        El código se detecta automáticamente
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// POS — iOS Caja
// ══════════════════════════════════════════════════════════
function POS({inv,onVenta}){
  const [carrito, setCarrito] = useState([]);
  const [busq, setBusq] = useState("");
  const [pago, setPago] = useState("efectivo");
  const [vendedor, setVendedor] = useState("");
  const [descExtra, setDescExtra] = useState(0);
  const [ultima, setUltima] = useState(null);
  const [showOk, setShowOk] = useState(false);
  const [showPago, setShowPago] = useState(false);
  const [scanStatus, setScanStatus] = useState(null);
  const [scanMsg, setScanMsg] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const inputRef=useRef();

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


  function cobrar(){
    if(!carrito.length)return;
    const factor=1-descPct/100;
    const items=carrito.map(it=>({prodId:it.prodId,codigo:it.codigo,nombre:it.nombre,
      marcaId:it.marcaId,marcaNombre:it.marcaNombre,
      cantidad:it.cantidad,precioUnit:it.precio,subtotal:it.precio*it.cantidad*factor}));
    const vf=onVenta({items,total,subtotal,descPct,metodoPago:pago,vendedor:vendedor||"Tienda",etiquetaImg:null});
    setUltima(vf);setShowOk(true);setShowPago(false);
    setCarrito([]);setDescExtra(0);setBusq("");
  }

  return (
    <div style={{position:"relative", minHeight:"100vh"}}>

      {/* Logo fondo decorativo */}
      <div style={{
        position:"fixed",
        top:"50%", left:"50%",
        transform:"translate(-50%, -50%)",
        zIndex:0,
        pointerEvents:"none",
        display:"flex",flexDirection:"column",
        alignItems:"center",justifyContent:"center",
        opacity:0.045,
        userSelect:"none",
      }}>
        <div style={{
          fontSize:180,
          fontFamily:"Georgia,serif",
          fontWeight:900,
          color:C.gold,
          letterSpacing:-8,
          lineHeight:1,
        }}>TH</div>
        <div style={{
          width:280, height:2,
          background:C.gold,
          margin:"8px 0",
        }}/>
        <div style={{
          fontSize:26,
          fontFamily:"Georgia,serif",
          fontWeight:400,
          color:C.gold,
          letterSpacing:14,
          textTransform:"uppercase",
        }}>TOSCANA</div>
        <div style={{
          fontSize:14,
          fontFamily:"Georgia,serif",
          fontWeight:300,
          color:C.gold,
          letterSpacing:10,
          marginTop:4,
        }}>CASA DE MODA</div>
      </div>

      {/* Contenido encima del logo */}
      <div style={{position:"relative",zIndex:1}}>

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

      {/* Escáner QR en vivo */}
      {showScanner&&(
        <QRScanner
          onDetect={(codigo)=>{
            setShowScanner(false);
            setScanStatus("ok");
            const prod=inv.find(i=>i.codigo.toUpperCase()===codigo.toUpperCase());
            if(prod){
              add(prod);
              setScanMsg(`✓ "${prod.nombre}" agregado al carrito`);
            } else {
              setBusq(codigo);
              setScanMsg(`Código "${codigo}" — no encontrado en inventario`);
              setScanStatus("notfound");
            }
            setTimeout(()=>{setScanStatus(null);setScanMsg("");},4000);
          }}
          onClose={()=>setShowScanner(false)}
        />
      )}

      {/* Botón escanear */}
      <div style={{marginBottom:14}}>
        <IOSBtn onPress={()=>setShowScanner(true)} variant="fill" full icon="📷">
          Escanear código QR
        </IOSBtn>
        {scanMsg&&(
          <div style={{marginTop:10,padding:"10px 14px",borderRadius:12,fontSize:14,fontFamily:FONT,
            background:scanStatus==="ok"?`${C.green}15`:`${C.amber}15`,
            border:`1px solid ${scanStatus==="ok"?C.green:C.amber}30`,
            color:scanStatus==="ok"?C.green:C.amber}}>
            {scanMsg}
          </div>
        )}
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
  const [scanInvMsg, setScanInvMsg] = useState("");
  const [scanInvStatus, setScanInvStatus] = useState(null);
  const [barcodeReady, setBarcodeReady] = useState(false);
  const scanInvRef=useRef(null);
  
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
  const [marcaSelec, setMarcaSelec] = useState(MARCAS[0].id);
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
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MARCA DETALLE — iOS navigation push style
// ══════════════════════════════════════════════════════════
function MarcaDetalle({marcaId,inv,ventas,vMes,mes,anio,MK,cierres,setCierres,getHist,getLiq}){
  const [sub, setSub] = useState("historial");
  const [filtroMk, setFMk] = useState("");
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
                          <Chip color={v.metodoPago==="tarjeta"?C.amber:v.metodoPago==="qr"?C.blue:C.green} small>
                            {PAGOS.find(p=>p.id===v.metodoPago)?.label}
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
                      {v.fecha} {v.hora} · {PAGOS.find(p=>p.id===v.metodoPago)?.label}
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
function HistorialTab({ventas, inv, cierres}){
  const now = new Date();
  const [mesSel, setMesSel] = useState(now.getMonth());
  const [anioSel, setAnioSel] = useState(now.getFullYear());
  const [vista, setVista] = useState("resumen"); // resumen | marcas | ventas | stock

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
                const pg=PAGOS.find(p=>p.id===v.metodoPago);
                return (
                  <div key={v.id} style={{background:C.bg2,borderRadius:14,padding:"14px 16px",marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <div>
                        <span style={{fontFamily:"monospace",fontSize:12,color:C.gold}}>{v.id}</span>
                        <div style={{fontSize:12,color:C.label3,fontFamily:FONT}}>{v.fecha} {v.hora}</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Chip color={pg?.color||C.green}>{pg?.icon} {pg?.label}</Chip>
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
  const [subTab, setSubTab] = useState("cuenta");
  // Usuarios guardados en localStorage (sobre los defaults)
  const [usuarios, setUsuarios] = useState(()=>{ }
    catch { return USUARIOS; }
  });
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
  const [passActual, setPassActual] = useState("");
  const [passNueva, setPassNueva] = useState("");
  const [passConfirm, setPassConfirm] = useState("");
  const [msg, setMsg] = useState(null);
  const [show, setShow] = useState(false);

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
  const [modo, setModo] = useState(null); // null | "nuevo" | "editar"
  const [editUser, setEditUser] = useState(null);
  const [fUser, setFUser] = useState({usuario:"",password:"",nombre:"",rol:"caja"});
  const [msg, setMsg] = useState(null);

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
// VENTAS TAB — totales globales + desglose por marca
// ══════════════════════════════════════════════════════════
function VentasTab({vMes, totalVtas, mes, anio}){
  const [vistaActiva, setVistaActiva] = useState("marcas"); // "marcas" | "historial"
  const [marcaFiltro, setMarcaFiltro] = useState(null); // id marca o null = todas

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
                const pg=PAGOS.find(p=>p.id===v.metodoPago);
                const itemsMostrar=marcaFiltro
                  ? v.items.filter(i=>i.marcaId===marcaFiltro)
                  : v.items;
                const totalMostrar=itemsMostrar.reduce((s,i)=>s+i.subtotal,0);
                return (
                  <div key={v.id} style={{background:C.bg2,borderRadius:16,padding:"14px 16px",marginBottom:10}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div>
                        <span style={{fontFamily:"monospace",fontSize:12,color:C.gold,fontWeight:700}}>{v.id}</span>
                        <div style={{fontSize:12,color:C.label3,fontFamily:FONT,marginTop:2}}>
                          {v.fecha} {v.hora} · {v.vendedor||"Tienda"}
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <Chip color={pg?.color||C.green}>{pg?.icon} {pg?.label}</Chip>
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
