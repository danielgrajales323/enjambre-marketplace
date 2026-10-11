// LAS GUARDIAS DEL PLUGIN: JSON por stdin y código de salida, y la decisión pura. Sin red.
//
//   node tests/test-guardias.mjs
//
// Lo que fija, y cómo se invirtió cada sección (sacando el arreglo, ROJO; restaurándolo, VERDE):
//   1. PROYECTO SIN `.enjambre/` → ninguna guardia actúa (exit 0, sin salida). Invertida: en
//      comun.mjs, `if (!raiz) process.exit(0)` quitado → las guardias niegan en un proyecto ajeno.
//   2. CONFIG ROTA → toda guardia BLOQUEA (deny con el motivo). Invertida: `cargarConfig` sin
//      validar → una config con una clave de más pasa.
//   3. prod: host prohibido, host fuera de la lista, comando destructivo → deny; local → pasa.
//      Invertida: sin el chequeo de `hostsPermitidos` → el host de producción pasa.
//   4. reservado: Read/Grep/cat/node -e sobre la carpeta → deny; Write, git add y el lector
//      autorizado → pasan. Invertida: sin la rama de Read → leerlo pasa.
//   5. mapa: código sin consulta reciente → deny; con consulta reciente, documentos, pruebas y git
//      diff → pasan; `herramienta: null` apaga la guardia. Invertida: `reciente` siempre true.
//   6. gasto: script que gasta con el libro roto, al tope, o pasado el aviso sin bandera → deny;
//      con bandera o debajo del aviso → pasa; un script que no gasta → pasa.
//      Invertida: sin el chequeo del aviso → arranca pasado el aviso.
//   7. escrituras: Edit/Write de un protegido, Read de un secreto, `>` a un protegido → deny;
//      Read de un protegido → pasa. Invertida: sin `esProtegido` en Edit → pasa.
//   8. La respuesta de un deny tiene la forma exacta que lee Claude Code (hookSpecificOutput).
//
// Ronda del auditor sobre d75afbd (todo con su inversión):
//   · §2: `.enjambre/` sin `config.json` → deny en las cinco (borrar la config no apaga las guardias).
//     Invertida: `ubicarRaiz` buscando el archivo en vez de la carpeta → pasa todo.
//   · §3: hosts sin esquema (`-h`, `host:puerto`, wget, Invoke-WebRequest) y `rm --recursive --force`.
//     Invertida: `hostsDe` sólo con URLs → el psql a producción pasa.
//   · §4: Grep en un ancestro, `grep -r`, `rg`, `git grep`, `git log -p`, `git show`, `git diff` sin ruta,
//     globs y mayúsculas. Invertida: sin `lectorRecursivo` → `git diff` pasa.
//   · §5: mayúsculas en Windows. Invertida: `esRutaDeCodigo` sin `toLowerCase` → `SRC/A.TS` pasa.
//   · §7: rm/git rm/mv de un protegido, `>file` sin espacio, Grep/Glob/cat/node -e sobre `.env`.
//     Invertida: sin `nombraSecreto` → `node -e` que lee `.env` pasa.

import { mkdirSync, writeFileSync } from "node:fs";
// (mkdirSync y writeFileSync también arman el escenario existente que se edita en §7)
import { join } from "node:path";
import { configDePlantilla, correrGuardia, crearChequeo, proyectoTemporal } from "./_arnes.mjs";
import { esComandoDeRecuperacion, problemasDeConfig, tokens, ubicarRaiz } from "../scripts/lib/comun.mjs";
import { decidir as decidirProd } from "../scripts/guard-prod.mjs";
import { decidir as decidirReservado } from "../scripts/guard-reservado.mjs";
import { decidirMapa } from "../scripts/guard-mapa.mjs";
import { decidir as decidirGasto } from "../scripts/guard-gasto.mjs";
import { decidir as decidirEscrituras } from "../scripts/guard-escrituras.mjs";

const { check, cerrar } = crearChequeo();
const GUARDIAS = ["guard-prod.mjs", "guard-reservado.mjs", "guard-mapa.mjs", "guard-gasto.mjs", "guard-escrituras.mjs"];
const argsDe = (g) => (g === "guard-mapa.mjs" ? ["pre"] : []);
const B = (command) => ({ tool_name: "Bash", tool_input: { command }, session_id: "s1" });
const R = (file_path) => ({ tool_name: "Read", tool_input: { file_path }, session_id: "s1" });
const ev = (tool_name, tool_input) => ({ tool_name, tool_input, session_id: "s1" });

console.log("1. Un proyecto sin .enjambre/: ninguna guardia actúa (invertida: sin el `if (!raiz) exit 0`, ROJO)");
{
  const sin = proyectoTemporal({ config: null });
  for (const g of GUARDIAS) {
    const r = correrGuardia(g, B("curl https://produccion.example.com/api && git push --force"), { proyecto: sin, args: argsDe(g) });
    check(`${g}: exit 0 y sin salida`, [r.codigo, r.stdout.trim()], [0, ""]);
  }
  check("ubicarRaiz sube hasta encontrar .enjambre/ y devuelve null si no hay", [ubicarRaiz(join(sin, "a", "b")), ubicarRaiz(join(proyectoTemporal(), "src", "x"))?.length > 0], [null, true]);
}

