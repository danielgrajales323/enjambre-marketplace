// Corre todas las pruebas del kit (sin red, sin modelo). Sale con 1 si alguna falla.
//
//   node tests/run-all.mjs

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const SUITES = ["test-guardias.mjs", "test-init.mjs", "test-plantillas.mjs", "test-proceso.mjs"];

let fallidas = 0;
let totalOk = 0;
let totalMal = 0;
for (const s of SUITES) {
  const r = spawnSync(process.execPath, [join(AQUI, s)], { encoding: "utf8" });
  const salida = `${r.stdout}${r.stderr}`;
  const m = /(\d+) pruebas OK, (\d+) fallidas/.exec(salida);
  const ok = r.status === 0 && m && Number(m[2]) === 0;
  if (!ok) fallidas++;
  if (m) { totalOk += Number(m[1]); totalMal += Number(m[2]); }
  console.log(`${ok ? "OK " : "MAL"}  ${s}${m ? `  (${m[1]} OK, ${m[2]} fallidas)` : `  (sin resumen; exit ${r.status})`}`);
  if (!ok) console.log(salida.split("\n").filter((l) => /✗|Error|error/.test(l)).slice(0, 30).map((l) => `      ${l}`).join("\n"));
}
console.log(`\n${SUITES.length} suites, ${SUITES.length - fallidas} OK, ${totalOk} aserciones OK, ${totalMal} fallidas`);
process.exit(fallidas ? 1 : 0);
