// GUARDIA: EL TOPE DE GASTO, ANTES DE CORRER LO QUE GASTA. Hook PreToolUse sobre Bash|PowerShell.
//
// Es la red EXTERIOR: la decisión fina (estimación, tope por corrida, reserva final) la toma el
// libro dentro del script (`lib/libroDeGastos.mjs`, con el candado). Esta guardia mira el libro
// ANTES de lanzar un script de `gasto.scriptsQueGastan` y niega si:
//   · el libro (espejo + canónico) falta o está roto: falla cerrado, borrarlo no resetea;
//   · el acumulado ya alcanzó el tope duro;
//   · el acumulado pasó el aviso y el comando no trae la bandera del supervisor.
// Un script que gasta se reconoce por su nombre (sin extensión) en `node|tsx|deno|bun <ruta>`.
//
// Duplica a conciencia la lectura mínima del libro (no puede importar la copia del proyecto).
// Sin `.enjambre/`: no hace nada. Config rota: bloquea (comun.mjs).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { correrGuardia, esPrincipal, subcomandos, tokens } from "./lib/comun.mjs";

export const BANDERA_SIGUE = "--sigue-despues-del-aviso";

const cuenta = (e) => (e.estado === "en_curso" ? Math.max(Number(e.topeUsd) || 0, Number(e.gastadoUsd) || 0) : Number(e.gastadoUsd) || 0);

function leerUna(ruta) {
  const x = JSON.parse(readFileSync(ruta, "utf8"));
  if (!x || !Array.isArray(x.corridas)) throw new Error(`${ruta}: no tiene la lista corridas`);
  const sobran = Object.keys(x).filter((k) => k !== "_regla" && k !== "corridas");
  if (sobran.length) throw new Error(`${ruta}: campos que el libro no lleva (${sobran.join(", ")})`);
  return x;
}

/** El acumulado efectivo: la fusión por id del canónico y el espejo (de cada id, la que más cuenta). */
export function acumuladoEfectivo(rutaEspejo, carpetaCanonico, git = gitCommonDir) {
  const comun = git(dirname(rutaEspejo));
  const canonico = join(comun, carpetaCanonico, "gastos.json");
  if (!existsSync(canonico)) throw new Error(`no existe el libro canónico ${canonico} (borrarlo no resetea el gasto; se crea a conciencia una vez)`);
  const porId = new Map();
  for (const e of leerUna(canonico).corridas) porId.set(e.id, e);
  if (existsSync(rutaEspejo)) {
    for (const e of leerUna(rutaEspejo).corridas) {
      const ya = porId.get(e.id);
      if (!ya || cuenta(e) > cuenta(ya)) porId.set(e.id, e);
    }
  }
  return [...porId.values()].reduce((s, e) => s + cuenta(e), 0);
}

function gitCommonDir(dir) {
  const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  return isAbsolute(out) ? out : resolve(dir, out);
}

/** El nombre (sin extensión) del script que corre un subcomando, o null. */
export function scriptDe(sub) {
  const ts = tokens(sub);
  const i = ts.findIndex((t) => /^(node|tsx|deno|bun|npx)$/i.test(t));
  if (i < 0) return null;
  const resto = ts.slice(i + 1).filter((t) => !/^(run|tsx|--import|--loader)$/.test(t) && !t.startsWith("-"));
  const script = resto[0];
  if (!script) return null;
  return basename(script).replace(/\.(mjs|cjs|js|ts|mts)$/i, "");
}

export function decidir(ev, config, raiz, leerAcumulado = acumuladoEfectivo) {
  if (ev.tool_name !== "Bash" && ev.tool_name !== "PowerShell") return null;
  const cmd = String(ev.tool_input?.command ?? "");
  const g = config.gasto;
  for (const sub of subcomandos(cmd)) {
    const script = scriptDe(sub);
    if (!script || !g.scriptsQueGastan.includes(script)) continue;
    let acumulado;
    try {
      acumulado = leerAcumulado(resolve(raiz, g.libro), g.carpetaCanonico);
    } catch (err) {
      return { motivo: `el libro de gastos no se puede leer (${String(err?.message ?? err).slice(0, 140)}): nada que gaste arranca (falla cerrado).` };
    }
    if (acumulado >= g.topeUsd) return { motivo: `el enjambre ya gastó US$${acumulado.toFixed(2)} y el tope duro es US$${g.topeUsd.toFixed(2)}: no arranca nada más. Sube el tope sólo el dueño, en .enjambre/config.json.` };
    if (acumulado > g.avisoUsd && !sub.includes(BANDERA_SIGUE)) {
      return { motivo: `el enjambre ya gastó US$${acumulado.toFixed(2)}, más que el aviso de US$${g.avisoUsd.toFixed(2)}. Para seguir hace falta ${BANDERA_SIGUE}, que pone SÓLO el supervisor después de que contesta el dueño.` };
    }
  }
  return null;
}

if (esPrincipal(import.meta.url)) await correrGuardia("gasto", decidir);
