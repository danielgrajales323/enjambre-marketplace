// /enjambre:init — COPIA `templates/` AL PROYECTO, SIN PISAR NADA. Sólo built-ins de Node.
//
//   node init.mjs [--proyecto <dir>] [--plantillas <dir>] [--dry-run] [--force] [--sin-settings] [--sin-canonico]
//
// Qué hace, en orden:
//   1. Lee `templates/` del plugin (por defecto `../templates` desde este archivo, o `--plantillas`).
//   2. Para cada archivo (salvo `settings-deny.json`), el destino es `<proyecto>/.enjambre/<ruta>`:
//        · si no existe: lo escribe con la bandera `wx` (si alguien lo creó entre medio, choca y
//          se informa, nunca se pisa);
//        · si existe: lo OMITE, salvo `--force`, que primero guarda una copia `.bak` (también `wx`).
//   3. Escribe `.enjambre/manifest.json` con el sha256 de cada archivo copiado y la versión del
//      plugin (de `.claude-plugin/plugin.json`), para que `/enjambre:reporte` pueda decir qué cambió.
//   4. FUSIONA `settings-deny.json` en `<proyecto>/.claude/settings.json` → `permissions.deny`:
//      agrega las reglas que faltan, no quita ninguna, no toca otras claves. Guarda una copia previa
//      `settings.json.antes-de-enjambre.bak` la primera vez. (`--sin-settings` lo saltea.)
//      El plugin no puede distribuir permisos: por eso van al proyecto.
//   5. Crea `.enjambre/reservado/` (vacía) y el libro CANÓNICO en el directorio común de git, una
//      vez, desde el espejo copiado (`--sin-canonico` lo saltea; sin git, avisa).
//   `--dry-run` imprime el plan y NO escribe nada (ni manifiesto, ni settings, ni canónico).
//
// Sale con 0 si todo lo planeado se hizo (u omitió por ya existir); con 1 si hubo un choque o un
// error. Imprime una línea por archivo: `crea`, `omite (ya existe)`, `pisa (con .bak)`, `choca`.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { problemasDeConfig } from "./lib/comun.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const NO_SE_COPIAN = new Set(["settings-deny.json"]);

function argumentos(argv) {
  const a = { dryRun: false, force: false, sinSettings: false, sinCanonico: false, proyecto: null, plantillas: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--dry-run") a.dryRun = true;
    else if (x === "--force") a.force = true;
    else if (x === "--sin-settings") a.sinSettings = true;
    else if (x === "--sin-canonico") a.sinCanonico = true;
    else if (x === "--proyecto") a.proyecto = argv[++i];
    else if (x === "--plantillas") a.plantillas = argv[++i];
    else throw new Error(`argumento desconocido: ${x}`);
  }
  return a;
}

function listar(dir, base = dir) {
  const out = [];
  for (const nombre of readdirSync(dir).sort()) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) out.push(...listar(ruta, base));
    else out.push(relative(base, ruta).replace(/\\/g, "/"));
  }
  return out;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function versionDelPlugin(raizPlugin) {
  try {
    return JSON.parse(readFileSync(join(raizPlugin, ".claude-plugin", "plugin.json"), "utf8")).version ?? "?";
  } catch {
    return "?";
  }
}

/** Escribe con `wx`. Devuelve "crea", "choca" (apareció entre medio) o lanza otro error. */
function escribirSinPisar(destino, contenido) {
  mkdirSync(dirname(destino), { recursive: true });
  try {
    writeFileSync(destino, contenido, { flag: "wx" });
    return "crea";
  } catch (err) {
    if (err?.code === "EEXIST") return "choca";
    throw err;
  }
}

/** Un `.bak` que no existe todavía: `.bak`, `.bak.2`, ... */
function respaldar(destino) {
  for (let n = 1; n < 100; n++) {
    const bak = n === 1 ? `${destino}.bak` : `${destino}.bak.${n}`;
    try {
      writeFileSync(bak, readFileSync(destino), { flag: "wx" });
      return bak;
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
    }
  }
  throw new Error(`no pude respaldar ${destino}: demasiadas copias .bak`);
}

/**
 * Fusiona reglas en `permissions.deny` de un settings.json (objeto). Pura: devuelve el objeto
 * nuevo y cuántas reglas se agregaron. No quita nada ni toca otras claves.
 */
