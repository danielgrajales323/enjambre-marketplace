// EL COMPARADOR A CIEGAS, EN ORDEN DOBLE. Código puro: el modelo entra inyectado.
//
// Pieza genérica, copiada y adaptada de `comparador.ts` del proyecto de origen (regla J2
// del núcleo conversacional). Versión nueva contra la anterior, A CIEGAS: el modelo sólo ve
// "Respuesta 1" y "Respuesta 2", nunca qué versión es cuál. El código decide:
//   · el mínimo de pares (`MINIMO_DE_PARES`): con menos, no se compara;
//   · el ORDEN DOBLE (`REGLA_ORDEN_DOBLE`): cada par se juzga DOS veces, una con la nueva primero
//     y otra con la anterior primero. Qué orden va en la primera pasada sale de una semilla POR
//     CASO (`ordenDelPar`), así un par tiene el mismo orden aunque cambie su lugar en la lista;
//   · quién ganó, deshaciendo el orden de cada pasada y combinándolas con la regla;
//   · los pares idénticos no se le mandan al modelo: son "igual" sin gastar;
//   · una salida inválida se reintenta UNA vez; si vuelve a fallar, el par queda "sin_veredicto"
//     con su motivo (falla PROPIA del comparador, no gana nadie, no corta la comparación);
//   · qué pasa si empatan (`enEmpate`, sin valor por defecto: lo decide quien llama).
//
// Lo que cambia por proyecto entra por parámetros: `llamar` (la función que le habla al modelo,
// con el modelo EXPLÍCITO del juez, nunca el del que redacta o arregla), `normalizar` (para
// resolver tokens de precio u otros marcadores antes de comparar) y el system del comparador
// (sale de `armarPromptsJueces` en nucleoJueces.mjs).
//
// Atribución: el protocolo de juzgar cada par en los dos órdenes para cancelar el sesgo de
// posición es el de lmarena/arena-hard-auto (Apache-2.0). Se tomó la idea; el código y la regla
// de combinación están escritos de cero.

import { SalidaInvalida, MOTIVOS_SALIDA_INVALIDA } from "./esquema.mjs";
import { azarConSemilla, huellaDe, semillaDeTexto } from "./util.mjs";

export const MINIMO_DE_PARES = 120;

/** Llamadas al modelo por par distinto: una por orden (la estimación de costo la usa). */
export const LLAMADAS_POR_PAR = 2;

export const REGLA_ORDEN_DOBLE = "orden_doble_v1: coinciden → ese veredicto; difieren → inconsistente (cuenta como empate); sin veredicto → aparte";

export const SCHEMA_COMPARADOR = {
  type: "object",
  properties: {
    por_que: { type: "string", description: "PRIMERO, en una frase: qué diferencia decide, hablando de \"Respuesta 1\" y \"Respuesta 2\" (lo grave primero, después si contesta, después el tono)." },
    mejor: {
      type: "string",
      enum: ["1", "2", "igual"],
      description: "Después de la razón. \"1\" si la Respuesta 1 es mejor, \"2\" si la Respuesta 2 es mejor, \"igual\" si son equivalentes en todo lo que mira la rúbrica. El lugar en que aparece cada una no es un motivo.",
    },
  },
  required: ["por_que", "mejor"],
  additionalProperties: false,
};

export function pedidoDelPar(p, nuevaPrimero, normalizar = (s) => s) {
  const n = normalizar(p.nueva);
  const a = normalizar(p.anterior);
  const [r1, r2] = nuevaPrimero ? [n, a] : [a, n];
  return `${p.contexto}\n\nRespuesta 1:\n"""${r1}"""\n\nRespuesta 2:\n"""${r2}"""`;
}

/**
 * El orden de la PRIMERA pasada de un par: sólo de la semilla de la comparación y del id del caso
 * (determinista, y no depende del lugar del par en la lista).
 */
export function ordenDelPar(id, semilla) {
  return azarConSemilla(semillaDeTexto(`${semilla}:${id}`))() < 0.5;
}

/** Combina las dos pasadas de un par con `REGLA_ORDEN_DOBLE`. */
export function combinarPasadas(a, b) {
  if (a === null || b === null) return "sin_veredicto";
  return a === b ? a : "inconsistente";
}

/**
 * Una pasada: llama, deshace el orden y, ante una salida inválida, reintenta UNA vez y si no, la
 * anota. `llamar(usuario)` devuelve `{ mejor: "1"|"2"|"igual", por_que }` o lanza `SalidaInvalida`.
 * Cualquier otro error (tope de gasto, regla de oro, red) corta la comparación entera.
 */
async function pasada(p, nuevaPrimero, o) {
  const usuario = pedidoDelPar(p, nuevaPrimero, o.normalizar);
  let r;
  try {
    try {
      r = await o.llamar(usuario);
    } catch (err) {
      if (!(err instanceof SalidaInvalida)) throw err;
      r = await o.llamar(usuario);
    }
  } catch (err) {
    if (!(err instanceof SalidaInvalida)) throw err;
    return { nuevaPrimero, veredicto: null, porQue: "", motivo: err.motivo };
  }
  const veredicto = r.mejor === "igual" ? "igual" : (r.mejor === "1") === nuevaPrimero ? "nueva" : "anterior";
  return { nuevaPrimero, veredicto, porQue: String(r.por_que ?? "") };
}

