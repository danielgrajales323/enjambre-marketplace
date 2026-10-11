// GUARDIA: LAS ESCRITURAS PELIGROSAS Y LOS SECRETOS. Hook PreToolUse sobre Read|Edit|Write|MultiEdit|Grep|Glob|Bash|PowerShell.
//
//   · `protegidos` (config, libro de gastos, manifiesto, settings del proyecto): ningún agente los
//     edita, los escribe, los borra ni los mueve: ni por Edit/Write, ni por la shell (redirección
//     con o sin espacio, tee, sed -i, cp, mv, rm, git rm, del, Remove-Item, Set-Content, Out-File…).
//     Los escriben sólo los scripts del enjambre o el dueño a mano. (Borrar `config.json` tampoco
//     apaga las guardias: comun.mjs niega todo si existe `.enjambre/` sin él.)
//   · `secretos` (.env y parecidos): ni leer ni escribir, por ninguna vía: Read, Grep, Glob, y en la
//     shell cualquier subcomando que los nombre (también con glob, `cat .env*`, o dentro de un
//     `node -e "...readFileSync('.env')"`) y que lea, escriba, cargue o evalúe.
//
// Sin `.enjambre/`: no hace nada. Config rota o borrada: bloquea (comun.mjs).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CARPETA_ENJAMBRE, coincideRuta, correrGuardia, esPrincipal, globARegex, problemasDeEscenario, relativaA, subcomandos, tokenAlcanza, tokens } from "./lib/comun.mjs";

