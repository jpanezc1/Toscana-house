import fs from "node:fs";
import esbuild from "esbuild";

let app=fs.readFileSync("App.jsx","utf8");
app=app.replace(/^import .+\n/gm,"");
const source=`
import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import * as __XLSXBundled from "xlsx";
if (typeof window !== "undefined") window.__XLSXBundled = __XLSXBundled;
${app}
const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
`;

await esbuild.build({
  stdin:{contents:source,loader:"jsx",resolveDir:process.cwd(),sourcefile:"main-check.jsx"},
  bundle:true,write:false,platform:"browser",target:"es2020",jsx:"transform",logLevel:"warning",
});
console.log("App build check OK");
