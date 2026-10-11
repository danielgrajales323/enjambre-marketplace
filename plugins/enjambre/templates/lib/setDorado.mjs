// EL SET DORADO: lo que ya se arregló corre primero, y si vuelve a fallar es una REGRESIÓN arriba de todo.
//
// Pieza genérica, copiada y adaptada de `setDorado.ts` (lote proceso) del proyecto
// de origen (regla P3 del núcleo conversacional). Casos que alguna vez fallaron y se arreglaron: se corren
// SIEMPRE al principio de cada ciclo, completo o parcial, y un fallo en uno de ellos se reporta como
// REGRESIÓN, antes que cualquier otra sección. Una medición con una regresión NO cuenta como mejora
// aunque gane la comparación, la parada la cuenta como "no mejoró" y la medición final no declara
// éxito (`reporte.mjs`: `decidirMejora`, `evaluarParada`, `evaluarFinal`).
//
// El archivo se versiona. Cada caso es uno de dos:
//   · "trabajo": el id de un caso del SET DE TRABAJO, verificado contra la lista de ids de trabajo
//     (sin lista o con un id que no está, NO entra: así un caso del reservado no puede entrar nunca);
//   · "derivado": un caso escrito acá, ya saneado. Su id empieza con el prefijo y no choca con uno
//     del set; `validarCaso(caso)` (del proyecto: forma, categoría, PII) tiene que devolver [].
// Los casos dorados NO entran en los números del ciclo: corren aparte y sólo dicen si hubo regresión.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const PREFIJO_DERIVADO_POR_DEFECTO = "dorado_";

export class SetDoradoInvalido extends Error {
  constructor(msg) {
    super(msg);
    this.name = "SetDoradoInvalido";
  }
}

export function leerSetDorado(ruta) {
  if (!existsSync(ruta)) throw new SetDoradoInvalido(`no existe el set dorado (${ruta}): el ciclo lo corre siempre; si está vacío, que diga "casos": []`);
  let s;
  try { s = JSON.parse(readFileSync(ruta, "utf8")); } catch { throw new SetDoradoInvalido(`el set dorado (${ruta}) no es JSON`); }
  if (!s || s.version !== 1 || !Array.isArray(s.casos)) throw new SetDoradoInvalido(`el set dorado (${ruta}) no tiene la forma esperada (version 1, casos: [])`);
  return s;
}

/**
 * Los casos a correr, validados. Lanza `SetDoradoInvalido` (antes de gastar) si un id se repite, un
 * caso "trabajo" no está en `idsDeTrabajo` (o no hay lista), o un caso "derivado" no tiene el
 * prefijo, choca con un id del set, o `validarCaso` devuelve problemas.
 * @param o { idsDeTrabajo: Set<string> | null, casosDeTrabajo?: Map<id, caso>, validarCaso?: (caso) => string[], prefijo? }
 */
export function casosDelSetDorado(s, o = {}) {
  const prefijo = o.prefijo ?? PREFIJO_DERIVADO_POR_DEFECTO;
  const ids = o.idsDeTrabajo ?? null;
  const vistos = new Set();
  const out = [];
  for (const d of s.casos) {
    if (vistos.has(d.id)) throw new SetDoradoInvalido(`el caso dorado ${d.id} está dos veces`);
    vistos.add(d.id);
    if (!d.motivo || !String(d.motivo).trim()) throw new SetDoradoInvalido(`el caso dorado ${d.id} no dice su motivo (qué falló y cómo se arregló)`);
    if (d.origen === "trabajo") {
      if (!ids) throw new SetDoradoInvalido(`el caso dorado ${d.id} es del set de trabajo y no hay lista de ids para verificarlo: se agrega después del ciclo cero`);
      if (!ids.has(d.id)) throw new SetDoradoInvalido(`el caso dorado ${d.id} no está en el set de TRABAJO: sólo entran casos del set de trabajo o derivados saneados (nunca del reservado)`);
      out.push(o.casosDeTrabajo?.get(d.id) ?? { id: d.id });
      continue;
    }
    if (d.origen !== "derivado" || !d.caso) throw new SetDoradoInvalido(`el caso dorado ${d.id} no dice su origen ("trabajo" o "derivado" con su caso)`);
    if (!d.id.startsWith(prefijo) || d.caso.id !== d.id) throw new SetDoradoInvalido(`el caso derivado ${d.id} tiene que empezar con "${prefijo}" y llevar el mismo id adentro`);
    if (ids && ids.has(d.id)) throw new SetDoradoInvalido(`el caso derivado ${d.id} choca con un id del set de trabajo`);
    const problemas = o.validarCaso ? o.validarCaso(d.caso) : [];
    if (problemas.length) throw new SetDoradoInvalido(`el caso derivado ${d.id} no vale: ${problemas.join("; ")}`);
    out.push(d.caso);
  }
  return out;
}