console.log("\n2. Una configuración rota BLOQUEA todo (invertida: sin validar, ROJO)");
{
  const roto = proyectoTemporal({ config: "{ esto no es json" });
  for (const g of GUARDIAS) {
    const r = correrGuardia(g, B("echo hola"), { proyecto: roto, args: argsDe(g) });
    check(`${g}: JSON inválido → deny`, [r.codigo, r.decision], [0, "deny"]);
  }
  const deMas = configDePlantilla();
  deMas.topeExtra = 1000;
  const conClave = proyectoTemporal({ config: deMas });
  const r = correrGuardia("guard-prod.mjs", B("echo hola"), { proyecto: conClave });
  check("una clave de más en la raíz → deny (estricta)", r.decision, "deny");
  check("…y el motivo la nombra", /clave desconocida en la raíz: topeExtra/.test(r.stdout), true);
  const sinGasto = configDePlantilla();
  delete sinGasto.gasto;
  check("problemasDeConfig: sin `gasto`", problemasDeConfig(sinGasto), ["gasto: falta"]);
  const avisoAlto = configDePlantilla();
  avisoAlto.gasto.avisoUsd = 50;
  check("problemasDeConfig: aviso mayor que el tope", problemasDeConfig(avisoAlto), ["gasto.avisoUsd no puede superar gasto.topeUsd"]);
  const rxMala = configDePlantilla();
  rxMala.comandosProhibidos = ["("];
  check("problemasDeConfig: una regex inválida", problemasDeConfig(rxMala), ["comandosProhibidos: regex inválida: ("]);
  check("la configuración de plantilla es válida", problemasDeConfig(configDePlantilla()), []);
  const sinFirma = configDePlantilla();
  sinFirma.seguridad.autorizacionDelDuenio = { alcance: "staging" };
  check("autorizacionDelDuenio exige firmante y fecha", problemasDeConfig(sinFirma).length, 2);
  const conFirma = configDePlantilla();
  conFirma.seguridad.autorizacionDelDuenio = { firmante: "La dueña", fecha: "2026-10-10", alcance: "staging" };
  check("…con firmante y fecha, válida", problemasDeConfig(conFirma), []);
  // BORRAR config.json NO apaga las guardias (hallazgo del auditor): la carpeta .enjambre/ existe y falta el archivo → deny.
  const borrada = proyectoTemporal({ config: null });
  mkdirSync(join(borrada, ".enjambre"), { recursive: true });
  for (const g of GUARDIAS) {
    const r = correrGuardia(g, B("echo hola"), { proyecto: borrada, args: argsDe(g) });
    check(`${g}: .enjambre/ sin config.json → deny`, [r.codigo, r.decision], [0, "deny"]);
  }
  const rb = correrGuardia("guard-prod.mjs", B("echo hola"), { proyecto: borrada });
  check("…y el motivo dice cómo restaurarla (/enjambre:init o git checkout)", /enjambre:init/.test(rb.stdout) && /git checkout/.test(rb.stdout), true);
  check("ubicarRaiz encuentra la carpeta aunque falte el archivo", ubicarRaiz(join(borrada, "src")), borrada);
  // Sin config.json pasan EXACTAMENTE los dos comandos de recuperación, y nada parecido.
  check("recuperación: git checkout -- .enjambre/config.json pasa", correrGuardia("guard-escrituras.mjs", B("git checkout -- .enjambre/config.json"), { proyecto: borrada }).decision, null);
  check("recuperación: node <plugin>/scripts/init.mjs --dry-run pasa (sin CLAUDE_PLUGIN_ROOT: cualquier scripts/init.mjs)", correrGuardia("guard-prod.mjs", B("node C:/x/plugins/enjambre/scripts/init.mjs --dry-run"), { proyecto: borrada }).decision, null);
  // Con CLAUDE_PLUGIN_ROOT (los hooks lo reciben): SÓLO el init.mjs de ESE plugin, y con comillas si la ruta tiene espacios.
  const raizPlugin = "C:/Program Files/con espacios/enjambre";
  check("recuperación con CLAUDE_PLUGIN_ROOT y ruta con espacios entre comillas: pasa", esComandoDeRecuperacion(B(`node "${raizPlugin}/scripts/init.mjs" --dry-run`), { CLAUDE_PLUGIN_ROOT: raizPlugin }), true);
  check("…otro init.mjs (de otro plugin o del proyecto) NO pasa con CLAUDE_PLUGIN_ROOT", [esComandoDeRecuperacion(B("node C:/otro/scripts/init.mjs"), { CLAUDE_PLUGIN_ROOT: raizPlugin }), esComandoDeRecuperacion(B("node scripts/init.mjs"), { CLAUDE_PLUGIN_ROOT: raizPlugin })], [false, false]);
  check("tokens respeta las comillas", [tokens(`node "C:/con espacios/init.mjs" --x 'a b'`), tokens(`cat ".enjambre/reservado/x y.json"`)], [["node", "C:/con espacios/init.mjs", "--x", "a b"], ["cat", ".enjambre/reservado/x y.json"]]);
  check("…pero no con otro comando encadenado, ni otro archivo, ni node -e", [
    correrGuardia("guard-prod.mjs", B("git checkout -- .enjambre/config.json && rm -r src"), { proyecto: borrada }).decision,
    correrGuardia("guard-prod.mjs", B("git checkout -- src/a.ts"), { proyecto: borrada }).decision,
    correrGuardia("guard-prod.mjs", B("node -e \"require('fs').writeFileSync('.enjambre/config.json','{}')\""), { proyecto: borrada }).decision,
  ], ["deny", "deny", "deny"]);
  // Una `.enjambre/` por encima de la raíz del repo git no activa las guardias (opcional del auditor).
  const arriba = proyectoTemporal();
  mkdirSync(join(arriba, "repo", ".git"), { recursive: true });
  check("ubicarRaiz no sube más allá de la raíz del repo git", ubicarRaiz(join(arriba, "repo", "src")), null);
}

