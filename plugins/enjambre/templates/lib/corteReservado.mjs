// EL CORTE DETERMINISTA DEL SET RESERVADO. Código puro: no lee la base ni el disco.
//
// Pieza genérica, copiada y adaptada de `semillas.ts` del proyecto de origen.
//
// ═══ EL CORTE ═══
// Por tipo de caso, se ordenan los ids por sha256(semilla | tipo | id) y el primer X% (redondeado)
// es el RESERVADO. Determinista: con la misma semilla y los mismos casos da siempre lo mismo, sin
// importar el orden en que llegaron. La semilla queda escrita en los dos archivos y en el registro
// de cortes. El corte se hace UNA vez, antes de usar nada.
//
// ═══ POR QUÉ ═══
// El set reservado mide el resultado FINAL, una sola vez. Nadie que arregle lo abre (la guardia
// del plugin lo niega por cualquier vía). Si el que arregla ve los casos reservados, el número
// final no vale nada y desde afuera no se nota. Los casos con texto se guardan comprimidos
// (`escribirGz`, util.mjs) para que un grep de todo el repo no los muestre.
//
// Un "caso" acá es sólo un id (string). Lo que ese id identifica (un mensaje, un contacto, una
// transacción, un escenario de prueba) es del proyecto.

import { createHash } from "node:crypto";
import { escribirGz, leerGz } from "./util.mjs";

export const PROPORCION_RESERVADO_POR_DEFECTO = 0.3;

/**
 * El CONTENIDO reservado (los casos con texto) se escribe SIEMPRE comprimido (`.json.gz`), con `wx`:
 * un grep, un `git log -p` o un `cat` no muestran texto legible. Es la protección de FONDO; la
 * guardia del plugin sólo dificulta. Lanza si la ruta no termina en `.json.gz` o si el archivo ya
 * existe (el corte es una sola vez).
 */
export function escribirReservado(ruta, dato) {
  if (!/\.json\.gz$/i.test(ruta)) throw new Error(`el contenido reservado se guarda comprimido: la ruta tiene que terminar en .json.gz (${ruta})`);
  escribirGz(ruta, dato);
}

/** Lo lee SÓLO el script autorizado (reservado.lectoresAutorizados), por dentro, y devuelve números. */
export const leerReservado = (ruta) => leerGz(ruta);

export function claveDeCorte(semilla, tipo, id) {
  return createHash("sha256").update(`${semilla}|${tipo}|${id}`).digest("hex");
}

export function cantidadReservada(n, proporcion = PROPORCION_RESERVADO_POR_DEFECTO) {
  return Math.round(n * proporcion);
}

/** Corta UN tipo: el primer X% por clave de corte va al reservado. `casos` son ids. */
export function cortarTipo(casos, tipo, semilla, proporcion = PROPORCION_RESERVADO_POR_DEFECTO) {
  const conClave = casos.map((id) => ({ id, k: claveDeCorte(semilla, tipo, id) }));
  conClave.sort((a, b) => a.k.localeCompare(b.k) || a.id.localeCompare(b.id));
  const k = cantidadReservada(casos.length, proporcion);
  return { reservado: conClave.slice(0, k).map((x) => x.id), trabajo: conClave.slice(k).map((x) => x.id) };
}

const ordenar = (casos) => Object.fromEntries(Object.keys(casos).sort().map((t) => [t, [...casos[t]].sort()]));

/**
 * Corta todos los tipos. `casos`: { <tipo>: string[] }. Devuelve { trabajo, reservado } con la
 * misma forma, ordenados.
 */
export function cortar(casos, semilla, proporcion = PROPORCION_RESERVADO_POR_DEFECTO) {
  if (!semilla || typeof semilla !== "string") throw new Error("la semilla del corte tiene que ser un texto no vacío (queda registrada)");
  const trabajo = {};
  const reservado = {};
  for (const tipo of Object.keys(casos)) {
    const r = cortarTipo(casos[tipo], tipo, semilla, proporcion);
    trabajo[tipo] = r.trabajo;
    reservado[tipo] = r.reservado;
  }
  return { trabajo: ordenar(trabajo), reservado: ordenar(reservado) };
}

export function todosLosIds(casos) {
  return new Set(Object.values(casos).flat());
}

/** Cuántos ids aparecen en los dos sets. Tiene que ser cero. */
export function idsCompartidos(a, b) {
  const enA = todosLosIds(a);
  let n = 0;
  for (const id of todosLosIds(b)) if (enA.has(id)) n++;
  return n;
}

export function tamanios(casos) {
  return Object.fromEntries(Object.keys(casos).sort().map((t) => [t, casos[t].length]));
}

export function huella(casos) {
  return createHash("sha256").update(JSON.stringify(ordenar(casos))).digest("hex");
}

/** Los dos archivos del corte y la entrada del registro, listos para escribirse. */
export function armarArchivos(casos, semilla, o = {}) {
  const proporcion = o.proporcion ?? PROPORCION_RESERVADO_POR_DEFECTO;
  const { trabajo, reservado } = cortar(casos, semilla, proporcion);
  const archivo = (set, c) => ({
    _que: set === "trabajo"
      ? "Semillas del SET DE TRABAJO del enjambre: sólo ids, nunca el contenido. Con éstas se itera."
      : "SET RESERVADO del enjambre: sólo ids. NINGÚN agente que arregla lo abre; lo lee únicamente el script de la corrida final. Nunca se itera con esto.",
    set,
    semilla,
    proporcionReservado: proporcion,
    tamanios: tamanios(c),
    huella: huella(c),
    casos: c,
  });
  const t = archivo("trabajo", trabajo);
  const r = archivo("reservado", reservado);
  const registro = {
    fecha: o.fecha ?? new Date().toISOString(),
    motivo: o.motivo ?? "corte inicial",
    semilla,
    proporcionReservado: proporcion,
    trabajo: { tamanios: t.tamanios, huella: t.huella },
    reservado: { tamanios: r.tamanios, huella: r.huella },
  };
  return { trabajo: t, reservado: r, registro };
}

/**
 * La prueba offline que el diseño exige: falla si un caso reservado aparece en el set de trabajo,
 * o si el set de trabajo cambió de tamaño sin que lo registre el reporte.
 */
export function problemasDelCorte(trabajo, reservado, registro) {
  const p = [];
  const compartidos = idsCompartidos(trabajo.casos, reservado.casos);
  if (compartidos) p.push(`${compartidos} id(s) aparecen en los dos sets`);
  if (huella(trabajo.casos) !== registro.trabajo.huella) p.push("la huella del set de trabajo no es la registrada");
  if (huella(reservado.casos) !== registro.reservado.huella) p.push("la huella del set reservado no es la registrada");
  if (JSON.stringify(tamanios(trabajo.casos)) !== JSON.stringify(registro.trabajo.tamanios)) p.push("el set de trabajo cambió de tamaño sin registrarse");
  if (trabajo.semilla !== reservado.semilla || trabajo.semilla !== registro.semilla) p.push("las semillas no coinciden");
  return p;
}
