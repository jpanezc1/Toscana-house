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

console.log("Build OK");