console.log("\n3. prod: nunca producción, nunca destructivo (invertida: sin hostsPermitidos, ROJO)");
{
  const cfg = configDePlantilla();
  cfg.red.hostsProhibidos = ["api.produccion.example"];
  const d = (cmd) => decidirProd(B(cmd), cfg) ? "deny" : null;
  check("host prohibido", d("curl https://api.produccion.example/v1"), "deny");
  check("host fuera de la lista permitida", d('curl "https://abc.nube.example/rest/v1/x"'), "deny");
  check("subdominio de un comodín permitido", d("curl http://app.localhost:3000/ping"), null);
  check("localhost con puerto", d("curl http://localhost:54321/rest/v1/x"), null);
  check("127.0.0.1", d("curl http://127.0.0.1:8000/"), null);
  check("sin URL: pasa", d("node scripts/test-x.mjs"), null);
  check("force-push", d("git push origin master --force"), "deny");
  check("push +rama", d("git push origin +master"), "deny");
  check("reset --hard", d("git reset --hard HEAD~1"), "deny");
  check("rm -rf", d("rm -rf build"), "deny");
  check("rm --recursive --force, rm -r --force, rm --force -r", [d("rm --recursive --force build"), d("rm -r --force build"), d("rm --force -r build")], ["deny", "deny", "deny"]);
  check("rm de un archivo (sin recursivo): pasa", d("rm build/x.txt"), null);
  check("Remove-Item -Recurse (PowerShell)", decidirProd({ tool_name: "PowerShell", tool_input: { command: "Remove-Item .\\x -Recurse -Force" } }, cfg) ? "deny" : null, "deny");
  // Hosts SIN esquema (hallazgo del auditor).
  check("psql -h host de producción", d("psql -h api.produccion.example -U x -c 'select 1'"), "deny");
  check("--host=host prohibido", d("mysql --host=api.produccion.example -e 'x'"), "deny");
  check("host:puerto fuera de la lista", d("nc db.ejemplo.test 5432 && curl abc.nube.example:443/rest"), "deny");
  check("wget host sin esquema fuera de la lista", d("wget abc.nube.example/archivo"), "deny");
  check("Invoke-WebRequest host sin esquema (PowerShell)", decidirProd({ tool_name: "PowerShell", tool_input: { command: "Invoke-WebRequest api.produccion.example/x" } }, cfg) ? "deny" : null, "deny");
  check("curl -X POST -d x host (el host no es el primer argumento)", d("curl -X POST -d x api.produccion.example/v1"), "deny");
  check("psql con cadena de conexión host=…", d('psql "host=api.produccion.example dbname=app user=x"'), "deny");
  check("ssh user@host y scp user@host:ruta", [d("ssh deploy@api.produccion.example"), d("scp x.txt deploy@api.produccion.example:/tmp/")], ["deny", "deny"]);
  check("ssh a un host permitido: pasa", d("ssh yo@app.localhost"), null);
  check("curl localhost:3000 sin esquema: pasa", d("curl localhost:3000/ping"), null);
  check("un archivo con punto no es un host (node scripts/x.mjs, tar.gz, versión 1.2.3)", [d("node scripts/x.mjs"), d("wget archivo.tar.gz"), d("npm install x@1.2.3")], [null, null, null]);
  check("deploy suelto", d("supabase functions deploy x"), "deny");
  check("DROP TABLE", d("psql -c 'DROP TABLE clientes'"), "deny");
  check("push normal", d("git push origin kit"), null);
  check("WebFetch a producción", decidirProd(ev("WebFetch", { url: "https://api.produccion.example/x" }), cfg) ? "deny" : null, "deny");
  check("otra herramienta: no opina", decidirProd(R("/x/y.ts"), cfg), null);
  const sinLista = configDePlantilla();
  sinLista.red.hostsPermitidos = [];
  check("con hostsPermitidos vacía sólo cuentan los prohibidos", decidirProd(B("curl https://cualquiera.example/"), sinLista), null);
  // Integración: el proceso real responde deny con el motivo.
  const p = proyectoTemporal({ config: cfg });
  const r = correrGuardia("guard-prod.mjs", B("curl https://api.produccion.example/v1"), { proyecto: p });
  check("proceso real: deny con motivo que nombra el host", [r.codigo, r.decision, /api.produccion.example/.test(r.stdout)], [0, "deny", true]);
}

