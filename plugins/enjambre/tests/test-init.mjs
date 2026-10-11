// /enjambre:init EN UN DIRECTORIO TEMPORAL: no pisa, --dry-run no escribe, el manifiesto queda bien. Sin red.
//
//   node tests/test-init.mjs
//
// Lo que fija, y cómo se invirtió:
//   1. `--dry-run` imprime el plan y NO escribe nada (ni .enjambre/, ni settings, ni canónico).
//      Invertida: escribir el manifiesto también en dry-run → ROJO.
//   2. La primera corrida crea cada archivo de templates/ (salvo settings-deny.json) bajo
//      .enjambre/, y el manifiesto trae el sha256 de cada uno, igual al del archivo escrito.
//      Invertida: el hash del contenido de origen cambiado por el del nombre → ROJO.
//   3. Un archivo que el usuario ya tenía NO se pisa (se omite y el manifiesto conserva su hash
//      real); con `--force` se pisa con copia .bak. Invertida: `wx` → `w` en escribirSinPisar y
//      sin el chequeo de existsSync → ROJO.
//   4. La fusión de .claude/settings.json agrega las reglas deny que faltan, conserva las que
//      había y no toca otras claves; la segunda vez no agrega nada; guarda copia previa.
//      Invertida: reemplazar la lista en vez de unir → ROJO.
//   5. El libro canónico se crea una vez en el directorio común de git y no se pisa.
//   6. Sólo built-ins de Node en init.mjs y en las guardias (no hay `node_modules` que instalar).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { crearChequeo, RAIZ_PLUGIN } from "./_arnes.mjs";
import { fusionarDeny, inicializar } from "../scripts/init.mjs";

const { check, cerrar } = crearChequeo();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const listar = (dir, base = dir) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) out.push(...listar(r, base));
    else out.push(relative(base, r).replace(/\\/g, "/"));
  }
  return out;
};
const nuevoProyecto = () => mkdtempSync(join(tmpdir(), "enjambre-init-"));
const PLANTILLAS = join(RAIZ_PLUGIN, "templates");
const esperados = listar(PLANTILLAS).filter((r) => !r.endsWith("settings-deny.json"));

