const esbuild = require("esbuild");
const fs = require("fs");

const PROD_SUPABASE_URL = "https://uqphxiixdulqscbfyxhz.supabase.co";
const PROD_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxcGh4aWl4ZHVscXNjYmZ5eGh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMzc0NjQsImV4cCI6MjA5MjYxMzQ2NH0.U1EIf4JWqfrvga7CApClLl7nzBuFoPpD8BlicxvfB-w";
const deployEnvironment = String(process.env.VERCEL_ENV || "local").trim().toLowerCase();
const configuredSupabaseUrl = String(process.env.TH_SUPABASE_URL || "").trim().replace(/\/$/, "");
const configuredSupabaseAnonKey = String(process.env.TH_SUPABASE_ANON_KEY || "").trim();

if (deployEnvironment === "preview") {
  if (!configuredSupabaseUrl || !configuredSupabaseAnonKey) {
    throw new Error(
      "Build de preview bloqueado: configure TH_SUPABASE_URL y TH_SUPABASE_ANON_KEY para staging."
    );
  }
  if (configuredSupabaseUrl === PROD_SUPABASE_URL) {
    throw new Error(
      "Build de preview bloqueado: TH_SUPABASE_URL apunta a la base de datos de producción."
    );
  }
}

const buildSupabaseUrl = configuredSupabaseUrl || PROD_SUPABASE_URL;
const buildSupabaseAnonKey = configuredSupabaseAnonKey || PROD_SUPABASE_ANON_KEY;
const configuredAppEnvironment = String(process.env.TH_APP_ENV || "").trim().toLowerCase();
const buildAppEnvironment = deployEnvironment === "preview"
  ? "staging"
  : deployEnvironment === "production"
    ? "production"
    : (["local", "staging", "production"].includes(configuredAppEnvironment)
      ? configuredAppEnvironment
      : "");

// ── Crear main.jsx (entry point) ─────────────────────────────────────────────
let app = fs.readFileSync("App.jsx", "utf8");
app = app.replace(/^import .+\n/gm, "");
const main = `import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import * as __XLSXBundled from "xlsx";
if (typeof window !== "undefined") window.__XLSXBundled = __XLSXBundled;
${app}
const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
`;
fs.writeFileSync("main.jsx", main);

// ── Versión única por build ───────────────────────────────────────────────────
const v = Date.now();

// Eliminar bundles anteriores
fs.readdirSync(".").filter(f=>/^bundle-\d+\.js$/.test(f)).forEach(f=>fs.unlinkSync(f));

// ── Compilar bundle con nombre versionado ─────────────────────────────────────
esbuild.buildSync({
  entryPoints: ["main.jsx"],
  bundle: true,
  outfile: `bundle-${v}.js`,
  loader: { ".jsx": "jsx" },
  jsx: "transform",
  platform: "browser",
  target: "es2020",
  minify: false,
  define: {
    __TH_SUPABASE_URL__: JSON.stringify(buildSupabaseUrl),
    __TH_SUPABASE_ANON_KEY__: JSON.stringify(buildSupabaseAnonKey),
    __TH_APP_ENV__: JSON.stringify(buildAppEnvironment),
  },
});

// ── PWA Manifest ──────────────────────────────────────────────────────────────
const manifest = {
  name: "Toscana House",
  short_name: "Toscana",
  description: "Sistema de gestión Toscana House — Casa de Moda",
  start_url: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#FAF9F7",
  theme_color: "#FAF9F7",
  icons: [
    { src: "public/favicon.ico",  sizes: "64x64 32x32 24x24 16x16", type: "image/x-icon" },
    { src: "public/logo192.png",  type: "image/png", sizes: "192x192" },
    { src: "public/logo512.png",  type: "image/png", sizes: "512x512" }
  ]
};
fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));

// ── Service worker (offline + instalación) ─────────────────────────────────
// Cachea el "app shell" (HTML, manifest, íconos, bundle de esta versión) para
// que la app abra y siga funcionando sin internet, mostrando los últimos
// datos guardados en localStorage. Cada build usa un nombre de caché nuevo
// (basado en `v`) y borra los cachés anteriores al activarse.
const sw = `// Generado automáticamente por build.js — no editar a mano
const CACHE_NAME = "th-cache-${v}";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./bundle-${v}.js",
  "./public/favicon.ico",
  "./public/logo192.png",
  "./public/logo512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        CORE_ASSETS.map((url) => cache.add(url).catch(() => {}))
      ))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Solo cachear el mismo origen (app shell). Las peticiones a Supabase
  // y otros servicios externos van directo a la red sin pasar por cache,
  // para no servir datos de inventario/ventas desactualizados.
  if (url.origin !== self.location.origin) return;

  // version.json y navegación: red primero (para detectar actualizaciones),
  // cache de respaldo si no hay internet.
  if (url.pathname.endsWith("version.json") || request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          return resp;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  // Resto de assets: cache primero (rápido y funciona offline),
  // y se actualiza el cache en segundo plano si hay red.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
`;
fs.writeFileSync("sw.js", sw);

