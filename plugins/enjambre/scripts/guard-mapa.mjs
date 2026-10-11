// GUARDIA: EL MAPA DEL CÓDIGO ANTES DE LEERLO. Hooks PreToolUse (pre) y PostToolUse (post).
//
//   node guard-mapa.mjs pre    → niega leer o buscar código sin una consulta reciente al mapa
//   node guard-mapa.mjs post   → anota cuándo se corrió la herramienta de mapa
//
// Copiada y adaptada de la guardia de graphify del proyecto de origen. Por qué existe: la regla
// "el mapa antes del código" estaba en CLAUDE.md, en la memoria y en cada prompt, y aun así hubo
// que recordarla cuatro veces en un día. Una regla que depende de que el agente se acuerde no es
// una regla: la hace cumplir la herramienta. Es para optimizar tokens: un subgrafo acotado es
// mucho más chico que archivos enteros o salidas de grep.
//
// Configurable en `.enjambre/config.json` → `mapa`: la herramienta (graphify u otra; `null` apaga
// la guardia), sus subcomandos, la ventana en minutos, las carpetas de código y las extensiones.
//
// Qué NO se bloquea: documentos (.md, .json, .txt), correr pruebas o scripts (`node x`),
// `git diff/log/show/status` (el auditor revisa diffs). `git grep` sí es búsqueda.
//
// Sin `.enjambre/`: no hace nada. Config rota: bloquea (comun.mjs).

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { correrGuardia, esPrincipal, leerStdin, relativaA, subcomandos, tokens, ubicarProyecto, cargarConfig } from "./lib/comun.mjs";

const RX_VERBO_LECTURA = /^\s*(?:sudo\s+)?(grep|rg|egrep|fgrep|cat|sed|head|tail|awk|less|more|Select-String|Get-Content|gc|type|findstr|bat)\b/i;
const RX_GIT_GREP = /^\s*git\b[^|;&]*\bgrep\b/i;

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿La ruta (relativa a la raíz) es código según la configuración? */
export function esRutaDeCodigo(rel, mapa) {
  // Sin distinguir mayúsculas (en Windows `SRC/A.TS` es `src/a.ts`; hallazgo del auditor sobre d75afbd).
  const r = String(rel ?? "").replace(/\\/g, "/").toLowerCase();
  if (!r) return false;
  const carpeta = mapa.rutasDeCodigo.find((c) => {
    const cc = c.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();
    return r === cc || r.startsWith(cc + "/") || new RegExp(`(^|/)${escapar(cc)}(/|$)`).test(r);
  });
  if (!carpeta) return false;
  const ultimo = r.split("/").pop();
  if (!/\.[a-z0-9]+$/i.test(ultimo)) return true; // una carpeta de código: buscar adentro es buscar en código
  return mapa.extensiones.some((e) => ultimo.toLowerCase().endsWith("." + e.toLowerCase()));
}

const rxGraphify = (mapa) => new RegExp(`\\b${escapar(mapa.herramienta)}\\s+(${mapa.subcomandos.map(escapar).join("|") || "\\S+"})\\b`);

/**
 * @returns {{ motivo } | null}  null = no opina
 */