/** Dónde escribe el generador sus escenarios (también `escenarios2/`, `.jsonc`): lo que entra acá pasa por la red determinista. */
const RX_ESCENARIOS = new RegExp(`^${CARPETA_ENJAMBRE.replace(".", "\\.")}/trabajo/escenarios[^/]*/.+\\.jsonc?$`, "i");
const CARPETA_ESCENARIOS = `${CARPETA_ENJAMBRE}/trabajo/escenarios`;
/** Escrituras por código dentro de un `node -e`/`python -c`: lo que escribe un archivo. */
const RX_ESCRIBE_CODIGO = /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|renameSync)\s*\(|\bopen\s*\([^)]*['"][wa]/i;

/** El JSON de un escenario sin comentarios de línea (`.jsonc`). Lanza si no parsea. */
const parsearEscenario = (texto) => JSON.parse(String(texto ?? "").replace(/^\s*\/\/.*$/gm, ""));

const RX_ESCRIBE_SHELL = /(>>?|\btee\b|Set-Content|Add-Content|Out-File|\bsed\s+-i|\bcp\b|\bmv\b|\brm\b|\bgit\s+rm\b|\bdel\b|\berase\b|Copy-Item|Move-Item|Remove-Item|\bdd\b|\btruncate\b|\bunlink\b|\bshred\b)/i;
const RX_LEE_SHELL = /\b(cat|type|Get-Content|gc|head|tail|less|more|grep|rg|egrep|fgrep|sed|awk|Select-String|source|strings|od|xxd|hexdump|zcat)\b|(^|\s)\.\s/i;
// `export`/`set`/`source` sólo como VERBO (al principio o tras un espacio, seguidos de espacio): `.env` no es `env`.
// `--env-file` (node, docker, podman) carga el secreto entero en un proceso: cuenta como leerlo.
const RX_EVALUA = /\b(node|deno|bun|python3?|ruby|perl|php)\b[^|;&]*\s(-e|--eval|-p|--print|-c)\b|(^|\s)(export|set|source)\s|\$\(<|<\s*\S|--env-file(=|\s)/i;
// Lo que BORRA, MUEVE o RENOMBRA una carpeta: por la shell, por PowerShell, por git, por find o por un `fs` de node.
const RX_DESTRUYE = /(^|\s)(rm|rmdir|rd|mv|del|erase|ri|rni|mi|Remove-Item|Rename-Item|Move-Item)\b|\bgit\s+(rm|mv)\b|\bfind\b[^|;&]*\s-(delete|exec\s+rm)\b|\b(rmSync|rmdirSync|renameSync|unlinkSync|rm|rmdir|rename)\s*\(|\bshutil\.(rmtree|move)\b|\bos\.(remove|rename|rmdir)\b/i;

/** ¿El token ES la carpeta `.enjambre` (no algo adentro)? Con comillas, `./`, `.\`, barra final, mayúsculas, ruta absoluta, o dentro de código (`'.enjambre',{…})`). */
function esLaCarpeta(token) {
  const t = String(token ?? "").replace(/[,)].*$/, "").replace(/^["'`]+|["'`]+$/g, "").replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\.\//, "").toLowerCase();
  return t === CARPETA_ENJAMBRE || t.endsWith(`/${CARPETA_ENJAMBRE}`);
}

/** La carpeta como literal dentro de código (`rmSync('.enjambre', …)`, `shutil.rmtree("./.enjambre/")`). */
const RX_LITERAL_CARPETA = new RegExp(`['"\`](\\./)?${CARPETA_ENJAMBRE.replace(".", "\\.")}/?['"\`]`, "i");

const esProtegido = (rel, config) => config.protegidos.some((p) => coincideRuta(rel, p));
const esSecreto = (rel, config) => config.secretos.some((p) => coincideRuta(rel, p));

/** ¿El subcomando NOMBRA un secreto en cualquier parte (token, glob, dentro de comillas o de código)? */
function nombraSecreto(sub, config) {
  for (const p of config.secretos) {
    const rx = new RegExp(`(^|[\\s"'\`(=/\\\\])${globARegex(p)}(?=$|[\\s"'\`)*;|&,/])`, "i");
    if (rx.test(sub.replace(/\\/g, "/"))) return p;
    if (tokens(sub).some((t) => tokenAlcanza(t, p))) return p;
  }
  return null;
}

export function decidir(ev, config, raiz) {
  const tool = ev.tool_name;
  const inp = ev.tool_input ?? {};
  if (tool === "Read" || tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
    const rel = relativaA(raiz, String(inp.file_path ?? ""));
    if (esSecreto(rel, config)) return { motivo: `${rel} es un secreto (secretos en .enjambre/config.json): ningún agente lo lee ni lo escribe.` };
    if (tool !== "Read" && esProtegido(rel, config)) return { motivo: `${rel} está protegido (protegidos en .enjambre/config.json): lo escriben sólo los scripts del enjambre o el dueño a mano.` };
    // LA RED DETERMINISTA DE SEGURIDAD: un escenario de autorización/aislamiento/RLS no se escribe sin
    // la autorización del dueño. El prompt del generador lo dice; esto lo hace cumplir el código.
    if ((tool === "Write" || tool === "Edit" || tool === "MultiEdit") && RX_ESCENARIOS.test(rel.replace(/\\/g, "/"))) {
      let texto;
      if (tool === "Write") texto = String(inp.content ?? "");
      else {
        // Edit: el contenido que QUEDARÍA (cambiar la categoría de un escenario existente también cuenta).
        let actual;
        try { actual = readFileSync(resolve(raiz, rel), "utf8"); } catch { return { motivo: `${rel}: no se puede leer el escenario que se edita (falla cerrada).` }; }
        const cambios = tool === "Edit" ? [inp] : (inp.edits ?? []);
        texto = actual;
        for (const c of cambios) {
          const viejo = String(c.old_string ?? "");
          texto = c.replace_all ? texto.split(viejo).join(String(c.new_string ?? "")) : texto.replace(viejo, String(c.new_string ?? ""));
        }
      }
      let escenario;
      try { escenario = parsearEscenario(texto); } catch { return { motivo: `${rel}: un escenario tiene que ser JSON válido con su categoría (falla cerrada).` }; }
      const p = problemasDeEscenario(escenario, config);
      if (p.length) return { motivo: `${rel}: ${p.join("; ")}` };
    }
    return null;
  }
  if (tool === "Grep" || tool === "Glob") {
    const rel = inp.path ? relativaA(raiz, String(inp.path)) : "";
    if (rel && esSecreto(rel, config)) return { motivo: `${rel} es un secreto: no se busca adentro.` };
    const patron = `${inp.glob ?? ""} ${inp.pattern ?? ""}`;
    const s = config.secretos.find((p) => tokens(patron).some((t) => tokenAlcanza(t, p)));
    if (s) return { motivo: `el patrón alcanza un secreto (${s}): no se busca ni se lista.` };
    return null;
  }
  if (tool !== "Bash" && tool !== "PowerShell") return null;
  for (const sub of subcomandos(String(inp.command ?? ""))) {
    const ts = tokens(sub);
    // LA CARPETA `.enjambre/` MISMA (hallazgo del auditor sobre c858f02): borrarla, moverla o
    // renombrarla apaga todas las guardias. Cualquier token que la alcance (mayúsculas, barras, dentro
    // de comillas o de código) con un verbo que destruye → deny.
    if (RX_DESTRUYE.test(sub) && (ts.some((t) => esLaCarpeta(t)) || RX_LITERAL_CARPETA.test(sub.replace(/\\/g, "/")))) {
      return { motivo: `el comando borra, mueve o renombra la carpeta ${CARPETA_ENJAMBRE}/: eso apagaría las guardias del enjambre. La saca el dueño, a mano, fuera de las herramientas.` };
    }
    // Los escenarios se escriben SÓLO con Write (donde la guardia los revisa): por la shell o por código, no.
    const tocaEscenarios = ts.some((t) => tokenAlcanza(t, CARPETA_ESCENARIOS)) || new RegExp(`['"\`][^'"\`]*${CARPETA_ESCENARIOS.replace(".", "\\.")}`, "i").test(sub.replace(/\\/g, "/"));
    if (tocaEscenarios && (RX_ESCRIBE_SHELL.test(sub) || RX_ESCRIBE_CODIGO.test(sub))) {
      return { motivo: `los escenarios (${CARPETA_ESCENARIOS}/) se escriben sólo con la herramienta Write, donde la guardia revisa la categoría y la autorización del dueño; no por la shell ni por código.` };
    }
    const rutas = ts.map((t) => relativaA(raiz, t.replace(/^[<>]+/, "").replace(/^["']|["']$/g, "")));
    const secreto = nombraSecreto(sub, config);
    if (secreto && (RX_LEE_SHELL.test(sub) || RX_ESCRIBE_SHELL.test(sub) || RX_EVALUA.test(sub))) {
      return { motivo: `el comando toca un secreto (${secreto}): ni leerlo, ni escribirlo, ni cargarlo por la shell.` };
    }
    const protegido = rutas.find((r) => esProtegido(r, config)) ?? (config.protegidos.find((p) => ts.some((t) => tokenAlcanza(t, p))) ?? null);
    if (protegido && RX_ESCRIBE_SHELL.test(sub)) {
      return { motivo: `el comando escribe, borra o mueve un archivo protegido (${protegido}) por la shell. Lo escriben sólo los scripts del enjambre o el dueño a mano.` };
    }
  }
  return null;
}

if (esPrincipal(import.meta.url)) await correrGuardia("escrituras", decidir);