/**
 * ¿Hubo regresión? Un caso dorado REGRESA si una de sus unidades falla (no aprobada y no excluida).
 * Un caso con error no tiene veredicto: va aparte y NO cuenta como aprobado.
 * @param unidades [{ casoId, id, aprobada, excluida?, firmas?: string[] }]
 * @param errores [{ casoId }]
 */
export function evaluarDorado(casos, unidades, errores = []) {
  const regresiones = [];
  const conVeredicto = new Set();
  for (const u of unidades) {
    conVeredicto.add(u.casoId);
    if (!u.aprobada && !u.excluida) regresiones.push({ id: u.id ?? u.casoId, firmas: u.firmas ?? [] });
  }
  const conError = new Set(errores.map((e) => e.casoId));
  const sinVeredicto = casos.map((c) => c.id).filter((id) => conError.has(id) || !conVeredicto.has(id));
  const caidos = new Set(regresiones.map((r) => String(r.id).split("#")[0]));
  return {
    total: casos.length,
    aprobados: casos.filter((c) => conVeredicto.has(c.id) && !conError.has(c.id) && !caidos.has(c.id)).length,
    regresiones,
    sinVeredicto,
  };
}

/** Las líneas de la REGRESIÓN para lo más alto del documento (ids, sin texto). Vacío si no hubo. */
export function lineasDeRegresion(r, archivo = "set-dorado.json") {
  if (!r || (!r.regresiones.length && !r.sinVeredicto.length)) return [];
  const l = [];
  if (r.regresiones.length) {
    l.push(`## ⛔ REGRESIÓN: ${new Set(r.regresiones.map((x) => String(x.id).split("#")[0])).size} caso(s) del set dorado volvieron a fallar`, "",
      `Son casos que ya fallaron y se arreglaron (${archivo}). Antes que cualquier otra causa, se mira esto. Una medición con regresión no cuenta como mejora.`, "");
    for (const x of r.regresiones) l.push(`- \`${x.id}\` — ${x.firmas.map((f) => `\`${f}\``).join(", ") || "sin firma"}`);
    l.push("");
  }
  if (r.sinVeredicto.length) l.push(`> ⚠️ Set dorado: ${r.sinVeredicto.length} caso(s) sin veredicto (error de la corrida o del juez): ${r.sinVeredicto.map((x) => `\`${x}\``).join(", ")}. No cuentan como aprobados.`, "");
  l.push(`Set dorado: ${r.aprobados} de ${r.total} aprobados.`);
  return l;
}

export function textoDorado(r) {
  return r.regresiones.length
    ? `⛔ REGRESIÓN en el set dorado: ${r.regresiones.map((x) => x.id).join(", ")} (${r.aprobados}/${r.total} aprobados)`
    : `set dorado: ${r.aprobados}/${r.total} aprobados, sin regresiones${r.sinVeredicto.length ? ` (${r.sinVeredicto.length} sin veredicto)` : ""}`;
}

/**
 * Suma un caso del SET DE TRABAJO al set dorado, validando TODO el set antes de escribir. Nunca abre
 * ni nombra el set reservado. Un caso nunca se saca: no hay función para quitar.
 */
export function agregarAlSetDorado(o) {
  const s = leerSetDorado(o.archivo);
  if (!o.motivo || !o.motivo.trim()) throw new SetDoradoInvalido("falta el motivo: qué falló y cómo se arregló");
  if (s.casos.some((c) => c.id === o.id)) throw new SetDoradoInvalido(`el caso ${o.id} ya está en el set dorado`);
  const nuevo = { ...s, casos: [...s.casos, { id: o.id, origen: "trabajo", agregado: o.fecha ?? new Date().toISOString().slice(0, 10), motivo: o.motivo.trim(), fuente: o.fuente ?? "a mano" }] };
  casosDelSetDorado(nuevo, { idsDeTrabajo: o.idsDeTrabajo ?? null, validarCaso: o.validarCaso, prefijo: o.prefijo });
  writeFileSync(o.archivo, JSON.stringify(nuevo, null, 2) + "\n");
  return nuevo;
}

/** Un set dorado vacío, listo para escribir con `wx` en un proyecto nuevo. */
export const SET_DORADO_VACIO = {
  _que: "Set dorado del enjambre: casos que alguna vez fallaron y se arreglaron. Corren SIEMPRE al principio de cada ciclo; un fallo es una REGRESIÓN y la medición no cuenta como mejora. Sólo ids del set de TRABAJO o casos derivados ya saneados; nunca del reservado. Un caso nunca se saca.",
  version: 1,
  casos: [],
};
