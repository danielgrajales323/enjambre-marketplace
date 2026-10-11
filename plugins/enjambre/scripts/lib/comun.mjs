// LO COMÚN A TODAS LAS GUARDIAS DEL PLUGIN. Sólo built-ins de Node.
//
// Cada guardia es un hook PreToolUse (o PostToolUse) que lee el evento por stdin y contesta:
//   · nada (exit 0, sin salida)                        → la herramienta corre;
//   · JSON con permissionDecision "deny" (exit 0)      → la herramienta no corre, con el motivo.
//
// LAS TRES REGLAS DE TODA GUARDIA:
//   1. Si el proyecto NO tiene `.enjambre/config.json` (buscado desde CLAUDE_PROJECT_DIR, el cwd del
//      evento y el cwd del proceso, subiendo hasta la raíz), la guardia NO HACE NADA. Los hooks de un
//      plugin se disparan en todas las sesiones donde está habilitado, y un proyecto ajeno no se toca.
//   2. Si la configuración existe pero está ROTA (JSON inválido, campos que faltan o sobran, tipos
//      malos), la guardia BLOQUEA con el motivo. Con `onFailure: "block"` en hooks.json, una guardia
//      que se cae también bloquea: no existe el estado "abierto por error".
//   3. La decisión es una función PURA (`decidir(evento, config, raiz)`), probada sin spawn; el
//      proceso sólo la envuelve.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class ConfigInvalida extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ConfigInvalida";
  }
}

const esLista = (x, de) => Array.isArray(x) && x.every((v) => typeof v === de);
const esNumero = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;

const CLAVES_RAIZ = ["_que", "version", "proyecto", "mapa", "red", "comandosProhibidos", "reservado", "gasto", "dorado", "protegidos", "secretos", "modelos", "seguridad"];