/**
 * @param pares [{ id, contexto, nueva, anterior }]
 * @param o { semilla, enEmpate: "nueva"|"anterior", llamar, juez: { modelo }, system, normalizar?, minimo? }
 */
export async function compararVersiones(pares, o) {
  const minimo = o.minimo ?? MINIMO_DE_PARES;
  if (minimo < MINIMO_DE_PARES) throw new Error(`el mínimo de pares no puede bajar de ${MINIMO_DE_PARES}`);
  if (pares.length < minimo) throw new Error(`hacen falta ${minimo} pares o más para comparar; hay ${pares.length}`);
  if (!Number.isInteger(o.semilla)) throw new Error("la semilla tiene que ser un entero (queda registrada en el reporte)");
  if (typeof o.llamar !== "function") throw new Error("falta `llamar`: la función que le habla al modelo del comparador");
  if (!o.juez || !o.juez.modelo) throw new Error("falta `juez.modelo`: el modelo EXPLÍCITO del comparador (nunca el del redactor)");
  const normalizar = o.normalizar ?? ((s) => s);
  const detalle = [];
  for (const p of pares) {
    const nuevaPrimero = ordenDelPar(p.id, o.semilla);
    const n = normalizar(p.nueva).trim();
    const a = normalizar(p.anterior).trim();
    if (n === a) {
      detalle.push({ id: p.id, nuevaPrimero, ganador: "igual", porQue: "idénticas", identico: true, pasadas: [] });
      continue;
    }
    const primera = await pasada(p, nuevaPrimero, { llamar: o.llamar, normalizar });
    const segunda = await pasada(p, !nuevaPrimero, { llamar: o.llamar, normalizar });
    const ganador = combinarPasadas(primera.veredicto, segunda.veredicto);
    detalle.push({ id: p.id, nuevaPrimero, ganador, porQue: primera.porQue || segunda.porQue, identico: false, pasadas: [primera, segunda] });
  }
  return resumirComparacion(detalle, { semilla: o.semilla, enEmpate: o.enEmpate, modelo: o.juez.modelo, system: o.system ?? "" });
}

/** Los números de una comparación a partir de su detalle (también para rehacerla desde lo guardado). */
export function resumirComparacion(detalle, o) {
  const cuenta = (g) => detalle.filter((d) => d.ganador === g).length;
  const victoriasNueva = cuenta("nueva");
  const victoriasAnterior = cuenta("anterior");
  const inconsistentes = cuenta("inconsistente");
  const sinV = detalle.filter((d) => d.ganador === "sin_veredicto");
  const sinVeredictoPorMotivo = Object.fromEntries(MOTIVOS_SALIDA_INVALIDA.map((m) => [m, 0]));
  for (const d of sinV) for (const x of d.pasadas) if (x.motivo) sinVeredictoPorMotivo[x.motivo]++;
  const conDosVeredictos = detalle.filter((d) => !d.identico && d.ganador !== "sin_veredicto").length;
  const empate = victoriasNueva === victoriasAnterior;
  return {
    semilla: o.semilla,
    pares: detalle.length,
    victoriasNueva,
    victoriasAnterior,
    iguales: cuenta("igual"),
    empate,
    ganaNueva: empate ? o.enEmpate === "nueva" : victoriasNueva > victoriasAnterior,
    detalle,
    huellaPrompt: huellaDe(o.system ?? "", JSON.stringify(SCHEMA_COMPARADOR), REGLA_ORDEN_DOBLE),
    ordenDoble: true,
    regla: REGLA_ORDEN_DOBLE,
    juez: { rol: "comparador", modelo: o.modelo },
    inconsistentes,
    conDosVeredictos,
    tasaInconsistenciaPct: conDosVeredictos ? Math.round((1000 * inconsistentes) / conDosVeredictos) / 10 : 0,
    sinVeredicto: sinV.length,
    sinVeredictoPorMotivo,
  };
}

/** La tasa de inconsistencia POR JUEZ sobre varias comparaciones. Clave: el modelo del comparador. */
export function inconsistenciaPorJuez(comparaciones) {
  const r = {};
  for (const c of comparaciones) {
    if (!c || !c.juez) continue;
    const x = (r[c.juez.modelo] ??= { inconsistentes: 0, conDosVeredictos: 0, pct: 0, sinVeredicto: 0 });
    x.inconsistentes += c.inconsistentes ?? 0;
    x.conDosVeredictos += c.conDosVeredictos ?? 0;
    x.sinVeredicto += c.sinVeredicto ?? 0;
  }
  for (const x of Object.values(r)) x.pct = x.conDosVeredictos ? Math.round((1000 * x.inconsistentes) / x.conDosVeredictos) / 10 : 0;
  return r;
}