console.log("1. --dry-run no escribe nada (invertida: el manifiesto en dry-run, ROJO)");
{
  const p = nuevoProyecto();
  const r = inicializar({ dryRun: true, proyecto: p });
  check("el plan nombra cada archivo a crear", esperados.filter((e) => !r.lineas.some((l) => l.includes(`crea  .enjambre/${e}`))), []);
  check("config.json es lo PRIMERO que se crea (un init cortado no deja la carpeta sin config)", r.lineas.find((l) => /crea  \.enjambre\//.test(l)), "[dry-run] crea  .enjambre/config.json");
  check("todas las líneas van marcadas [dry-run]", r.lineas.slice(2).every((l) => l.startsWith("[dry-run]") || l.startsWith("canónico:")), true);
  check("no existe .enjambre/", existsSync(join(p, ".enjambre")), false);
  check("no existe .claude/settings.json", existsSync(join(p, ".claude", "settings.json")), false);
  check("el directorio quedó vacío", readdirSync(p), []);
  check("ok", r.ok, true);
}

console.log("\n2. La primera corrida copia todo y el manifiesto tiene el sha256 de cada archivo (invertida: hash del nombre, ROJO)");
{
  const p = nuevoProyecto();
  const r = inicializar({ proyecto: p, sinCanonico: true });
  check("ok, sin choques", [r.ok, r.choques], [true, 0]);
  const copiados = listar(join(p, ".enjambre")).filter((x) => x !== "manifest.json" && !x.startsWith("reservado/"));
  check("se copiaron exactamente los archivos de templates/ (menos settings-deny.json)", copiados, esperados);
  check("settings-deny.json NO se copió", existsSync(join(p, ".enjambre", "settings-deny.json")), false);
  const manifiesto = JSON.parse(readFileSync(join(p, ".enjambre", "manifest.json"), "utf8"));
  check("el manifiesto lista los mismos archivos", Object.keys(manifiesto.archivos).sort(), esperados);
  const malos = esperados.filter((e) => manifiesto.archivos[e] !== sha(readFileSync(join(p, ".enjambre", e))));
  check("cada hash del manifiesto es el sha256 del archivo escrito", malos, []);
  const distintos = esperados.filter((e) => sha(readFileSync(join(p, ".enjambre", e))) !== sha(readFileSync(join(PLANTILLAS, e))));
  check("cada archivo escrito es byte a byte el de templates/", distintos, []);
  check("el manifiesto trae la versión del plugin", typeof manifiesto.version, "string");
  check("existe .enjambre/reservado/ vacía", [existsSync(join(p, ".enjambre", "reservado")), readdirSync(join(p, ".enjambre", "reservado"))], [true, []]);
  check("la config copiada es la de plantilla", JSON.parse(readFileSync(join(p, ".enjambre", "config.json"), "utf8")).version, 1);
}

console.log("\n3. No pisa lo que ya existe; --force pisa con .bak (invertida: `wx` → `w`, ROJO)");
{
  const p = nuevoProyecto();
  mkdirSync(join(p, ".enjambre"), { recursive: true });
  writeFileSync(join(p, ".enjambre", "config.json"), '{ "mio": true }');
  const r = inicializar({ proyecto: p, sinCanonico: true });
  check("ok", r.ok, true);
  check("config.json del usuario intacta", readFileSync(join(p, ".enjambre", "config.json"), "utf8"), '{ "mio": true }');
  check("la línea dice que se omitió", r.lineas.some((l) => /omite \(ya existe\)  \.enjambre\/config\.json/.test(l)), true);
  const m1 = JSON.parse(readFileSync(join(p, ".enjambre", "manifest.json"), "utf8"));
  check("el manifiesto conserva el hash REAL del archivo omitido", m1.archivos["config.json"], sha('{ "mio": true }'));
  const r2 = inicializar({ proyecto: p, sinCanonico: true });
  check("una segunda corrida omite todo y no choca", [r2.ok, r2.lineas.filter((l) => l.startsWith("crea  ")).length], [true, 0]);
  const r3 = inicializar({ proyecto: p, sinCanonico: true, force: true });
  check("--force pisa config.json", JSON.parse(readFileSync(join(p, ".enjambre", "config.json"), "utf8")).version, 1);
  check("…con copia .bak del contenido previo", readFileSync(join(p, ".enjambre", "config.json.bak"), "utf8"), '{ "mio": true }');
  check("…y la línea lo dice", r3.lineas.some((l) => /pisa \(con \.enjambre\/config\.json\.bak\)/.test(l)), true);
  const r4 = inicializar({ proyecto: p, sinCanonico: true, force: true });
  check("otro --force no pisa el .bak: crea .bak.2", [existsSync(join(p, ".enjambre", "config.json.bak.2")), r4.ok], [true, true]);
}

console.log("\n4. La fusión de settings.json une, conserva y no toca otras claves (invertida: reemplazar la lista, ROJO)");
{
  const reglas = JSON.parse(readFileSync(join(PLANTILLAS, "settings-deny.json"), "utf8")).deny;
  const previo = { permissions: { deny: ["Bash(mi-regla *)", reglas[0]], allow: ["Bash(ls)"] }, hooks: { PreToolUse: [] }, otra: 1 };
  const { settings, agregadas } = fusionarDeny(previo, reglas);
  check("agrega las que faltan (todas menos la que ya estaba)", agregadas, reglas.length - 1);
  check("conserva la regla del usuario y la repetida una sola vez", [settings.permissions.deny[0], settings.permissions.deny.filter((x) => x === reglas[0]).length], ["Bash(mi-regla *)", 1]);
  check("no toca allow, hooks ni otras claves", [settings.permissions.allow, settings.hooks, settings.otra], [["Bash(ls)"], { PreToolUse: [] }, 1]);
  check("no muta el objeto original", previo.permissions.deny.length, 2);
  check("sobre un settings vacío crea permissions.deny", fusionarDeny({}, reglas).settings.permissions.deny.length, reglas.length);
  check("la segunda fusión no agrega nada", fusionarDeny(settings, reglas).agregadas, 0);
  // En disco.
  const p = nuevoProyecto();
  mkdirSync(join(p, ".claude"), { recursive: true });
  writeFileSync(join(p, ".claude", "settings.json"), JSON.stringify(previo, null, 2));
  inicializar({ proyecto: p, sinCanonico: true });
  const enDisco = JSON.parse(readFileSync(join(p, ".claude", "settings.json"), "utf8"));
  check("en disco: las reglas quedaron unidas", [enDisco.permissions.deny.length, enDisco.otra], [reglas.length + 1, 1]);
  check("en disco: copia previa .antes-de-enjambre.bak", JSON.parse(readFileSync(join(p, ".claude", "settings.json.antes-de-enjambre.bak"), "utf8")).permissions.deny.length, 2);
  const r2 = inicializar({ proyecto: p, sinCanonico: true });
  check("la segunda corrida dice que ya están", r2.lineas.some((l) => /ya tiene las \d+ reglas deny/.test(l)), true);
  // settings roto: no se toca.
  const p2 = nuevoProyecto();
  mkdirSync(join(p2, ".claude"), { recursive: true });
  writeFileSync(join(p2, ".claude", "settings.json"), "{ roto");
  let error = "";
  try { inicializar({ proyecto: p2, sinCanonico: true }); } catch (e) { error = e.message; }
  check("un settings.json roto no se toca y se informa", [/no es JSON válido/.test(error), readFileSync(join(p2, ".claude", "settings.json"), "utf8")], [true, "{ roto"]);
  // --sin-settings no crea nada.
  const p3 = nuevoProyecto();
  inicializar({ proyecto: p3, sinCanonico: true, sinSettings: true });
  check("--sin-settings no crea .claude/settings.json", existsSync(join(p3, ".claude", "settings.json")), false);
}

console.log("\n5. El libro canónico se crea una vez en el directorio común de git y no se pisa");
{
  const p = nuevoProyecto();
  execFileSync("git", ["-c", "user.name=p", "-c", "user.email=p@ejemplo.invalid", "init", "-q"], { cwd: p });
  const r = inicializar({ proyecto: p });
  const canonico = join(p, ".git", "enjambre", "gastos.json");
  check("creó <repo>/.git/enjambre/gastos.json", existsSync(canonico), true);
  check("…igual al espejo", readFileSync(canonico, "utf8"), readFileSync(join(p, ".enjambre", "gastos.json"), "utf8"));
  check("…y lo dice", r.lineas.some((l) => l.startsWith("canónico: creó")), true);
  writeFileSync(canonico, '{"corridas":[{"id":"x"}]}');
  const r2 = inicializar({ proyecto: p });
  check("otra corrida no lo pisa", [readFileSync(canonico, "utf8"), r2.lineas.some((l) => /canónico: ya existe/.test(l))], ['{"corridas":[{"id":"x"}]}', true]);
  const sinGit = nuevoProyecto();
  const r3 = inicializar({ proyecto: sinGit });
  check("sin git: avisa y sigue", [r3.ok, r3.lineas.some((l) => /no es un repo de git/.test(l))], [true, true]);
  // El CLI real.
  const p4 = nuevoProyecto();
  const salida = execFileSync(process.execPath, [join(RAIZ_PLUGIN, "scripts", "init.mjs"), "--proyecto", p4, "--dry-run"], { encoding: "utf8" });
  check("el CLI con --dry-run imprime el plan y no crea nada", [/\[dry-run\] crea  \.enjambre\/config\.json/.test(salida), existsSync(join(p4, ".enjambre"))], [true, false]);
  let codigo = 0;
  try { execFileSync(process.execPath, [join(RAIZ_PLUGIN, "scripts", "init.mjs"), "--loquesea"], { encoding: "utf8", stdio: "pipe" }); } catch (e) { codigo = e.status; }
  check("un argumento desconocido sale con 1", codigo, 1);
  // Una config existente INVÁLIDA: init la respeta (no la pisa), avisa y sale con 2 (hallazgo del auditor).
  const p5 = nuevoProyecto();
  mkdirSync(join(p5, ".enjambre"), { recursive: true });
  writeFileSync(join(p5, ".enjambre", "config.json"), JSON.stringify({ version: 1, proyecto: "x", loquesea: true }));
  const r5 = inicializar({ proyecto: p5, sinCanonico: true });
  check("init con config inválida: la lista y no la pisa", [r5.configInvalida.length > 0, r5.lineas.some((l) => l.startsWith("AVISO: .enjambre/config.json es inválida")), JSON.parse(readFileSync(join(p5, ".enjambre", "config.json"), "utf8")).loquesea], [true, true, true]);
  let codigo5 = 0;
  try { execFileSync(process.execPath, [join(RAIZ_PLUGIN, "scripts", "init.mjs"), "--proyecto", p5, "--sin-canonico"], { encoding: "utf8", stdio: "pipe" }); } catch (e) { codigo5 = e.status; }
  check("…y el CLI sale con 2", codigo5, 2);
  const p6 = nuevoProyecto();
  check("una config válida (la copiada) no avisa", inicializar({ proyecto: p6, sinCanonico: true }).configInvalida, []);
}

console.log("\n6. Sólo built-ins de Node en los scripts del plugin");
{
  const scripts = listar(join(RAIZ_PLUGIN, "scripts")).filter((r) => r.endsWith(".mjs"));
  const malos = [];
  for (const s of scripts) {
    for (const m of readFileSync(join(RAIZ_PLUGIN, "scripts", s), "utf8").matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)) {
      const mod = m[1];
      if (!mod.startsWith("node:") && !mod.startsWith("./") && !mod.startsWith("../")) malos.push(`${s}: ${mod}`);
    }
  }
  check("ningún import de un paquete externo", malos, []);
  check("no hay package.json con dependencias en el plugin", existsSync(join(RAIZ_PLUGIN, "node_modules")), false);
}

cerrar();