/** Lo que está mal en una configuración. Vacío si está bien. ESTRICTA: una clave de más la invalida. */
export function problemasDeConfig(c) {
  const p = [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["la configuración no es un objeto"];
  for (const k of Object.keys(c)) if (!CLAVES_RAIZ.includes(k)) p.push(`clave desconocida en la raíz: ${k}`);
  if (c.version !== 1) p.push("version tiene que ser 1");
  if (typeof c.proyecto !== "string" || !c.proyecto.trim()) p.push("proyecto: falta el nombre");
  const m = c.mapa;
  if (!m || typeof m !== "object") p.push("mapa: falta");
  else {
    if (m.herramienta !== null && (typeof m.herramienta !== "string" || !m.herramienta.trim())) p.push("mapa.herramienta: texto o null");
    if (!esLista(m.subcomandos ?? [], "string")) p.push("mapa.subcomandos: lista de textos");
    if (!esNumero(m.ventanaMinutos)) p.push("mapa.ventanaMinutos: número");
    if (!esLista(m.rutasDeCodigo, "string")) p.push("mapa.rutasDeCodigo: lista de textos");
    if (!esLista(m.extensiones, "string")) p.push("mapa.extensiones: lista de textos");
  }
  const r = c.red;
  if (!r || typeof r !== "object") p.push("red: falta");
  else {
    if (!esLista(r.hostsPermitidos, "string")) p.push("red.hostsPermitidos: lista de textos");
    if (!esLista(r.hostsProhibidos, "string")) p.push("red.hostsProhibidos: lista de textos");
  }
  if (!esLista(c.comandosProhibidos, "string")) p.push("comandosProhibidos: lista de regex (textos)");
  else {
    for (const rx of c.comandosProhibidos) {
      try { new RegExp(rx); } catch { p.push(`comandosProhibidos: regex inválida: ${rx}`); }
    }
  }
  const v = c.reservado;
  if (!v || typeof v !== "object") p.push("reservado: falta");
  else {
    if (typeof v.ruta !== "string" || !v.ruta.trim()) p.push("reservado.ruta: texto");
    if (!esLista(v.lectoresAutorizados, "string")) p.push("reservado.lectoresAutorizados: lista de textos");
  }
  const g = c.gasto;
  if (!g || typeof g !== "object") p.push("gasto: falta");
  else {
    if (typeof g.libro !== "string" || !g.libro.trim()) p.push("gasto.libro: texto");
    if (typeof g.carpetaCanonico !== "string" || !g.carpetaCanonico.trim()) p.push("gasto.carpetaCanonico: texto");
    for (const k of ["topeUsd", "avisoUsd", "reservaFinalUsd", "margenUsd"]) if (!esNumero(g[k])) p.push(`gasto.${k}: número`);
    if (esNumero(g.topeUsd) && esNumero(g.avisoUsd) && g.avisoUsd > g.topeUsd) p.push("gasto.avisoUsd no puede superar gasto.topeUsd");
    if (esNumero(g.topeUsd) && esNumero(g.reservaFinalUsd) && g.reservaFinalUsd >= g.topeUsd) p.push("gasto.reservaFinalUsd tiene que ser menor que el tope");
    if (!esLista(g.scriptsQueGastan, "string")) p.push("gasto.scriptsQueGastan: lista de textos");
  }
  const d = c.dorado;
  if (!d || typeof d !== "object") p.push("dorado: falta");
  else {
    if (typeof d.archivo !== "string" || !d.archivo.trim()) p.push("dorado.archivo: texto");
    if (typeof d.prefijoDerivado !== "string" || !d.prefijoDerivado.trim()) p.push("dorado.prefijoDerivado: texto");
  }
  if (!esLista(c.protegidos, "string")) p.push("protegidos: lista de textos");
  if (!esLista(c.secretos, "string")) p.push("secretos: lista de textos");
  if (!c.modelos || typeof c.modelos !== "object" || !Object.values(c.modelos).every((x) => typeof x === "string")) p.push("modelos: objeto rol → modelo");
  if (!c.seguridad || typeof c.seguridad !== "object") p.push("seguridad: falta");
  else if (c.seguridad.autorizacionDelDuenio !== null) {
    const a = c.seguridad.autorizacionDelDuenio;
    if (!a || typeof a !== "object" || Array.isArray(a)) p.push("seguridad.autorizacionDelDuenio: null u objeto");
    else {
      if (typeof a.firmante !== "string" || !a.firmante.trim()) p.push("seguridad.autorizacionDelDuenio.firmante: quién autoriza (texto)");
      if (!fechaValidaYNoFutura(a.fecha)) p.push("seguridad.autorizacionDelDuenio.fecha: fecha real AAAA-MM-DD, no futura");
    }
  }
  return p;
}

/**
 * Sube desde `desde` hasta encontrar la CARPETA `.enjambre/`. null si no hay. Se busca la carpeta y
 * no el archivo: si alguien borra `config.json` (rm, git rm), la carpeta sigue y la guardia NIEGA
 * (falla cerrada) en vez de apagarse (hallazgo del auditor sobre d75afbd).
 */
export const CARPETA_ENJAMBRE = ".enjambre";

export function ubicarRaiz(desde) {
  if (!desde) return null;
  let dir = resolve(desde);
  for (;;) {
    if (existsSync(join(dir, CARPETA_ENJAMBRE))) return dir;
    // No se sube más allá de la raíz del repo git: una `.enjambre/` olvidada en HOME no activa las
    // guardias en todos los proyectos de abajo.
    if (existsSync(join(dir, ".git"))) return null;
    const arriba = dirname(dir);
    if (arriba === dir) return null;
    dir = arriba;
  }
}

/** La raíz del proyecto con `.enjambre/`, probando los candidatos en orden. */
export function ubicarProyecto(ev, env = process.env) {
  for (const cand of [env.CLAUDE_PROJECT_DIR, ev?.cwd, process.cwd()]) {
    const r = ubicarRaiz(cand);
    if (r) return r;
  }
  return null;
}

/** Lee y valida la configuración. Lanza `ConfigInvalida` si está rota. */
export function cargarConfig(raiz) {
  const ruta = join(raiz, ".enjambre", "config.json");
  if (!existsSync(ruta)) {
    const err = new ConfigInvalida(`existe .enjambre/ pero falta ${ruta}: borrarla no apaga las guardias. Lo único que pasa hasta restaurarla: \`git checkout -- .enjambre/config.json\` o \`node <plugin>/scripts/init.mjs\` (/enjambre:init copia la plantilla sin pisar nada).`);
    err.faltaConfig = true;
    throw err;
  }
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(ruta, "utf8"));
  } catch (err) {
    throw new ConfigInvalida(`${ruta} no es JSON válido: ${String(err?.message ?? err).slice(0, 120)}`);
  }
  const p = problemasDeConfig(crudo);
  if (p.length) throw new ConfigInvalida(`${ruta} está mal: ${p.slice(0, 6).join("; ")}`);
  return crudo;
}

