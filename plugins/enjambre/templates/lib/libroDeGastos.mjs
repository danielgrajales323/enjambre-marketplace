// EL LIBRO DE GASTOS DEL ENJAMBRE. Sólo disco local y git; nada de red ni de modelo.
//
// Pieza genérica, copiada y adaptada de `libroDeGastos.ts` del proyecto de origen.
//
// ═══ LAS REGLAS ═══
//   · TOPE DURO (`topes.topeUsd`) para todo el enjambre, acumulado entre corridas.
//   · Una RESERVA (`topes.reservaFinalUsd`) queda para la corrida final sobre el set reservado:
//     los ciclos pueden gastar hasta tope − reserva; sólo una corrida marcada `--corrida-final`
//     usa la reserva, y una sola vez por libro (otra necesita `--repetir-final`, que la pone el
//     supervisor y queda registrada).
//   · AVISO (`topes.avisoUsd`): pasado ese monto, la corrida siguiente NO arranca sin
//     `--sigue-despues-del-aviso`. Esa bandera la pone SÓLO el supervisor, después de que contesta
//     el dueño. Sin la bandera una corrida tampoco puede CRUZAR el aviso: su tope se recorta.
//   · Una corrida cuya estimación proyecta pasarse del límite que le toca NO arranca.
//
// ═══ DÓNDE VIVEN LOS TOPES ═══
// En `.enjambre/config.json` (`gasto`), que es un archivo PROTEGIDO por la guardia del plugin:
// ningún agente lo edita. El libro (`gastos.json`) lleva sólo las corridas: un campo de más en la
// raíz lo invalida (editar el libro no puede subir el techo).
//
// ═══ DOS COPIAS: EL CANÓNICO Y EL ESPEJO ═══
//   · El CANÓNICO vive en el directorio común de git (`git rev-parse --git-common-dir`,
//     `<común>/<carpetaCanonico>/gastos.json`): uno solo por máquina y por repo, compartido por
//     TODOS los worktrees, y fuera del árbol de trabajo (checkout, stash y reset no lo tocan). Si
//     no se puede leer o escribir, NO arranca nada.
//   · El ESPEJO es el JSON commiteado: lleva el gasto a otras máquinas y a la historia de git. El
//     libro efectivo es la FUSIÓN de los dos por id de corrida (de cada id cuenta la versión que
//     más cuenta): el acumulado nunca es menor que el de ninguna de las dos copias.
//
// ═══ EL CANDADO ═══
// `gastos.lock` en la carpeta del canónico (nunca en `os.tmpdir()`: con TEMP distintos dos
// procesos no se verían). Toda la sección leer → evaluar → escribir va adentro. Un candado de un
// proceso muerto se reemplaza con una toma exclusiva; si no se puede, no arranca.
//
// Falla CERRADO: un libro que falta, que no se puede leer o que tiene una entrada rara, NO arranca
// nada. Borrarlo no "resetea" el gasto; el canónico se crea a conciencia, una vez
// (`crearLibroCanonico`), y nunca se pisa.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const BANDERA_CORRIDA_FINAL = "--corrida-final";
export const BANDERA_REPETIR_FINAL = "--repetir-final";
export const BANDERA_SIGUE_DESPUES_DEL_AVISO = "--sigue-despues-del-aviso";

/** Lo que pueden sumar las llamadas que ya estaban en vuelo cuando el tope corta. */
export const MARGEN_ULTIMAS_LLAMADAS_USD_POR_DEFECTO = 0.5;

export class LibroInvalido extends Error {
  constructor(msg) {
    super(msg);
    this.name = "LibroInvalido";
  }
}

const ESTADOS = ["en_curso", "terminada", "cortada"];
const numeroValido = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
const usd = (x) => `US$${x.toFixed(2)}`;

/** Valida los topes de la configuración. Lanza si están mal (no se arranca con topes raros). */
export function validarTopes(t) {
  if (!t || typeof t !== "object") throw new LibroInvalido("faltan los topes (gasto en .enjambre/config.json)");
  for (const k of ["topeUsd", "avisoUsd", "reservaFinalUsd"]) {
    if (!numeroValido(t[k])) throw new LibroInvalido(`el tope ${k} no es un número válido`);
  }
  if (t.avisoUsd > t.topeUsd) throw new LibroInvalido("el aviso no puede ser mayor que el tope");
  if (t.reservaFinalUsd >= t.topeUsd) throw new LibroInvalido("la reserva final tiene que ser menor que el tope");
  const margen = t.margenUsd ?? MARGEN_ULTIMAS_LLAMADAS_USD_POR_DEFECTO;
  if (!numeroValido(margen)) throw new LibroInvalido("el margen no es un número válido");
  return { topeUsd: t.topeUsd, avisoUsd: t.avisoUsd, reservaFinalUsd: t.reservaFinalUsd, margenUsd: margen, topeCiclosUsd: t.topeUsd - t.reservaFinalUsd };
}

