const esbuild = require("esbuild");
const fs = require("fs");

// Crear main.jsx
let app = fs.readFileSync("App.jsx", "utf8");
app = app.replace(/^import .+\n/gm, "");
const main = `import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
${app}
const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
`;
fs.writeFileSync("main.jsx", main);

// Compilar
esbuild.buildSync({
  entryPoints: ["main.jsx"],
  bundle: true,
  outfile: "bundle.js",
  loader: { ".jsx": "jsx" },
  jsx: "transform",
  platform: "browser",
  target: "es2020",
});

// Cache-busting: inyectar timestamp en index.html para forzar recarga del bundle
const v = Date.now();
const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Toscana House</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>* { margin:0; padding:0; box-sizing:border-box; } body { background:#FAF9F7; }</style>
</head>
<body>
  <div id="root"></div>
  <script src="bundle.js?v=${v}"></script>
</body>
</html>`;
fs.writeFileSync("index.html", html);

console.log("Build OK");