/** Ruta relativa a la raíz, con barras `/`. Si no está adentro, la absoluta normalizada. */
export function relativaA(raiz, ruta) {
  const abs = isAbsolute(ruta) ? resolve(ruta) : resolve(raiz, ruta);
  const r = resolve(raiz);
  const norm = (s) => s.replace(/\\/g, "/");
  const a = norm(abs);
  const base = norm(r).replace(/\/$/, "");
  const igual = process.platform === "win32" ? a.toLowerCase().startsWith(base.toLowerCase() + "/") : a.startsWith(base + "/");
  return igual ? a.slice(base.length + 1) : a;
}

/** ¿`ruta` (relativa a la raíz) está dentro de `dir` (relativa) o es ese archivo? */
export function dentroDe(ruta, dir) {
  const a = ruta.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const d = dir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const cmp = (x, y) => (process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y);
  return cmp(a, d) || (process.platform === "win32" ? a.toLowerCase().startsWith(d.toLowerCase() + "/") : a.startsWith(d + "/"));
}

/** Un glob simple (`*`, `**`, `?`) a regex (sin anclas). */
export function globARegex(glob) {
  // `**/` al principio o en el medio es "cero o más carpetas": `**/.env*` también alcanza `.env`.
  return glob.replace(/\\/g, "/").replace(/^\.\//, "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0001").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0001/g, "(?:.*/)?").replace(/\u0000/g, ".*");
}

/** La ruta relativa a la raíz, o "" si ES la raíz (`.`, la ruta absoluta de la raíz, vacío). */
export function relativaORaiz(raiz, ruta) {
  if (ruta === undefined || ruta === null || String(ruta).trim() === "") return "";
  const norm = (p) => resolve(p).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  if (norm(resolve(raiz, String(ruta))) === norm(raiz)) return "";
  return relativaA(raiz, String(ruta));
}

/** ¿`ruta` coincide con un patrón simple de archivo (`.env`, `.env.*`, `dir/**`)? Sin distinguir mayúsculas. */
export function coincideRuta(ruta, patron) {
  const r = ruta.replace(/\\/g, "/");
  const rx = new RegExp(`(^|/)${globARegex(patron)}$`, "i");
  return rx.test(r);
}

/**
 * ¿Un token de la shell (puede traer un glob: `cat .env*`, `cat .enjambre/res*` y una ruta adentro) ALCANZA una ruta
 * o un patrón? Se mira si el glob del token podría matchear la ruta, la ruta con algo adentro, o el
 * patrón con su comodín reemplazado. Mayúsculas y barras normalizadas.
 */
export function tokenAlcanza(token, objetivo) {
  const t = String(token ?? "").replace(/^[<>]+/, "").replace(/^["']|["']$/g, "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (!t) return false;
  const o = String(objetivo).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
  const ejemplos = [o, `${o}/x`, o.replace(/\*\*/g, "x/x").replace(/\*/g, "x")];
  if (/[*?]/.test(t)) {
    const rx = new RegExp(`(^|/)${globARegex(t)}(/|$)`);
    if (ejemplos.some((e) => rx.test(e))) return true;
    // Un glob más largo que el objetivo (`.enjambre/res*/semillas.json`): sus primeros segmentos lo alcanzan.
    const segsO = o.split("/");
    const prefijo = t.split("/").slice(0, segsO.length).join("/");
    return prefijo !== t && new RegExp(`^${globARegex(prefijo)}$`).test(o);
  }
  // Sin glob: la ruta puede venir dentro de código o de comillas (`readFileSync('.enjambre/x')`).
  const rxO = new RegExp(`(^|[^a-z0-9_-])${globARegex(o)}(?=$|[^a-z0-9_-])`);
  return rxO.test(t) || t === o || t.startsWith(`${o}/`);
}

/** Subcomandos de una línea de shell (&&, ||, ;, |, saltos de línea). */
export function subcomandos(cmd) {
  return String(cmd ?? "").split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Los tokens de un subcomando, respetando las comillas (`node "C:/con espacios/init.mjs" --x` es
 * tres tokens) y sin ellas en el resultado. Una comilla sin cerrar llega hasta el final.
 */
export function tokens(sub) {
  const out = [];
  let actual = "";
  let dentro = null;
  let hubo = false;
  for (const ch of String(sub ?? "")) {
    if (dentro) {
      if (ch === dentro) dentro = null;
      else actual += ch;
    } else if (ch === '"' || ch === "'") {
      dentro = ch;
      hubo = true;
    } else if (/\s/.test(ch)) {
      if (actual || hubo) out.push(actual);
      actual = "";
      hubo = false;
    } else {
      actual += ch;
    }
  }
  if (actual || hubo) out.push(actual);
  return out.filter((t) => t !== "");
}

// ── La autorización del dueño para las pruebas de seguridad (sólo defensivas) ──────────────

/** La lista CERRADA de categorías de escenario. Cualquier otra escritura se NIEGA (falla cerrada). */
export const CATEGORIAS_VALIDAS = ["funcional", "contrato", "propiedad", "metamorfico", "autorizacion", "aislamiento", "rls"];
/** Las categorías que NO se generan ni se escriben sin `seguridad.autorizacionDelDuenio`. */
export const CATEGORIAS_QUE_EXIGEN_AUTORIZACION = ["autorizacion", "aislamiento", "rls"];

/** `" Autorización "` → `"autorizacion"`: trim, minúsculas, sin tildes (NFD sin marcas). Lo que no es texto → "". */
export function normalizarCategoria(x) {
  if (typeof x !== "string") return "";
  return x.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** ¿`fecha` es AAAA-MM-DD real (no 99-99) y no futura (contra `hoy`, ISO)? */
export function fechaValidaYNoFutura(fecha, hoy = new Date().toISOString().slice(0, 10)) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha ?? "").slice(0, 10));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return false;
  return `${m[1]}-${m[2]}-${m[3]}` <= hoy;
}

/** ¿Hay una autorización escrita y válida (objeto con firmante y una fecha real, no futura)? */
export function autorizacionVigente(config, hoy) {
  const a = config?.seguridad?.autorizacionDelDuenio;
  return !!a && typeof a === "object" && !Array.isArray(a) && typeof a.firmante === "string" && !!a.firmante.trim() && fechaValidaYNoFutura(a.fecha, hoy);
}

/**
 * Lo que está mal en un escenario, para la red DETERMINISTA. La categoría se normaliza y se compara
 * contra la lista CERRADA: una categoría desconocida ("authorization", "permisos", "seguridad", un
 * arreglo) se NIEGA, no pasa. Las de seguridad exigen la autorización del dueño. Lo que la red NO
 * ve: un escenario de autorización etiquetado como `funcional` por el modelo; de eso se ocupan el
 * verificador y el auditor. Vacío si está bien.
 */
export function problemasDeEscenario(escenario, config, hoy) {
  const p = [];
  if (!escenario || typeof escenario !== "object" || Array.isArray(escenario)) return ["el escenario no es un objeto"];
  const cat = normalizarCategoria(escenario.categoria);
  if (!cat) p.push(`el escenario no dice su categoria como texto (una de: ${CATEGORIAS_VALIDAS.join(", ")})`);
  else if (!CATEGORIAS_VALIDAS.includes(cat)) p.push(`categoría desconocida "${cat}": sólo ${CATEGORIAS_VALIDAS.join(", ")} (falla cerrada)`);
  else if (CATEGORIAS_QUE_EXIGEN_AUTORIZACION.includes(cat) && !autorizacionVigente(config, hoy)) {
    p.push(`la categoría "${cat}" exige seguridad.autorizacionDelDuenio (firmante y fecha real, no futura) en .enjambre/config.json: sin ella es una PARADA para el dueño, no un escenario`);
  }
  return p;
}

/** ¿`host` coincide con el patrón (`ejemplo.test`, `*.ejemplo.test`)? Sin distinguir mayúsculas. */
export function coincideHost(host, patron) {
  const h = host.toLowerCase().replace(/\.$/, "");
  const p = patron.toLowerCase();
  if (p.startsWith("*.")) {
    const base = p.slice(2);
    return h === base || h.endsWith("." + base);
  }
  return h === p;
}

const EXTENSIONES_DE_ARCHIVO = /\.(mjs|cjs|js|jsx|ts|tsx|mts|json|md|txt|yml|yaml|toml|py|rb|go|rs|sh|ps1|sql|html|css|png|jpg|gif|svg|gz|zip|lock|env|log|csv|xml)$/i;
const RX_PARECE_HOST = /^(\[[0-9a-f:.]+\]|[a-z0-9-]+(\.[a-z0-9-]+)+|localhost)(:\d{1,5})?(\/\S*)?$/i;
const RX_VERBO_DE_RED = /^(curl|wget|http|https|nc|ncat|telnet|ping|psql|pg_dump|pg_restore|mysql|redis-cli|ssh|scp|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|Test-NetConnection)$/i;

/**
 * Los hosts que nombra un texto: URLs con esquema, y además (hallazgo del auditor sobre d75afbd)
 * hosts SIN esquema: `host:puerto`, lo que sigue a `-h`/`--host`/`-H`, y el primer argumento con
 * forma de host de un verbo de red (curl, wget, psql, Invoke-WebRequest…). Un token con extensión
 * de archivo o con `/` antes del primer punto no es un host.
 */
export function hostsDe(texto) {
  const hosts = new Set();
  const t = String(texto ?? "");
  for (const m of t.matchAll(/[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@"']*@)?(\[[0-9a-f:.]+\]|[^\s/:"'?#]+)/gi)) hosts.add(m[1]);
  const pareceHost = (tok) => {
    const x = tok.replace(/^["']|["']$/g, "");
    if (!RX_PARECE_HOST.test(x) || /^[a-z]:[\\/]/i.test(x)) return null;
    const sinRuta = x.replace(/\/.*$/, "");
    if (EXTENSIONES_DE_ARCHIVO.test(sinRuta) || /^\d+(\.\d+){0,2}$/.test(sinRuta)) return null; // archivo o versión
    return sinRuta.replace(/:\d+$/, "");
  };
  for (const sub of subcomandos(t)) {
    // `host=…` en una cadena de conexión (psql "host=db.x dbname=y", libpq, JDBC).
    for (const m of sub.matchAll(/\bhost(?:name|addr)?=([^\s"';&]+)/gi)) { const h = pareceHost(m[1]); if (h) hosts.add(h); }
    const ts = tokens(sub);
    for (let i = 0; i < ts.length; i++) {
      const tok = ts[i];
      const m = /^(-h|--host|-H|--hostname)(=(.+))?$/.exec(tok);
      if (m) {
        const h = pareceHost(m[3] ?? ts[i + 1] ?? "");
        if (h) hosts.add(h);
        continue;
      }
      // `user@host` (ssh, scp, rsync): el host va después de la arroba, sin la ruta de scp.
      const arroba = /^[\w.+-]+@([^\s:/]+)(:.*)?$/.exec(tok);
      if (arroba) { const h = pareceHost(arroba[1]); if (h) hosts.add(h); continue; }
      if (RX_VERBO_DE_RED.test(tok)) {
        // CUALQUIER argumento con forma de host después del verbo (no sólo el primero: `curl -X POST -d x host`).
        for (const a of ts.slice(i + 1)) {
          if (a.startsWith("-") || /^[A-Z_]+=/.test(a)) continue;
          const h = pareceHost(a);
          if (h) hosts.add(h);
        }
        continue;
      }
      if (/^[^\s/]+:\d{1,5}(\/|$)/.test(tok) && !/:\/\//.test(tok)) {
        const h = pareceHost(tok);
        if (h) hosts.add(h);
      }
    }
  }
  return [...hosts];
}

/**
 * ¿El evento es uno de los DOS comandos de recuperación de `config.json`? Un solo subcomando, sin
 * `|`, `&&` ni `;`: `git checkout -- .enjambre/config.json` o `node <ruta>/scripts/init.mjs [banderas]`.
 */
export function esComandoDeRecuperacion(ev, env = process.env) {
  if (ev?.tool_name !== "Bash" && ev?.tool_name !== "PowerShell") return false;
  const cmd = String(ev.tool_input?.command ?? "").trim();
  if (subcomandos(cmd).length !== 1) return false;
  const ts = tokens(cmd);
  if (ts.length === 4 && ts[0] === "git" && ts[1] === "checkout" && ts[2] === "--" && /^(\.\/)?\.enjambre\/config\.json$/i.test(ts[3].replace(/\\/g, "/"))) return true;
  if (ts[0] === "node" && ts.slice(2).every((t) => /^--(dry-run|force|sin-settings|sin-canonico|proyecto|plantillas)$/.test(t) || !t.startsWith("-"))) {
    const script = (ts[1] ?? "").replace(/\\/g, "/");
    // Con CLAUDE_PLUGIN_ROOT en el entorno (los hooks lo reciben), SÓLO el init.mjs de ESTE plugin;
    // sin él (una prueba, otra herramienta), cualquier ruta que termine en scripts/init.mjs.
    const raizPlugin = env?.CLAUDE_PLUGIN_ROOT;
    if (raizPlugin) {
      const norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
      return norm(script) === norm(join(raizPlugin, "scripts", "init.mjs"));
    }
    return /(^|\/)scripts\/init\.mjs$/i.test(script);
  }
  return false;
}

export const respuestaDeny = (motivo) => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: motivo },
});

/** Lee todo stdin. */
export function leerStdin() {
  return new Promise((ok) => {
    let entrada = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (entrada += d));
    process.stdin.on("end", () => ok(entrada));
  });
}

/**
 * Envuelve una guardia: `decidir(ev, config, raiz)` devuelve `{ motivo }` para negar o null.
 * Sin `.enjambre/`: nada. Config rota: deny. Error adentro: deny (falla cerrado).
 */
export async function correrGuardia(nombre, decidir) {
  const entrada = await leerStdin();
  let ev;
  try {
    ev = JSON.parse(entrada);
  } catch {
    process.stdout.write(JSON.stringify(respuestaDeny(`Guardia ${nombre}: el evento del hook no es JSON (falla cerrada).`)));
    process.exit(0);
  }
  const raiz = ubicarProyecto(ev);
  if (!raiz) process.exit(0);
  let config;
  try {
    config = cargarConfig(raiz);
  } catch (err) {
    // Falta config.json: pasan EXACTAMENTE los dos comandos de recuperación (los dos escriben sin
    // pisar nada: `git checkout --` restaura lo commiteado e `init` usa `wx`). Nada más.
    if (err.faltaConfig && esComandoDeRecuperacion(ev)) process.exit(0);
    process.stdout.write(JSON.stringify(respuestaDeny(`Guardia ${nombre}: la configuración del enjambre está rota y hasta que se arregle no corre ninguna herramienta. ${err.message}`)));
    process.exit(0);
  }
  let r;
  try {
    r = decidir(ev, config, raiz);
  } catch (err) {
    r = { motivo: `la guardia falló (${err?.message ?? err}); por seguridad, se niega.` };
  }
  if (r) process.stdout.write(JSON.stringify(respuestaDeny(`Guardia ${nombre}: ${r.motivo}`)));
  process.exit(0);
}

/** ¿`process.argv[1]` es este módulo? (para que importar la guardia no la ejecute) */
export function esPrincipal(urlDelModulo) {
  const script = process.argv[1];
  if (!script) return false;
  const norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
  return norm(script) === norm(fileURLToPath(urlDelModulo));
}