/** Valida la forma del libro. Cualquier cosa rara lanza `LibroInvalido` (falla cerrado). */
export function validarLibro(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new LibroInvalido("el libro no es un objeto");
  const sobran = Object.keys(x).filter((k) => k !== "_regla" && k !== "corridas");
  if (sobran.length) throw new LibroInvalido(`campos que el libro no lleva: ${sobran.join(", ")} (los topes viven en la configuración, no acá)`);
  if (!Array.isArray(x.corridas)) throw new LibroInvalido("falta la lista `corridas`");
  const ids = new Set();
  x.corridas.forEach((r, i) => {
    const donde = `corridas[${i}]`;
    if (!r || typeof r !== "object") throw new LibroInvalido(`${donde} no es un objeto`);
    if (typeof r.id !== "string" || !r.id) throw new LibroInvalido(`${donde} sin id`);
    if (ids.has(r.id)) throw new LibroInvalido(`${donde} repite el id ${r.id}`);
    ids.add(r.id);
    if (!ESTADOS.includes(r.estado)) throw new LibroInvalido(`${donde} con estado desconocido: ${String(r.estado)}`);
    if (!numeroValido(r.estimadoUsd) || !numeroValido(r.topeUsd)) throw new LibroInvalido(`${donde} con estimado o tope inválido`);
    if (r.estado === "en_curso") {
      if (r.gastadoUsd !== null && !numeroValido(r.gastadoUsd)) throw new LibroInvalido(`${donde} con gasto inválido`);
    } else if (!numeroValido(r.gastadoUsd)) {
      throw new LibroInvalido(`${donde} cerrada sin un gasto válido`);
    }
    if (typeof r.corridaFinal !== "boolean" || typeof r.repitioFinal !== "boolean" || typeof r.siguioDespuesDelAviso !== "boolean") {
      throw new LibroInvalido(`${donde} sin las banderas corridaFinal / repitioFinal / siguioDespuesDelAviso`);
    }
  });
  return x;
}

/** Lo que cuenta UNA entrada: si está en curso (o murió sin cerrar), su tope entero. */
export function cuentaUsd(e) {
  return e.estado === "en_curso" ? Math.max(e.topeUsd, e.gastadoUsd ?? 0) : (e.gastadoUsd ?? 0);
}

export function acumuladoUsd(libro) {
  return libro.corridas.reduce((s, e) => s + cuentaUsd(e), 0);
}

/** Une dos copias por id: de cada id queda la versión que MÁS cuenta (nunca de menos). Pura. */
export function fusionarLibros(a, b) {
  const porId = new Map();
  for (const e of [...a.corridas, ...b.corridas]) {
    const ya = porId.get(e.id);
    if (!ya || cuentaUsd(e) > cuentaUsd(ya)) porId.set(e.id, e);
  }
  const libro = { corridas: [...porId.values()] };
  const regla = a._regla ?? b._regla;
  return regla === undefined ? libro : { _regla: regla, ...libro };
}

/**
 * Decide si la corrida arranca y con qué tope. Pura: no lee ni escribe nada.
 * @param pedido { estimadoUsd, topeUsd, corridaFinal, repetirFinal, sigueDespuesDelAviso }
 */