console.log("\n4. reservado: ilegible por cualquier vía (invertida: sin la rama de Read, ROJO)");
{
  const cfg = configDePlantilla();
  const raiz = proyectoTemporal({ config: cfg });
  const d = (e) => (decidirReservado(e, cfg, raiz) ? "deny" : null);
  const res = join(raiz, ".enjambre", "reservado", "casos.json.gz");
  check("Read", d(R(res)), "deny");
  check("Edit", d(ev("Edit", { file_path: res, old_string: "a", new_string: "b" })), "deny");
  check("Write (el corte, una vez): no opina", d(ev("Write", { file_path: res, content: "x" })), null);
  check("Grep con ruta adentro", d(ev("Grep", { pattern: "x", path: join(raiz, ".enjambre", "reservado") })), "deny");
  check("Grep sin ruta (barre todo)", d(ev("Grep", { pattern: "x" })), "deny");
  check("Grep sin ruta sólo en .md: pasa", d(ev("Grep", { pattern: "x", glob: "*.md" })), null);
  check("Grep en src/: pasa", d(ev("Grep", { pattern: "x", path: join(raiz, "src") })), null);
  check("Glob que nombra la carpeta", d(ev("Glob", { pattern: ".enjambre/reservado/**" })), "deny");
  check("cat", d(B("cat .enjambre/reservado/semillas.json")), "deny");
  check("zcat con ruta absoluta", d(B(`zcat "${res}"`)), "deny");
  check("node -e que la lee", d(B(`node -e "require('fs').readFileSync('.enjambre/reservado/x')"`)), "deny");
  check("git show", d(B("git show HEAD:.enjambre/reservado/semillas.json")), "deny");
  check("Get-Content (PowerShell)", d({ tool_name: "PowerShell", tool_input: { command: "Get-Content .enjambre\\reservado\\semillas.json" } }), "deny");
  check("git add: pasa", d(B("git add .enjambre/reservado/semillas.json")), null);
  check("git commit nombrándola: pasa", d(B("git commit -m 'corte' -- .enjambre/reservado")), null);
  check("el lector autorizado: pasa", d(B("node .enjambre/corrida-final.mjs --corrida-final")), null);
  check("un script NO autorizado que la nombra: deny", d(B("node scripts/x.mjs .enjambre/reservado/a")), "deny");
  check("un script NO autorizado dentro de la carpeta: deny", d(B("node .enjambre/reservado/leer.mjs")), "deny");
  check("un comando sin la carpeta: pasa", d(B("node scripts/test.mjs")), null);
  // Los casos del auditor sobre d75afbd: ancestros, lectores recursivos, globs y mayúsculas.
  check("Grep con path en la raíz, en `.` y en .enjambre (ancestros): deny", [d(ev("Grep", { pattern: "x", path: raiz })), d(ev("Grep", { pattern: "x", path: "." })), d(ev("Grep", { pattern: "x", path: join(raiz, ".enjambre") }))], ["deny", "deny", "deny"]);
  check("Grep en un ancestro pero sólo .md/.txt: pasa", [d(ev("Grep", { pattern: "x", path: raiz, glob: "*.md" })), d(ev("Grep", { pattern: "x", path: raiz, type: "txt" }))], [null, null]);
  check("Grep en .enjambre/lib (hermano, no ancestro): pasa", d(ev("Grep", { pattern: "x", path: join(raiz, ".enjambre", "lib") })), null);
  check("Glob recursivo desde la raíz: deny; de docs: pasa", [d(ev("Glob", { pattern: "**/*.json.gz" })), d(ev("Glob", { pattern: "docs/**/*.md" }))], ["deny", null]);
  check("grep -r sin ruta, con `.`, con la raíz: deny", [d(B("grep -rn casos")), d(B("grep -rn casos .")), d(B(`grep -rn casos "${raiz}"`))], ["deny", "deny", "deny"]);
  check("grep -r en src/: pasa", d(B("grep -rn casos src/")), null);
  check("rg sin ruta: deny; rg src: pasa", [d(B("rg casos")), d(B("rg casos src"))], ["deny", null]);
  check("git grep sin ruta: deny; con `-- src`: pasa; con `-- .enjambre`: deny", [d(B('git grep -n "x"')), d(B('git grep -n "x" -- src')), d(B('git grep -n "x" -- .enjambre'))], ["deny", null, "deny"]);
  check("git log -p sin ruta: deny; git log -p -- src: pasa; git log --oneline: pasa", [d(B("git log -p -3")), d(B("git log -p -- src/a.ts")), d(B("git log --oneline -3"))], ["deny", null, null]);
  check("git -C . log -p, git --no-pager log -p, git format-patch --stdout: deny", [d(B("git -C . log -p -3")), d(B("git --no-pager log -p -3")), d(B("git format-patch --stdout HEAD~2"))], ["deny", "deny", "deny"]);
  check("git show sin ruta: deny; git show HEAD -- src/a.ts: pasa", [d(B("git show HEAD")), d(B("git show HEAD -- src/a.ts"))], ["deny", null]);
  check("git diff sin ruta: deny; con pathspec que excluye el reservado: pasa; con ruta fuera: pasa", [d(B("git diff")), d(B("git diff -- . ':!.enjambre/reservado'")), d(B("git diff abc def -- src/a.ts"))], ["deny", null, null]);
  check("cat con glob que alcanza la carpeta: deny", [d(B("cat .enjambre/res*/semillas.json")), d(B("cat .enjambre/reservado/*")), d(B("cat .ENJAMBRE\\RESERVADO\\x"))], ["deny", "deny", "deny"]);
  check("find … -exec cat desde la raíz: deny; tar de todo: deny", [d(B("find . -name '*.gz' -exec zcat {} \\;")), d(B("tar czf todo.tgz ."))], ["deny", "deny"]);
  check("un .enjambre/reservado2 (otra carpeta) no es el reservado", d(B("cat .enjambre/reservado2/x")), null);
  // Proceso real.
  const r = correrGuardia("guard-reservado.mjs", R(res), { proyecto: raiz });
  check("proceso real: Read del reservado → deny", [r.codigo, r.decision], [0, "deny"]);
}