export function decidirMapa(ev, config, raiz, ultimoMs, ahoraMs) {
  const mapa = config.mapa;
  if (!mapa.herramienta) return null;
  const ventanaMs = mapa.ventanaMinutos * 60 * 1000;
  const reciente = typeof ultimoMs === "number" && ahoraMs - ultimoMs <= ventanaMs;
  const tool = ev.tool_name;
  const inp = ev.tool_input ?? {};
  let tocaCodigo = false;
  const rxExt = new RegExp(`\\.(${mapa.extensiones.map(escapar).join("|")})\\b`, "i");
  const rxDocs = /\.(md|json|txt|log)\b/i;

  if (tool === "Read") {
    tocaCodigo = esRutaDeCodigo(relativaA(raiz, String(inp.file_path ?? "")), mapa);
  } else if (tool === "Grep") {
    const norm = (p) => resolve(p).replace(/\\/g, "/").toLowerCase();
    const esRaiz = !inp.path || norm(resolve(raiz, String(inp.path))) === norm(raiz);
    const ruta = esRaiz ? "" : relativaA(raiz, String(inp.path)).replace(/\/$/, "");
    const glob = String(inp.glob ?? "");
    const filtroDeCodigo = rxExt.test(glob) || mapa.extensiones.includes(String(inp.type ?? ""));
    const filtroDeDocs = rxDocs.test(glob) || ["md", "json"].includes(String(inp.type ?? ""));
    if (esRaiz) tocaCodigo = !filtroDeDocs; // todo el repo incluye el código, salvo que filtre sólo docs
    else if (rxDocs.test(ruta) || /(^|\/)docs$|(^|\/)docs\//.test(ruta)) tocaCodigo = false;
    else {
      // Una carpeta que CONTIENE una de código (p. ej. `supabase/` con `supabase/functions`) también cuenta.
      const contieneCodigo = mapa.rutasDeCodigo.some((c) => c.replace(/\\/g, "/").toLowerCase().startsWith(ruta.toLowerCase() + "/"));
      tocaCodigo = esRutaDeCodigo(ruta, mapa) || contieneCodigo || (filtroDeCodigo && !filtroDeDocs);
    }
  } else if (tool === "Glob") {
    const patron = String(inp.pattern ?? "");
    tocaCodigo = rxExt.test(patron) || esRutaDeCodigo(relativaA(raiz, String(inp.path ?? "")), mapa) || mapa.rutasDeCodigo.some((c) => new RegExp(`(^|/)${escapar(c.replace(/\/$/, ""))}(/|$)`).test(patron));
    if (inp.path === undefined && !patron) tocaCodigo = false;
  } else if (tool === "Bash" || tool === "PowerShell") {
    const cmd = String(inp.command ?? "");
    if (rxGraphify(mapa).test(cmd)) return null; // está corriendo el mapa: siempre pasa
    for (const sub of subcomandos(cmd)) {
      if (RX_GIT_GREP.test(sub)) {
        const ruta = sub.match(/\s--\s+(.+)$/)?.[1];
        if (!ruta || ruta.split(/\s+/).some((r) => esRutaDeCodigo(relativaA(raiz, r.replace(/["']/g, "")), mapa) || rxExt.test(r))) { tocaCodigo = true; break; }
        continue;
      }
      if (!RX_VERBO_LECTURA.test(sub)) continue;
      if (tokens(sub).some((t) => esRutaDeCodigo(relativaA(raiz, t), mapa) || (/\*/.test(t) && rxExt.test(t)))) { tocaCodigo = true; break; }
    }
  } else {
    return null;
  }

  if (!tocaCodigo || reciente) return null;
  const ej = `${mapa.herramienta} ${mapa.subcomandos[0] ?? ""} "<pregunta>"`.trim();
  return {
    motivo: `el mapa SIEMPRE antes de leer o buscar código (optimiza tokens: un subgrafo acotado es más chico que los archivos). Corré primero \`${ej}\` y después reintentá. La última consulta fue hace más de ${mapa.ventanaMinutos} minutos o no hubo ninguna.`,
  };
}

// ── Estado: la hora de la última consulta al mapa, por sesión ──
export function archivoEstado(sessionId) {
  const id = String(sessionId ?? "global").replace(/[^\w-]/g, "_");
  return join(tmpdir(), `enjambre-mapa-${id}.json`);
}
function leerUltimo(sessionId) {
  try { return JSON.parse(readFileSync(archivoEstado(sessionId), "utf8")).ultimo; } catch { return undefined; }
}
export function anotar(sessionId, ms) {
  try { writeFileSync(archivoEstado(sessionId), JSON.stringify({ ultimo: ms })); } catch { /* el pre lo verá como "nunca" */ }
}

if (esPrincipal(import.meta.url)) {
  const modo = process.argv[2];
  if (modo === "post") {
    // El post sólo anota: nunca niega nada (no es PreToolUse).
    try {
      const ev = JSON.parse(await leerStdin());
      const raiz = ubicarProyecto(ev);
      if (raiz) {
        const config = cargarConfig(raiz);
        if (config.mapa.herramienta && (ev.tool_name === "Bash" || ev.tool_name === "PowerShell") && rxGraphify(config.mapa).test(String(ev.tool_input?.command ?? ""))) {
          anotar(ev.session_id, Date.now());
        }
      }
    } catch { /* una config rota la reporta el pre */ }
    process.exit(0);
  }
  await correrGuardia("mapa", (ev, config, raiz) => decidirMapa(ev, config, raiz, leerUltimo(ev.session_id), Date.now()));
}