export function evaluarArranque(libro, p, topesCrudos) {
  const t = validarTopes(topesCrudos);
  const acumulado = acumuladoUsd(libro);
  const no = (limiteUsd, motivo) => ({ ok: false, motivo, limiteUsd, acumuladoUsd: acumulado });

  if (p.repetirFinal && !p.corridaFinal) return no(0, `${BANDERA_REPETIR_FINAL} sólo va junto con ${BANDERA_CORRIDA_FINAL}.`);
  if (p.corridaFinal && !p.repetirFinal) {
    const previa = libro.corridas.find((e) => e.corridaFinal);
    if (previa) {
      return no(0, `El libro ya tiene una corrida final (${previa.id}, ${previa.estado}). Hay UNA sola por libro: otra necesita ${BANDERA_REPETIR_FINAL}, que pone SÓLO el supervisor y queda registrada.`);
    }
  }
  if (acumulado > t.avisoUsd && !p.sigueDespuesDelAviso) {
    return no(t.avisoUsd, `El enjambre ya gastó ${usd(acumulado)}: pasó el aviso de ${usd(t.avisoUsd)}. La corrida siguiente no arranca sin ${BANDERA_SIGUE_DESPUES_DEL_AVISO}, que pone SÓLO el supervisor después de que contesta el dueño.`);
  }
  let limite = p.corridaFinal ? t.topeUsd : t.topeCiclosUsd;
  if (!p.sigueDespuesDelAviso) limite = Math.min(limite, t.avisoUsd);
  const disponible = limite - acumulado - t.margenUsd;
  if (!(p.estimadoUsd <= disponible)) {
    const pista = !p.sigueDespuesDelAviso && limite === t.avisoUsd
      ? ` Cruzar los ${usd(t.avisoUsd)} necesita ${BANDERA_SIGUE_DESPUES_DEL_AVISO} (la pone el supervisor, con la respuesta del dueño).`
      : !p.corridaFinal && limite === t.topeCiclosUsd
        ? ` Los ciclos llegan hasta ${usd(t.topeCiclosUsd)}: los ${usd(t.reservaFinalUsd)} restantes son de la corrida final (${BANDERA_CORRIDA_FINAL}).`
        : ` El tope duro del enjambre es ${usd(t.topeUsd)}.`;
    return no(limite, `La corrida proyecta pasarse: ya gastado ${usd(acumulado)} + estimado ${usd(p.estimadoUsd)} > límite ${usd(limite)} (menos ${usd(t.margenUsd)} de margen para las llamadas en vuelo).${pista}`);
  }
  const tope = Math.floor(Math.min(p.topeUsd, disponible) * 100) / 100;
  if (!(tope > 0)) return no(limite, `No queda presupuesto para un tope mayor que cero (disponible ${usd(disponible)}).`);
  return { ok: true, topeUsd: tope, limiteUsd: limite, acumuladoUsd: acumulado };
}

/** ¿`script` (el `process.argv[1]` REAL) es el script autorizado para la corrida final? */
export function esScriptCorridaFinal(script, rutaAutorizada) {
  if (!script || !rutaAutorizada) return false;
  const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(script) === norm(rutaAutorizada);
}

/** Lee y valida UNA copia. Si no existe o no se puede leer, lanza: NUNCA se toma como vacío. */
export function leerLibro(ruta) {
  if (!existsSync(ruta)) throw new LibroInvalido(`no existe el libro de gastos ${ruta} (no se toma como vacío: borrarlo no resetea el gasto)`);
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(ruta, "utf8"));
  } catch (err) {
    throw new LibroInvalido(`el libro de gastos ${ruta} no se pudo leer o no es JSON válido: ${String(err).slice(0, 120)}`);
  }
  return validarLibro(crudo);
}

/** La ruta del canónico: `<directorio común de git>/<carpeta>/gastos.json`. Sin git, lanza. */
export function rutaLibroCanonico(dirRepo = process.cwd(), carpeta = "enjambre") {
  let comun;
  try {
    comun = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: dirRepo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    throw new LibroInvalido(`no pude ubicar el directorio común de git desde ${dirRepo} (el libro canónico vive ahí): ${String(err).slice(0, 120)}`);
  }
  if (!comun) throw new LibroInvalido(`git no devolvió el directorio común desde ${dirRepo}`);
  return join(isAbsolute(comun) ? comun : resolve(dirRepo, comun), carpeta, "gastos.json");
}

/** Las dos copias: el espejo dado y el canónico del repo que lo contiene. */
export function rutasLibro(espejo, carpeta = "enjambre") {
  const abs = resolve(espejo);
  return { canonico: rutaLibroCanonico(dirname(abs), carpeta), espejo: abs };
}

/** El libro EFECTIVO: el canónico (obligatorio) fusionado con el espejo (si está). */
export function leerLibroEfectivo(r) {
  const canonico = leerLibro(r.canonico);
  if (!existsSync(r.espejo)) return canonico;
  return fusionarLibros(canonico, leerLibro(r.espejo));
}