console.log("\n5. mapa: el mapa antes del código (invertida: `reciente` siempre true, ROJO)");
{
  const cfg = configDePlantilla();
  const raiz = proyectoTemporal({ config: cfg });
  const AHORA = 1_800_000_000_000;
  const SIN = undefined;
  const RECIENTE = AHORA - 60_000;
  const VIEJO = AHORA - cfg.mapa.ventanaMinutos * 60_000 - 1;
  const d = (e, ultimo) => (decidirMapa(e, cfg, raiz, ultimo, AHORA) ? "deny" : null);
  check("Read de código sin consulta", d(R(join(raiz, "src", "a.ts")), SIN), "deny");
  check("Read de código con MAYÚSCULAS (Windows): deny igual", d(R(join(raiz, "SRC", "A.TS")), SIN), "deny");
  check("Read de código con consulta vieja", d(R(join(raiz, "scripts", "x.mjs")), VIEJO), "deny");
  check("Read de código con consulta reciente", d(R(join(raiz, "src", "a.ts")), RECIENTE), null);
  check("Read de un documento: pasa", d(R(join(raiz, "docs", "x.md")), SIN), null);
  check("Read de un .json de src: pasa (no es código por extensión)", d(R(join(raiz, "src", "datos.json")), SIN), null);
  check("Read fuera del repo: pasa", d(R("/tmp/otro/x.ts"), SIN), null);
  check("Grep sin ruta: deny", d(ev("Grep", { pattern: "x" }), SIN), "deny");
  check("Grep sin ruta sólo md: pasa", d(ev("Grep", { pattern: "x", glob: "*.md" }), SIN), null);
  check("Grep en la raíz del repo: deny", d(ev("Grep", { pattern: "x", path: raiz }), SIN), "deny");
  check("Grep en src/: deny", d(ev("Grep", { pattern: "x", path: join(raiz, "src") }), SIN), "deny");
  check("Grep en docs/: pasa", d(ev("Grep", { pattern: "x", path: join(raiz, "docs") }), SIN), null);
  check("Glob de *.ts: deny", d(ev("Glob", { pattern: "src/**/*.ts" }), SIN), "deny");
  check("Glob de *.md: pasa", d(ev("Glob", { pattern: "docs/**/*.md" }), SIN), null);
  check("grep en bash sobre código: deny", d(B("grep -rn paused src/"), SIN), "deny");
  check("sed -n sobre código: deny", d(B("sed -n 1,20p scripts/x.mjs"), SIN), "deny");
  check("git grep sin ruta: deny", d(B('git grep -n "x"'), SIN), "deny");
  check("correr una prueba: pasa", d(B("node scripts/test-x.mjs"), SIN), null);
  check("git diff de código: pasa", d(B("git diff abc def -- src/a.ts"), SIN), null);
  check("grep sobre la salida de un comando: pasa", d(B("node scripts/x.mjs 2>&1 | grep OK"), SIN), null);
  check("correr graphify siempre pasa", d(B('graphify query "x"'), SIN), null);
  check("Edit: no opina", d(ev("Edit", { file_path: join(raiz, "src", "a.ts") }), SIN), null);
  const otra = configDePlantilla();
  otra.mapa.herramienta = "mimapa";
  otra.mapa.subcomandos = ["buscar"];
  check("otra herramienta configurada: su comando pasa y el motivo la nombra", [
    decidirMapa(B('mimapa buscar "x"'), otra, raiz, SIN, AHORA),
    /mimapa buscar/.test(decidirMapa(R(join(raiz, "src", "a.ts")), otra, raiz, SIN, AHORA)?.motivo ?? ""),
  ], [null, true]);
  const apagada = configDePlantilla();
  apagada.mapa.herramienta = null;
  check("herramienta null: la guardia no opina", decidirMapa(R(join(raiz, "src", "a.ts")), apagada, raiz, SIN, AHORA), null);
  // Proceso real: pre niega; post anota; pre deja pasar.
  const sesion = `prueba-${process.pid}-${Date.now()}`;
  const evR = { ...R(join(raiz, "src", "a.ts")), session_id: sesion };
  check("proceso real: pre sin consulta → deny", correrGuardia("guard-mapa.mjs", evR, { proyecto: raiz, args: ["pre"] }).decision, "deny");
  const post = correrGuardia("guard-mapa.mjs", { ...B('graphify query "x"'), session_id: sesion }, { proyecto: raiz, args: ["post"] });
  check("proceso real: post anota y no dice nada", [post.codigo, post.stdout.trim()], [0, ""]);
  check("proceso real: pre después del post → pasa", correrGuardia("guard-mapa.mjs", evR, { proyecto: raiz, args: ["pre"] }).decision, null);
}

