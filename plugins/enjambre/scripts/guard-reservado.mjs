// GUARDIA: EL SET RESERVADO ES ILEGIBLE (lo que la guardia puede). Hook PreToolUse sobre
// Read|Edit|MultiEdit|Grep|Glob|Bash|PowerShell.
//
// Si el que arregla ve los casos reservados, el número final no vale nada y desde afuera no se
// nota. Esta guardia DIFICULTA leerlo; NO lo impide (una herramienta no puede impedirlo todo: un
// `bash -c`, un alias, un script que lo lea por dentro). La protección de FONDO son dos cosas que
// no dependen de la guardia:
//   1. el contenido reservado se guarda COMPRIMIDO (`.json.gz`, `escribirReservado` en
//      lib/corteReservado.mjs): un grep, un `git log -p` o un `cat` no muestran texto legible;
//   2. la regla de que ningún builder lo abre, y el auditor lo revisa en el transcript.
//
// Lo que corta (ronda del auditor sobre d75afbd):
//   · Read / Edit / MultiEdit de un archivo dentro de `reservado.ruta`;
//   · Grep con `path` DENTRO del reservado o en un ANCESTRO suyo (la raíz, `.enjambre`, `.`), o sin
//     `path`, salvo que el `glob` o el `type` lo excluyan (sólo documentos: md, txt);
//   · Glob cuyo patrón o `path` alcance la carpeta;
//   · en la shell, cualquier subcomando que NOMBRE la carpeta (también con glob: `res*/x`, y con
//     mayúsculas o barras invertidas), salvo `git add|commit|status|ls-files|rm --cached` y correr un
//     script de `reservado.lectoresAutorizados` (nunca con `-e`/`--eval`);
//   · en la shell, los LECTORES RECURSIVOS sin una ruta que excluya el reservado: `grep -r`, `rg`,
//     `git grep`, `git log -p`, `git show`, `git diff`, `find … -exec cat`, `tar`, `zip`. Pasan si
//     todas sus rutas quedan fuera del reservado o si llevan un pathspec `:!<reservado>`.
//
// Sin `.enjambre/`: no hace nada. Config rota o borrada: bloquea (comun.mjs).

import { correrGuardia, dentroDe, esPrincipal, relativaA, relativaORaiz, subcomandos, tokenAlcanza, tokens } from "./lib/comun.mjs";

const MOTIVO = (ruta) => `el set reservado (${ruta}) no lo lee nadie hasta la corrida final. Si necesitás saber algo de él, que lo calcule un script autorizado (reservado.lectoresAutorizados) y devuelva sólo números.`;
const MOTIVO_RECURSIVO = (ruta, que) => `${que} sin una ruta que excluya el set reservado (${ruta}) lo barrería también. Pasá una ruta fuera del reservado, o el pathspec \`-- . ':!${ruta}'\`.`;

const RX_GIT_PERMITIDO = /^\s*git\s+(add|commit|status|ls-files|rm\s+--cached)\b/i;
const RX_DOCS = /\.(md|txt)\b/i;

const normal = (s) => String(s ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "").toLowerCase();

/** ¿`ruta` (relativa) es el reservado, está adentro, o es un ancestro suyo (la raíz incluida)? */
function alcanzaOContiene(rel, rutaReservado) {
  const r = normal(rel);
  const v = normal(rutaReservado);
  if (r === "" || r === ".") return true; // la raíz contiene al reservado
  return dentroDe(r, v) || v === r || v.startsWith(`${r}/`);
}

/** El subcomando nombra la carpeta reservada (también con glob, mayúsculas o barras invertidas). */
function nombraReservado(sub, rutaReservado) {
  return tokens(sub).some((t) => tokenAlcanza(t, rutaReservado) || tokenAlcanza(t.replace(/^[a-z]+:/i, ""), rutaReservado));
}

function esLectorAutorizado(sub, lectores, raiz) {
  const ts = tokens(sub);
  const i = ts.findIndex((t) => /^(node|tsx|deno|bun)$/i.test(t));
  if (i < 0) return false;
  const resto = ts.slice(i + 1).filter((t) => !/^(run|--import|--loader)$/.test(t));
  if (resto.some((t) => /^(-e|--eval|-p|--print)$/.test(t))) return false;
  const script = resto.find((t) => !t.startsWith("-"));
  if (!script) return false;
  const rel = relativaA(raiz, script);
  return lectores.some((l) => dentroDe(rel, l) && !dentroDe(l, rel + "/x"));
}

/** Un lector RECURSIVO y las rutas que le pasaron (sin banderas). null si el subcomando no es uno. */
/** Los tokens de un `git …` sin sus opciones globales (`-C dir`, `-c k=v`, `--no-pager`, `--git-dir=…`): [git, subcomando, …]. */
function sinOpcionesGlobalesDeGit(ts) {
  const i0 = ts[0].toLowerCase() === "sudo" ? 1 : 0;
  if ((ts[i0] ?? "").toLowerCase() !== "git") return ts;
  let i = i0 + 1;
  while (i < ts.length && ts[i].startsWith("-")) i += /^(-C|-c)$/.test(ts[i]) ? 2 : 1;
  return ["git", ...ts.slice(i)];
}