// ── El candado del libro ──────────────────────────────────────────────────────

export const ESPERA_CANDADO_LIBRO_MS = 5_000;
const CANDADO_RECIEN_CREADO_MS = 10_000;

export const rutaCandadoLibro = (r) => join(dirname(r.canonico), "gastos.lock");

const candadosTomados = new Set();
const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const procesoVivo = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
};

function candadoAbandonado(candado) {
  let crudo;
  try { crudo = readFileSync(candado, "utf8"); } catch { return false; }
  let dueno = null;
  try { dueno = JSON.parse(crudo); } catch { /* ilegible: abajo */ }
  if (dueno && typeof dueno.pid === "number") return !procesoVivo(dueno.pid);
  try { return Date.now() - statSync(candado).mtimeMs >= CANDADO_RECIEN_CREADO_MS; } catch { return false; }
}

function tomaAbandonada(toma) {
  let crudo;
  try { crudo = readFileSync(toma, "utf8").trim(); } catch { return false; }
  const pid = Number(crudo);
  if (crudo && Number.isInteger(pid) && pid > 0) return !procesoVivo(pid);
  try { return Date.now() - statSync(toma).mtimeMs >= CANDADO_RECIEN_CREADO_MS; } catch { return false; }
}

function soltarTomaPropia(toma) {
  for (let i = 0; i < 20; i++) {
    try {
      if (readFileSync(toma, "utf8").trim() !== String(process.pid)) return;
      unlinkSync(toma);
      return;
    } catch (err) {
      if (err?.code === "ENOENT") return;
      dormir(10);
    }
  }
}

/** Reemplaza un candado abandonado con una toma exclusiva. true sólo si el muerto ya no está. */
function reemplazarAbandonado(candado) {
  const toma = `${candado}.toma`;
  try {
    writeFileSync(toma, String(process.pid), { flag: "wx" });
  } catch (err) {
    if (err?.code === "EEXIST" && tomaAbandonada(toma)) {
      throw new LibroInvalido(`el candado del libro ${candado} quedó de un proceso muerto y su reemplazo también (${toma}): no se borra solo. Revisar que no haya ninguna corrida viva y borrar a mano ${toma} y ${candado}.`);
    }
    return false;
  }
  try {
    if (!candadoAbandonado(candado)) return false;
    try {
      unlinkSync(candado);
    } catch (err) {
      if (err?.code !== "ENOENT") return false;
    }
    return true;
  } finally {
    soltarTomaPropia(toma);
  }
}

const esContencion = (err) => ["EEXIST", "EPERM", "EBUSY", "EACCES"].includes(err?.code ?? "");

function describirDueno(candado) {
  try {
    const d = JSON.parse(readFileSync(candado, "utf8"));
    return `pid ${d.pid ?? "?"}, desde ${d.desde ?? "?"}`;
  } catch {
    return "dueño ilegible";
  }
}

/** Corre `f` con el candado del libro tomado. Reentrante en el mismo proceso. Síncrona. */
export function conCandadoDelLibro(r, f, esperaMs = ESPERA_CANDADO_LIBRO_MS) {
  const candado = rutaCandadoLibro(r);
  if (candadosTomados.has(candado)) return f();
  const contenido = JSON.stringify({ pid: process.pid, desde: new Date().toISOString() });
  const limite = Date.now() + esperaMs;
  for (;;) {
    try {
      writeFileSync(candado, contenido, { flag: "wx" });
      break;
    } catch (err) {
      if (err?.code === "ENOENT") throw new LibroInvalido(`no pude tomar el candado del libro ${candado}: no existe la carpeta del canónico`);
      if (!esContencion(err)) throw new LibroInvalido(`no pude tomar el candado del libro ${candado}: ${String(err).slice(0, 120)}`);
    }
    if (candadoAbandonado(candado) && reemplazarAbandonado(candado) && Date.now() < limite) continue;
    if (Date.now() >= limite) {
      if (candadoAbandonado(candado)) {
        throw new LibroInvalido(`el candado del libro ${candado} quedó de un proceso muerto (${describirDueno(candado)}) y no se pudo borrar en ${esperaMs} ms. Revisar qué lo tiene abierto y borrarlo a mano.`);
      }
      throw new LibroInvalido(`el libro de gastos está tomado por otro proceso (${describirDueno(candado)}) hace más de ${esperaMs} ms: no se lee ni se escribe a la vez.`);
    }
    dormir(20 + (process.pid % 30));
  }
  candadosTomados.add(candado);
  try {
    return f();
  } finally {
    candadosTomados.delete(candado);
    try {
      const actual = JSON.parse(readFileSync(candado, "utf8"));
      if (actual.pid === process.pid) unlinkSync(candado);
    } catch { /* ya no está */ }
  }
}

