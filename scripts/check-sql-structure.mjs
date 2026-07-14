import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const migrationsDir = path.join(root, "supabase", "migrations");
const files = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

let failed = false;
for (const name of files) {
  const file = path.join(migrationsDir, name);
  const sql = fs.readFileSync(file, "utf8");
  const tags = [...sql.matchAll(/\$[A-Za-z_0-9]*\$/g)].map((match) => match[0]);
  const tagCounts = new Map();
  for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  const oddTags = [...tagCounts.entries()].filter(([, count]) => count % 2 !== 0);
  const hasBegin = /(^|\n)\s*begin\s*;/i.test(sql);
  const hasTerminalTransaction = /(^|\n)\s*(commit|rollback)\s*;/i.test(sql);
  const bad = [];
  if (oddTags.length) bad.push(`dollar quotes desbalanceadas: ${oddTags.map(([tag]) => tag).join(", ")}`);
  if (!hasBegin || !hasTerminalTransaction) bad.push("falta BEGIN y cierre COMMIT/ROLLBACK explícito");
  if (bad.length) {
    failed = true;
    console.error(`FAIL ${name}: ${bad.join("; ")}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

if (!files.length) {
  console.error("FAIL no se encontraron migraciones SQL");
  process.exit(1);
}
if (failed) process.exit(1);
console.log(`SQL structure OK (${files.length} migrations)`);