console.log("\n6. gasto: el tope antes de correr lo que gasta (invertida: sin el chequeo del aviso, ROJO)");
{
  const cfg = configDePlantilla();
  const raiz = proyectoTemporal({ config: cfg });
  const con = (acumulado) => () => acumulado;
  const roto = () => { throw new Error("libro roto"); };
  const d = (cmd, leer) => (decidirGasto(B(cmd), cfg, raiz, leer) ? "deny" : null);
  check("un script que no gasta: no mira el libro", d("node scripts/test-x.mjs", roto), null);
  check("un script que gasta, libro roto: deny", d("node .enjambre/ciclo.mjs", roto), "deny");
  check("debajo del aviso: pasa", d("node .enjambre/ciclo.mjs", con(10)), null);
  check("pasado el aviso sin bandera: deny", d("node .enjambre/ciclo.mjs", con(21)), "deny");
  check("pasado el aviso con la bandera: pasa", d("node .enjambre/ciclo.mjs --sigue-despues-del-aviso", con(21)), null);
  check("al tope, aun con bandera: deny", d("node .enjambre/ciclo.mjs --sigue-despues-del-aviso", con(30)), "deny");
  check("con tsx y ruta absoluta", d(`npx tsx "${join(raiz, ".enjambre", "corrida-final.ts")}" --corrida-final`, con(30)), "deny");
  check("en una cadena con &&", d("cd x && node .enjambre/medir.mjs", con(25)), "deny");
  // Proceso real, con un libro de verdad: sin canónico → deny (falla cerrado).
  mkdirSync(join(raiz, ".enjambre"), { recursive: true });
  writeFileSync(join(raiz, ".enjambre", "gastos.json"), JSON.stringify({ corridas: [] }));
  const r = correrGuardia("guard-gasto.mjs", B("node .enjambre/ciclo.mjs"), { proyecto: raiz });
  check("proceso real: sin libro canónico (no es un repo git) → deny", [r.codigo, r.decision], [0, "deny"]);
}