export function fusionarDeny(settings, reglas) {
  const s = settings && typeof settings === "object" && !Array.isArray(settings) ? structuredClone(settings) : {};
  if (!s.permissions || typeof s.permissions !== "object") s.permissions = {};
  if (!Array.isArray(s.permissions.deny)) s.permissions.deny = [];
  let agregadas = 0;
  for (const r of reglas) {
    if (!s.permissions.deny.includes(r)) {
      s.permissions.deny.push(r);
      agregadas++;
    }
  }
  return { settings: s, agregadas };
}

/** El plan y la ejecución. `o`: argumentos; devuelve el resumen (para las pruebas y para la skill). */
export function inicializar(o) {
  const raizPlugin = resolve(AQUI, "..");
  const plantillas = resolve(o.plantillas ?? join(raizPlugin, "templates"));
  const proyecto = resolve(o.proyecto ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const destinoBase = join(proyecto, ".enjambre");
  const lineas = [];
  const manifiesto = { _que: "Lo que /enjambre:init copió a .enjambre/, con el sha256 de cada archivo tal como se copió.", plugin: "enjambre", version: versionDelPlugin(raizPlugin), archivos: {} };
  let choques = 0;
  const di = (s) => lineas.push(s);

  di(`${o.dryRun ? "[dry-run] " : ""}plantillas: ${plantillas}`);
  di(`${o.dryRun ? "[dry-run] " : ""}proyecto:   ${proyecto}`);
  if (!existsSync(plantillas)) throw new Error(`no existe la carpeta de plantillas ${plantillas}`);

  // Si ya hay un manifiesto, se conserva lo que dice de los archivos que se omiten.
  const rutaManifiesto = join(destinoBase, "manifest.json");
  let previo = null;
  try { previo = JSON.parse(readFileSync(rutaManifiesto, "utf8")); } catch { /* no hay */ }

  // `config.json` va PRIMERO: con la carpeta creada y sin config, las guardias bloquean la sesión; si
  // un init se corta a la mitad, que sea con la config ya escrita.
  const archivos = listar(plantillas).sort((a, b) => (a === "config.json" ? -1 : b === "config.json" ? 1 : 0));
  for (const rel of archivos) {
    const nombre = rel.split("/").pop();
    if (NO_SE_COPIAN.has(nombre)) continue;
    const origen = join(plantillas, rel);
    const destino = join(destinoBase, rel);
    const contenido = readFileSync(origen);
    const hash = sha256(contenido);
    if (existsSync(destino)) {
      if (o.force) {
        if (o.dryRun) di(`[dry-run] pisa (con .bak)  .enjambre/${rel}`);
        else {
          const bak = respaldar(destino);
          writeFileSync(destino, contenido);
          di(`pisa (con ${relative(proyecto, bak).replace(/\\/g, "/")})  .enjambre/${rel}`);
        }
        manifiesto.archivos[rel] = hash;
      } else {
        di(`${o.dryRun ? "[dry-run] " : ""}omite (ya existe)  .enjambre/${rel}`);
        manifiesto.archivos[rel] = previo?.archivos?.[rel] ?? sha256(readFileSync(destino));
      }
      continue;
    }
    if (o.dryRun) {
      di(`[dry-run] crea  .enjambre/${rel}`);
      manifiesto.archivos[rel] = hash;
      continue;
    }
    const r = escribirSinPisar(destino, contenido);
    if (r === "choca") { choques++; di(`choca (apareció entre medio, no se pisa)  .enjambre/${rel}`); continue; }
    di(`crea  .enjambre/${rel}`);
    manifiesto.archivos[rel] = hash;
  }

  // El manifiesto se reescribe siempre (es del plugin, no del usuario).
  if (o.dryRun) di(`[dry-run] escribe  .enjambre/manifest.json (${Object.keys(manifiesto.archivos).length} archivos)`);
  else {
    mkdirSync(destinoBase, { recursive: true });
    writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2) + "\n");
    di(`escribe  .enjambre/manifest.json (${Object.keys(manifiesto.archivos).length} archivos)`);
  }

  // La carpeta del reservado, vacía.
  const reservado = join(destinoBase, "reservado");
  if (!existsSync(reservado)) {
    if (o.dryRun) di("[dry-run] crea  .enjambre/reservado/");
    else { mkdirSync(reservado, { recursive: true }); di("crea  .enjambre/reservado/"); }
  }

  // Los permisos del proyecto (el plugin no puede distribuirlos).
  if (!o.sinSettings) {
    const reglas = JSON.parse(readFileSync(join(plantillas, "settings-deny.json"), "utf8")).deny;
    const rutaSettings = join(proyecto, ".claude", "settings.json");
    let actual = {};
    let existia = false;
    if (existsSync(rutaSettings)) {
      existia = true;
      try {
        actual = JSON.parse(readFileSync(rutaSettings, "utf8"));
      } catch (err) {
        throw new Error(`.claude/settings.json no es JSON válido; no lo toco: ${String(err?.message ?? err).slice(0, 100)}`);
      }
    }
    const { settings, agregadas } = fusionarDeny(actual, reglas);
    if (agregadas === 0) di(`${o.dryRun ? "[dry-run] " : ""}settings: .claude/settings.json ya tiene las ${reglas.length} reglas deny`);
    else if (o.dryRun) di(`[dry-run] settings: agrega ${agregadas} reglas deny a .claude/settings.json${existia ? "" : " (lo crea)"}`);
    else {
      mkdirSync(dirname(rutaSettings), { recursive: true });
      if (existia) {
        try { writeFileSync(`${rutaSettings}.antes-de-enjambre.bak`, readFileSync(rutaSettings), { flag: "wx" }); } catch (err) { if (err?.code !== "EEXIST") throw err; }
      }
      writeFileSync(rutaSettings, JSON.stringify(settings, null, 2) + "\n");
      di(`settings: agregó ${agregadas} reglas deny a .claude/settings.json${existia ? " (copia previa en .antes-de-enjambre.bak)" : " (creado)"}`);
    }
  }

  // El libro canónico, una vez, desde el espejo.
  if (!o.sinCanonico) {
    const espejo = join(destinoBase, "gastos.json");
    let comun = null;
    try {
      const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: proyecto, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      comun = isAbsolute(out) ? out : resolve(proyecto, out);
    } catch {
      di("canónico: el proyecto no es un repo de git; el libro canónico se crea cuando lo sea (`node .enjambre/lib/libroDeGastos.mjs` no arranca nada sin él)");
    }
    if (comun) {
      let carpeta = "enjambre";
      try { carpeta = JSON.parse(readFileSync(join(plantillas, "config.json"), "utf8")).gasto.carpetaCanonico ?? carpeta; } catch { /* la de siempre */ }
      const canonico = join(comun, carpeta, "gastos.json");
      if (existsSync(canonico)) di(`canónico: ya existe ${canonico} (no se pisa)`);
      else if (o.dryRun) di(`[dry-run] canónico: crea ${canonico} desde .enjambre/gastos.json`);
      else {
        const fuente = existsSync(espejo) ? readFileSync(espejo) : readFileSync(join(plantillas, "gastos.json"));
        mkdirSync(dirname(canonico), { recursive: true });
        writeFileSync(canonico, fuente, { flag: "wx" });
        di(`canónico: creó ${canonico}`);
      }
    }
  }

  // La configuración que QUEDA en el proyecto (la del usuario o la recién copiada) se valida: una
  // inválida bloquea todas las guardias, así que se avisa acá, con código de salida distinto de 0.
  let configInvalida = [];
  const rutaConfig = join(destinoBase, "config.json");
  if (existsSync(rutaConfig)) {
    try {
      configInvalida = problemasDeConfig(JSON.parse(readFileSync(rutaConfig, "utf8")));
    } catch (err) {
      configInvalida = [`no es JSON válido: ${String(err?.message ?? err).slice(0, 100)}`];
    }
    if (configInvalida.length) di(`AVISO: .enjambre/config.json es inválida y las guardias van a bloquear todo hasta arreglarla: ${configInvalida.slice(0, 4).join("; ")}`);
  }

  return { ok: choques === 0, choques, lineas, manifiesto, proyecto, configInvalida };
}

const esPrincipal = process.argv[1] && resolve(process.argv[1]).replace(/\\/g, "/").toLowerCase() === fileURLToPath(import.meta.url).replace(/\\/g, "/").toLowerCase();
if (esPrincipal) {
  try {
    const r = inicializar(argumentos(process.argv.slice(2)));
    for (const l of r.lineas) console.log(l);
    if (!r.ok) { console.error(`${r.choques} choque(s): nada se pisó.`); process.exit(1); }
    if (r.configInvalida.length) { console.error("la configuración del enjambre es inválida (ver AVISO): corregila antes de seguir."); process.exit(2); }
  } catch (err) {
    console.error(`init: ${err?.message ?? err}`);
    process.exit(1);
  }
}