const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">

  <!-- Viewport — full safe-area coverage (notch, Dynamic Island, Android cutout) -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">

  <!-- PWA / instalación en pantalla de inicio -->
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Toscana">
  <meta name="application-name" content="Toscana House">

  <!-- Tema de color (barra del navegador / UI del OS) -->
  <meta name="theme-color" content="#FAF9F7">
  <meta name="msapplication-TileColor" content="#FAF9F7">

  <!-- SEO / descripción -->
  <meta name="description" content="Toscana House — Sistema de gestión de marcas y ventas">
  <meta name="robots" content="noindex, nofollow">

  <!-- Cache control — siempre cargar versión más nueva -->
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">

  <!-- PWA manifest -->
  <link rel="manifest" href="manifest.json">

  <title>Toscana House</title>

  <!-- Tipografías premium -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Inter:wght@300;400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet">

  <style>
    /* ═══════════════════════════════════════════════════════════════
       TOSCANA HOUSE — Global CSS
       Reset + PWA + iOS + Premium base
       ═══════════════════════════════════════════════════════════════ */

    /* ── Reset universal ──────────────────────────────────────────── */
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      /* Elimina el flash azul al tocar en iOS/Android */
      -webkit-tap-highlight-color: transparent;
    }

    /* ── HTML raíz ────────────────────────────────────────────────── */
    html {
      height: 100%;
      /* Scroll suave en todo el documento */
      scroll-behavior: smooth;
      /* Previene efecto de rebote al hacer scroll más allá del límite */
      overscroll-behavior: none;
    }

    /* ── Body ────────────────────────────────────────────────────── */
    body {
      width: 100%;
      min-height: 100%;
      /* Fallback para browsers que no soportan dvh */
      min-height: -webkit-fill-available;

      background: #F5F3EE;
      color: #1A1714;

      /* Previene scroll horizontal indeseado */
      overflow-x: hidden;

      /* Previene rebote en iOS (efecto de "overscroll") */
      overscroll-behavior: none;

      /* Suavizado de tipografía premium (como nativo en Mac/iOS) */
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }

    /* ── Root de React ───────────────────────────────────────────── */
    #root {
      min-height: 100vh;
      min-height: -webkit-fill-available;
      position: relative;
    }

    /* ── Inputs: prevenir zoom en iOS ────────────────────────────── */
    /* iOS hace zoom cuando font-size < 16px. Este base se
       puede sobrescribir con inline styles en componentes específicos. */
    input,
    textarea,
    select {
      font-size: 16px;
      /* Elimina estilos nativos del OS (especialmente en iOS Safari) */
      -webkit-appearance: none;
      appearance: none;
      /* Evita border-radius nativo en iOS */
      border-radius: 0;
    }

    /* ── Ocultar UI nativa del color picker ──────────────────────── */
    /* El app usa su propio color picker con botones de colores */
    input[type="color"] {
      opacity: 0;
      position: absolute;
      width: 0;
      height: 0;
      pointer-events: none;
    }
    input::-webkit-color-swatch-wrapper { display: none; }
    input::-webkit-color-swatch         { display: none; }
    input::-moz-color-swatch            { display: none; }

    /* ── Imágenes responsive ─────────────────────────────────────── */
    img {
      display: block;
      max-width: 100%;
    }

    /* ── Scrollbars refinados — Atelier ─────────────────────────── */
    ::-webkit-scrollbar {
      width: 3px;
      height: 3px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(138, 100, 24, 0.18);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(138, 100, 24, 0.35);
    }

    /* ── Focus visible accesible ─────────────────────────────────── */
    :focus           { outline: none; }
    :focus-visible   {
      outline: 2px solid rgba(138, 100, 24, 0.42);
      outline-offset: 2px;
      border-radius: 6px;
    }

    /* ── Animación page entry ────────────────────────────────────── */
    @keyframes fadeUp {
      from { opacity:0; transform:translateY(6px); }
      to   { opacity:1; transform:translateY(0); }
    }

    /* ── Contenedores con scroll suave en iOS ────────────────────── */
    .scroll-touch {
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-y: contain;
    }

    /* ── Centering helpers ───────────────────────────────────────── */
    .page-center {
      width: 100%;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ── Safe area para notch/Dynamic Island ─────────────────────── */
    /* Se usa en el app con env(safe-area-inset-*) directamente */
    .safe-top    { padding-top:    env(safe-area-inset-top);    }
    .safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
    .safe-left   { padding-left:   env(safe-area-inset-left);   }
    .safe-right  { padding-right:  env(safe-area-inset-right);  }
  </style>
</head>
<body>
  <div id="root"></div>
  <!-- Auto-updater: detecta nueva versión y recarga sin intervención del usuario -->
  <script>
    (function(){
      var CURRENT = "${v}";
      function check(){
        fetch("/version.json?_="+Date.now(),{cache:"no-store"})
          .then(function(r){return r.json();})
          .then(function(d){
            if(String(d.v) !== String(CURRENT)){
              var busy=false;
              try{busy=sessionStorage.getItem("th_critical_ui_state_v1")==="1";}catch(e){}
              try{
                var draft=JSON.parse(localStorage.getItem("th_pos_draft")||"null");
                busy=busy||(draft&&Array.isArray(draft.carrito)&&draft.carrito.length>0);
              }catch(e){}
              if(busy){
                console.log("[TH] Actualización pendiente — se aplicará al terminar la operación activa");
                return;
              }
              console.log("[TH] Nueva versión "+d.v+" → recargando");
              window.location.reload(true);
            }
          }).catch(function(){});
      }
      setTimeout(check, 2000);
      setInterval(check, 60000);
    })();
  </script>
  <!-- jsPDF: generación de notas de venta en PDF nativo (ligero, nítido) -->
  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>
  <script src="bundle-${v}.js"></script>
  <!-- Service worker: permite instalar la app y seguir usándola sin internet -->
  <script>
    if("serviceWorker" in navigator){
      window.addEventListener("load", function(){
        navigator.serviceWorker.register("sw.js").catch(function(){});
      });
    }
  </script>
</body>
</html>`;

fs.writeFileSync("index.html", html);

// ── Version manifest (para auto-update del PWA) ───────────────────────────────
fs.writeFileSync("version.json", JSON.stringify({ v, ts: new Date().toISOString() }));

console.log("Build OK — v" + v);