console.log("\n7. escrituras: protegidos y secretos (invertida: sin esProtegido en Edit, ROJO)");
{
  const cfg = configDePlantilla();
  const raiz = proyectoTemporal({ config: cfg });
  const d = (e) => (decidirEscrituras(e, cfg, raiz) ? "deny" : null);
  check("Edit de config.json", d(ev("Edit", { file_path: join(raiz, ".enjambre", "config.json") })), "deny");
  check("Write de gastos.json", d(ev("Write", { file_path: join(raiz, ".enjambre", "gastos.json") })), "deny");
  check("Edit de .claude/settings.json", d(ev("Edit", { file_path: join(raiz, ".claude", "settings.json") })), "deny");
  check("Read de config.json: pasa", d(R(join(raiz, ".enjambre", "config.json"))), null);
  check("Read de .env: deny", d(R(join(raiz, ".env"))), "deny");
  check("Read de .env.local: deny", d(R(join(raiz, ".env.local"))), "deny");
  check("Write de .env: deny", d(ev("Write", { file_path: join(raiz, ".env") })), "deny");
  check("Read de .environment.md: pasa", d(R(join(raiz, "docs", ".environment.md"))), null);
  check("cat .env", d(B("cat .env")), "deny");
  check("source .env", d(B("source .env && node x")), "deny");
  check("> a gastos.json", d(B("echo '{}' > .enjambre/gastos.json")), "deny");
  check("sed -i sobre config.json", d(B("sed -i 's/30/300/' .enjambre/config.json")), "deny");
  check("Set-Content a settings (PowerShell)", d({ tool_name: "PowerShell", tool_input: { command: "Set-Content .claude\\settings.json '{}'" } }), "deny");
  check("cat de config.json: pasa (leer sí)", d(B("cat .enjambre/config.json")), null);
  check("un comando cualquiera: pasa", d(B("node scripts/x.mjs > salida.txt")), null);
  // Los casos del auditor sobre d75afbd.
  check("rm, git rm, mv de config.json por la shell: deny", [d(B("rm .enjambre/config.json")), d(B("git rm .enjambre/config.json")), d(B("mv .enjambre/config.json x.json")), d(B("rm -f .ENJAMBRE/CONFIG.JSON"))], ["deny", "deny", "deny", "deny"]);
  check("Remove-Item de la config (PowerShell): deny", d({ tool_name: "PowerShell", tool_input: { command: "Remove-Item .enjambre\\config.json" } }), "deny");
  check("redirección SIN espacio a un protegido y a un secreto: deny", [d(B("echo x >.enjambre/gastos.json")), d(B("echo KEY=1 >>.env"))], ["deny", "deny"]);
  check("Grep sobre .env (path) y glob .env*: deny", [d(ev("Grep", { pattern: "KEY", path: join(raiz, ".env") })), d(ev("Grep", { pattern: "KEY", glob: ".env*" }))], ["deny", "deny"]);
  check("Glob de .env*: deny", d(ev("Glob", { pattern: "**/.env*" })), "deny");
  check("cat .env* y cat .env.local: deny", [d(B("cat .env*")), d(B("cat .env.local"))], ["deny", "deny"]);
  check("node -e que lee .env: deny", d(B(`node -e "console.log(require('fs').readFileSync('.env','utf8'))"`)), "deny");
  check("python -c que lee .env: deny", d(B(`python -c "print(open('.env').read())"`)), "deny");
  check("ls -la (nombra .env sin leerlo): pasa", d(B("ls -la .env")), null);
  check("--env-file=.env (node) y --env-file .env (docker): deny", [d(B("node --env-file=.env scripts/x.mjs")), d(B("docker run --env-file .env imagen"))], ["deny", "deny"]);
  // LA CARPETA .enjambre/ MISMA (hallazgo del auditor sobre c858f02): los seis comandos, más mover y renombrar.
  check("rm -r .enjambre / rm -r .ENJAMBRE / mv .enjambre /tmp/e / git rm -r .enjambre: deny", [d(B("rm -r .enjambre")), d(B("rm -r .ENJAMBRE")), d(B("mv .enjambre /tmp/e")), d(B("git rm -r .enjambre"))], ["deny", "deny", "deny", "deny"]);
  check("Rename-Item .enjambre x (PowerShell), find .enjambre -delete, node -e rmSync: deny", [
    d({ tool_name: "PowerShell", tool_input: { command: "Rename-Item .enjambre x" } }),
    d(B("find .enjambre -delete")),
    d(B(`node -e "require('fs').rmSync('.enjambre',{recursive:true})"`)),
  ], ["deny", "deny", "deny"]);
  check("rmdir .\\.enjambre, git mv .enjambre otra, python shutil.rmtree('.enjambre'): deny", [d(B("rmdir /s .\\.enjambre")), d(B("git mv .enjambre otra")), d(B(`python -c "import shutil; shutil.rmtree('.enjambre')"`))], ["deny", "deny", "deny"]);
  check("ls .enjambre, cat .enjambre/lib/util.mjs, rm .enjambre2, rm .enjambre/trabajo/x.json (no es protegido): pasan", [d(B("ls .enjambre")), d(B("cat .enjambre/lib/util.mjs")), d(B("rm -r .enjambre2")), d(B("rm .enjambre/trabajo/x.json"))], [null, null, null, null]);
  check("rm y git rm de .claude/settings.json (protegido fuera de .enjambre): deny", [d(B("rm .claude/settings.json")), d(B("git rm .claude/settings.json"))], ["deny", "deny"]);
  // LA RED DETERMINISTA DE SEGURIDAD (auditoría final sobre b017b6e): sin autorización del dueño, un
  // escenario de autorizacion/aislamiento/rls no se ESCRIBE. El prompt lo dice; esto lo hace cumplir.
  const esc = (categoria, extra = {}) => ev("Write", { file_path: join(raiz, ".enjambre", "trabajo", "escenarios", "esc-1-7.json"), content: JSON.stringify({ id: "esc-1-7", funcion: "a#b", oraculo: { tipo: "diferencial", regla: "x" }, categoria, ...extra }) });
  check("sin autorización: autorizacion / aislamiento / rls → deny", [d(esc("autorizacion")), d(esc("aislamiento")), d(esc("RLS"))], ["deny", "deny", "deny"]);
  check("sin autorización: funcional y contrato → pasan", [d(esc("funcional")), d(esc("contrato"))], [null, null]);
  check("un escenario sin categoría o que no es JSON: deny (falla cerrada)", [d(esc("")), d(ev("Write", { file_path: join(raiz, ".enjambre", "trabajo", "escenarios", "x.json"), content: "{ roto" }))], ["deny", "deny"]);
  const conAut = configDePlantilla();
  conAut.seguridad.autorizacionDelDuenio = { firmante: "La dueña", fecha: "2026-10-10", alcance: "staging local", tenantsDePrueba: ["t1", "t2"] };
  check("con autorización válida: autorizacion → pasa", decidirEscrituras(esc("autorizacion"), conAut, raiz), null);
  const autMala = configDePlantilla();
  autMala.seguridad.autorizacionDelDuenio = { firmante: "", fecha: "ayer" };
  check("con autorización inválida (sin firmante ni fecha ISO): deny", decidirEscrituras(esc("autorizacion"), autMala, raiz) ? "deny" : null, "deny");
  check("un JSON cualquiera fuera de escenarios/ no se mira", d(ev("Write", { file_path: join(raiz, ".enjambre", "trabajo", "otro.json"), content: "{ roto" })), null);
  const rp = correrGuardia("guard-escrituras.mjs", esc("aislamiento"), { proyecto: raiz });
  check("proceso real: Write de un escenario de aislamiento sin autorización → deny con el motivo", [rp.decision, /autorizacionDelDuenio/.test(rp.stdout)], ["deny", true]);
  // Re-verificación sobre 24a5403: la categoría escrita distinto NO abre el candado (normalizada + lista cerrada).
  check("'autorización' con tilde, ' RLS ', 'Aislamiento' → deny (normalizadas)", [d(esc("autorización")), d(esc(" rls ")), d(esc("Aislamiento"))], ["deny", "deny", "deny"]);
  check("'authorization', 'permisos', 'seguridad', una inventada, un arreglo → deny (lista cerrada, falla cerrada)", [d(esc("authorization")), d(esc("permisos")), d(esc("seguridad")), d(esc("lo-que-sea")), d(ev("Write", { file_path: join(raiz, ".enjambre", "trabajo", "escenarios", "e.json"), content: JSON.stringify({ id: "e", funcion: "f", oraculo: {}, categoria: ["autorizacion"] }) }))], ["deny", "deny", "deny", "deny", "deny"]);
  check("' Funcional ' y 'metamórfico' (normalizadas a la lista) → pasan", [d(esc(" Funcional ")), d(esc("metamórfico"))], [null, null]);
  check("escenarios2/ y .jsonc también cuentan", [
    d(ev("Write", { file_path: join(raiz, ".enjambre", "trabajo", "escenarios2", "e.json"), content: JSON.stringify({ id: "e", funcion: "f", oraculo: {}, categoria: "rls" }) })),
    d(ev("Write", { file_path: join(raiz, ".enjambre", "trabajo", "escenarios", "e.jsonc"), content: "// comentario\n" + JSON.stringify({ id: "e", funcion: "f", oraculo: {}, categoria: "rls" }) })),
  ], ["deny", "deny"]);
  // Edit que cambia la categoría de un escenario existente, y escrituras por shell o por código.
  mkdirSync(join(raiz, ".enjambre", "trabajo", "escenarios"), { recursive: true });
  writeFileSync(join(raiz, ".enjambre", "trabajo", "escenarios", "esc-9.json"), JSON.stringify({ id: "esc-9", funcion: "f", oraculo: { tipo: "invariante", regla: "x" }, categoria: "funcional" }));
  check("Edit que pasa un escenario de funcional a rls sin autorización: deny; a contrato: pasa", [
    d(ev("Edit", { file_path: join(raiz, ".enjambre", "trabajo", "escenarios", "esc-9.json"), old_string: '"categoria":"funcional"', new_string: '"categoria":"rls"' })),
    d(ev("Edit", { file_path: join(raiz, ".enjambre", "trabajo", "escenarios", "esc-9.json"), old_string: '"categoria":"funcional"', new_string: '"categoria":"contrato"' })),
  ], ["deny", null]);
  check("Edit de un escenario que no existe: deny (falla cerrada)", d(ev("Edit", { file_path: join(raiz, ".enjambre", "trabajo", "escenarios", "no-esta.json"), old_string: "a", new_string: "b" })), "deny");
  check("escribir escenarios por la shell o por código: deny", [
    d(B(`echo '{"categoria":"rls"}' > .enjambre/trabajo/escenarios/x.json`)),
    d(B(`node -e "require('fs').writeFileSync('.enjambre/trabajo/escenarios/x.json', '{}')"`)),
    d(B("cp otro.json .enjambre/trabajo/escenarios/x.json")),
  ], ["deny", "deny", "deny"]);
  check("leer o listar escenarios por la shell: pasa", [d(B("cat .enjambre/trabajo/escenarios/esc-9.json")), d(B("ls .enjambre/trabajo/escenarios"))], [null, null]);
  const fechaMala = configDePlantilla();
  fechaMala.seguridad.autorizacionDelDuenio = { firmante: "La dueña", fecha: "2026-99-99" };
  const futura = configDePlantilla();
  futura.seguridad.autorizacionDelDuenio = { firmante: "La dueña", fecha: "2099-01-01" };
  check("autorización con fecha inexistente (99-99) o futura: no vale", [decidirEscrituras(esc("rls"), fechaMala, raiz) ? "deny" : null, decidirEscrituras(esc("rls"), futura, raiz) ? "deny" : null, problemasDeConfig(futura).length], ["deny", "deny", 1]);
  check("Grep en otra carpeta: no opina", d(ev("Grep", { pattern: "x", path: join(raiz, "src") })), null);
  const r = correrGuardia("guard-escrituras.mjs", ev("Write", { file_path: join(raiz, ".enjambre", "config.json"), content: "{}" }), { proyecto: raiz });
  check("proceso real: Write de config.json → deny", [r.codigo, r.decision], [0, "deny"]);
}

console.log("\n8. La forma de la respuesta es la que lee Claude Code");
{
  const raiz = proyectoTemporal();
  const r = correrGuardia("guard-prod.mjs", B("git push --force"), { proyecto: raiz });
  const j = JSON.parse(r.stdout);
  check("hookSpecificOutput.hookEventName = PreToolUse, permissionDecision = deny, con motivo", [j.hookSpecificOutput.hookEventName, j.hookSpecificOutput.permissionDecision, typeof j.hookSpecificOutput.permissionDecisionReason], ["PreToolUse", "deny", "string"]);
  check("…y el motivo dice de qué guardia viene", /^Guardia prod: /.test(j.hookSpecificOutput.permissionDecisionReason), true);
  const malo = correrGuardia("guard-prod.mjs", null, { proyecto: raiz });
  check("un evento que no es JSON: deny (falla cerrada)", malo.decision, "deny");
}

cerrar();