const escribirUna = (ruta, libro) => writeFileSync(ruta, JSON.stringify(libro, null, 2) + "\n");

/** Escribe las dos copias. El canónico primero (su carpeta NO se crea acá: si falta, lanza). */
function escribirAmbos(r, libro) {
  try {
    escribirUna(r.canonico, libro);
  } catch (err) {
    throw new LibroInvalido(`no pude escribir el libro canónico ${r.canonico}: ${String(err).slice(0, 120)}`);
  }
  try {
    mkdirSync(dirname(r.espejo), { recursive: true });
    escribirUna(r.espejo, libro);
  } catch (err) {
    throw new LibroInvalido(`no pude escribir el espejo ${r.espejo}: ${String(err).slice(0, 120)}`);
  }
}

/** Crea el canónico a partir del espejo, UNA vez. Si ya existe, lanza: nunca lo pisa. */
export function crearLibroCanonico(r) {
  if (existsSync(r.canonico)) throw new LibroInvalido(`el libro canónico ya existe (${r.canonico}): no se pisa`);
  const espejo = leerLibro(r.espejo);
  mkdirSync(dirname(r.canonico), { recursive: true });
  writeFileSync(r.canonico, JSON.stringify(espejo, null, 2) + "\n", { flag: "wx" });
  return espejo;
}

/**
 * LA ENTRADA DE UNA CORRIDA: decide con `evaluarArranque` y, si arranca, la anota con el tope
 * entero como gasto comprometido. Todo dentro del candado. Devuelve `{ ok, id?, topeUsd?, motivo? }`.
 * @param d { nombre, estimadoUsd, topeUsd, corridaFinal, repetirFinal, sigueDespuesDelAviso, inicio? }
 */
export function abrirCorrida(r, d, topes) {
  return conCandadoDelLibro(r, () => {
    const libro = leerLibroEfectivo(r);
    const decision = evaluarArranque(libro, d, topes);
    if (!decision.ok) return decision;
    const inicio = d.inicio ?? new Date().toISOString();
    const base = `${inicio.replace(/[^0-9]/g, "").slice(0, 14)}-${process.pid}`;
    let k = libro.corridas.length + 1;
    while (libro.corridas.some((e) => e.id === `${base}-${k}`)) k++;
    const id = `${base}-${k}`;
    libro.corridas.push({
      id, nombre: d.nombre, inicio, fin: null, estado: "en_curso", estimadoUsd: d.estimadoUsd, topeUsd: decision.topeUsd,
      gastadoUsd: null, llamadas: null, corridaFinal: !!d.corridaFinal, repitioFinal: !!d.repetirFinal, siguioDespuesDelAviso: !!d.sigueDespuesDelAviso,
    });
    escribirAmbos(r, libro);
    return { ...decision, id };
  });
}

/** Reemplaza el gasto comprometido por el medido. Síncrona: corre también al salir el proceso. */
export function cerrarCorrida(r, id, estado, gastadoUsd, llamadas) {
  if (estado !== "terminada" && estado !== "cortada") throw new LibroInvalido(`estado de cierre inválido: ${String(estado)}`);
  conCandadoDelLibro(r, () => {
    const libro = leerLibroEfectivo(r);
    const i = libro.corridas.findIndex((x) => x.id === id);
    if (i < 0) throw new LibroInvalido(`no encuentro la corrida ${id} en el libro`);
    libro.corridas[i] = { ...libro.corridas[i], estado, gastadoUsd: Math.round(gastadoUsd * 1e6) / 1e6, llamadas, fin: new Date().toISOString() };
    escribirAmbos(r, libro);
  });
}

/** Las banderas de una línea de comando, para `abrirCorrida`. */
export function banderasDeArgv(argv) {
  return {
    corridaFinal: argv.includes(BANDERA_CORRIDA_FINAL),
    repetirFinal: argv.includes(BANDERA_REPETIR_FINAL),
    sigueDespuesDelAviso: argv.includes(BANDERA_SIGUE_DESPUES_DEL_AVISO),
  };
}