function lectorRecursivo(sub) {
  const ts = sinOpcionesGlobalesDeGit(tokens(sub));
  const s = ts.join(" ");
  let que = null;
  let rutas = [];
  if (/^git\s+grep\b/i.test(s)) { que = "git grep"; rutas = despuesDe(ts, "--"); }
  else if (/^git\s+log\b/i.test(s) && ts.some((t) => /^(-p|--patch|-u|--stat|--cc|--full-diff)$/.test(t) || /^-[a-zA-Z]*p[a-zA-Z]*$/.test(t))) { que = "git log -p"; rutas = despuesDe(ts, "--"); }
  else if (/^git\s+format-patch\b/i.test(s)) { que = "git format-patch"; rutas = despuesDe(ts, "--"); }
  else if (/^git\s+(show|diff)\b/i.test(s)) { que = `git ${ts[1].toLowerCase()}`; rutas = despuesDe(ts, "--").length ? despuesDe(ts, "--") : ts.slice(2).filter((t) => !t.startsWith("-") && !/^[0-9a-f]{6,40}$/i.test(t) && !/^(HEAD|origin|master|main)/.test(t)); }
  else if (/^(sudo\s+)?(grep|egrep|fgrep)\b/i.test(s) && ts.some((t) => /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t) || /^--(recursive|dereference-recursive)$/.test(t))) { que = "grep -r"; rutas = ts.slice(1).filter((t) => !t.startsWith("-")).slice(1); }
  else if (/^(sudo\s+)?rg\b/i.test(s)) { que = "rg"; rutas = ts.slice(1).filter((t) => !t.startsWith("-")).slice(1); }
  else if (/^(sudo\s+)?find\b/i.test(s) && /\b(cat|zcat|gunzip|head|tail|less|more|sed|awk)\b/i.test(s)) { que = "find … -exec"; rutas = ts.slice(1).filter((t) => !t.startsWith("-") && !/^(cat|zcat|gunzip|head|tail|less|more|sed|awk|\{\}|\\;|\+)$/.test(t)).slice(0, 1); }
  else if (/^(sudo\s+)?(tar|zip|7z)\b/i.test(s)) { que = ts[0].toLowerCase(); rutas = ts.slice(1).filter((t, i) => !t.startsWith("-") && !(i === 0 && /^[a-z]{1,6}$/.test(t)) && !/\.(tar|gz|tgz|zip|7z)$/i.test(t)); }
  else if (/^(Select-String|Get-ChildItem|gci|ls)\b/i.test(s) && ts.some((t) => /^-(Recurse|r|R)$/i.test(t))) { que = ts[0]; rutas = ts.slice(1).filter((t) => !t.startsWith("-")); }
  if (!que) return null;
  return { que, rutas, excluye: ts.some((t) => /^:(!|\(exclude\))/.test(t.replace(/^["']|["']$/g, ""))) ? ts.filter((t) => /^:(!|\(exclude\))/.test(t.replace(/^["']|["']$/g, ""))) : [] };
}

function despuesDe(ts, sep) {
  const i = ts.indexOf(sep);
  return i < 0 ? [] : ts.slice(i + 1);
}

export function decidir(ev, config, raiz) {
  const tool = ev.tool_name;
  const rutaReservado = config.reservado.ruta;
  const inp = ev.tool_input ?? {};
  if (tool === "Read" || tool === "Edit" || tool === "MultiEdit") {
    const rel = relativaA(raiz, String(inp.file_path ?? ""));
    if (dentroDe(rel, rutaReservado)) return { motivo: MOTIVO(rutaReservado) };
    return null;
  }
  if (tool === "Grep") {
    const glob = String(inp.glob ?? "");
    const tipo = String(inp.type ?? "");
    const soloDocs = RX_DOCS.test(glob) || ["md", "txt"].includes(tipo);
    if (tokenAlcanza(glob, rutaReservado) || tokenAlcanza(String(inp.pattern ?? ""), rutaReservado)) return { motivo: MOTIVO(rutaReservado) };
    const rel = relativaORaiz(raiz, inp.path);
    if (alcanzaOContiene(rel, rutaReservado) && !soloDocs) {
      return { motivo: `un Grep en ${rel || "la raíz"} barre también ${rutaReservado}. Pasá una ruta fuera del reservado, o filtrá a documentos (glob *.md).` };
    }
    return null;
  }
  if (tool === "Glob") {
    const patron = String(inp.pattern ?? "");
    const rel = relativaORaiz(raiz, inp.path);
    if (tokenAlcanza(patron, rutaReservado) || (rel && dentroDe(rel, rutaReservado))) return { motivo: MOTIVO(rutaReservado) };
    // Un patrón recursivo desde un ancestro lista los archivos del reservado (los nombres, no el texto): se niega igual.
    if (/\*\*/.test(patron) && alcanzaOContiene(rel, rutaReservado) && !RX_DOCS.test(patron)) return { motivo: MOTIVO(rutaReservado) };
    return null;
  }
  if (tool !== "Bash" && tool !== "PowerShell") return null;
  for (const sub of subcomandos(String(inp.command ?? ""))) {
    if (nombraReservado(sub, rutaReservado)) {
      if (RX_GIT_PERMITIDO.test(sub)) continue;
      if (esLectorAutorizado(sub, config.reservado.lectoresAutorizados, raiz)) continue;
      const lr = lectorRecursivo(sub);
      if (lr && lr.excluye.some((e) => tokenAlcanza(e.replace(/^["']|["']$/g, "").replace(/^:(!|\(exclude\))/, ""), rutaReservado))) continue; // `:!reservado`
      return { motivo: MOTIVO(rutaReservado) };
    }
    const lr = lectorRecursivo(sub);
    if (!lr) continue;
    const rutasReales = lr.rutas.filter((r) => !/^:(!|\(exclude\))/.test(r));
    if (!rutasReales.length || rutasReales.some((r) => alcanzaOContiene(relativaORaiz(raiz, r.replace(/^["']|["']$/g, "")), rutaReservado))) {
      return { motivo: MOTIVO_RECURSIVO(rutaReservado, lr.que) };
    }
  }
  return null;
}

if (esPrincipal(import.meta.url)) await correrGuardia("reservado", decidir);
