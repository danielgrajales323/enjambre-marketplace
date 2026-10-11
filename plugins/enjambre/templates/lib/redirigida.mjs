// LA RE-CORRIDA DIRIGIDA: PARCIAL, en minutos y por centavos, y NUNCA decide.
//
// Pieza genérica, copiada y adaptada de `redirigida.ts` (lote proceso) de
// el proyecto de origen (regla P2 del núcleo conversacional). Después de un arreglo, se re-corren SÓLO los
// casos del set de TRABAJO de ciertas causas o categorías, o una lista de ids, para ver si el arreglo
// los movió. Es PARCIAL:
//   · nunca entra en los ciclos del índice (`verificarIndice`, reporte.mjs): no mueve el próximo
//     ciclo, ni la parada, ni la medición final. La decisión exige un ciclo COMPLETO (medir sólo
//     los casos arreglados sesga a favor del arreglo);
//   · se compara caso por caso contra el último ciclo completo (arreglados, siguen, nuevos fallos),
//     no con el comparador: con menos de 120 pares no hay comparación;
//   · respeta lo mismo que un ciclo: el set dorado primero, el libro, la estimación, la parada en
//     pie y las huellas de control; si cambió la vara de los jueces, no compara.
//
// LOS FILTROS (separados por coma). Un caso entra si alguna de sus unidades tuvo en el ciclo de
// referencia una firma que coincide: una firma exacta ("regla:R8", "falla:no_contesta"), un prefijo
// ("regla", "falla", "capa1"…), una causa gruesa de la tabla del proyecto, o "categoria:<cat>" (TODOS
// los casos de esa categoría, fallen o no). Un filtro desconocido se rechaza ANTES de gastar.

import { existsSync, readFileSync } from "node:fs";

export const PREFIJOS_DE_FIRMA_POR_DEFECTO = ["regla", "falla", "capa1", "capa2", "generacion", "conversacion", "juez", "error"];

export class FiltroInvalido extends Error {
  constructor(msg) {
    super(msg);
    this.name = "FiltroInvalido";
  }
}

/**
 * Lee la lista de filtros. Lanza FiltroInvalido ante cualquier cosa que no sea un filtro conocido.
 * @param o { causas: string[], categorias: string[], prefijos?: string[] }
 */
export function parsearFiltros(texto, o) {
  const prefijos = o.prefijos ?? PREFIJOS_DE_FIRMA_POR_DEFECTO;
  const partes = String(texto ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!partes.length) throw new FiltroInvalido("filtro vacío: decí qué causas o categorías re-correr");
  return partes.map((p) => {
    if (p.startsWith("categoria:")) {
      const c = p.slice("categoria:".length);
      if (!o.categorias.includes(c)) throw new FiltroInvalido(`la categoría "${c}" no existe (${o.categorias.join(", ")})`);
      return { tipo: "categoria", valor: c };
    }
    if (o.causas.includes(p)) return { tipo: "causa", valor: p };
    if (prefijos.includes(p)) return { tipo: "prefijo", valor: p };
    const pre = p.slice(0, p.indexOf(":"));
    if (p.includes(":") && prefijos.includes(pre) && p.length > pre.length + 1) return { tipo: "firma", valor: p };
    throw new FiltroInvalido(`filtro desconocido "${p}": una firma del Pareto (regla:R8, capa1:x…), un prefijo (${prefijos.join(", ")}), una causa (${o.causas.join(", ")}) o categoria:<categoría>`);
  });
}

const coincide = (u, f) =>
  f.tipo === "categoria" ? u.categoria === f.valor
    : u.firmas.some((x) => f.tipo === "firma" ? x.firma === f.valor : f.tipo === "prefijo" ? x.firma.startsWith(`${f.valor}:`) : x.causa === f.valor);

/**
 * Los casos del set de TRABAJO que tocan los filtros. Las categorías se toman del SET (todos sus
 * casos), las firmas y causas del ciclo de referencia. Devuelve ids del set, en el orden del set.
 * @param unidadesDeReferencia las unidades (pareto.mjs, `unidadesDeFalla`) del último ciclo completo
 * @param casos [{ id, categoria }] el set de trabajo
 */
export function casosPorFiltros(filtros, unidadesDeReferencia, casos) {
  const elegidos = new Set();
  for (const c of casos) if (filtros.some((f) => f.tipo === "categoria" && c.categoria === f.valor)) elegidos.add(c.id);
  for (const u of unidadesDeReferencia) if (filtros.some((f) => f.tipo !== "categoria" && coincide(u, f))) elegidos.add(u.casoId);
  return casos.map((c) => c.id).filter((id) => elegidos.has(id));
}

/** Lee un archivo de ids (JSON `["id"]` / `{ "casos": [] }` o uno por línea) y verifica cada id contra el set de trabajo. */
export function casosDelArchivo(archivo, casos) {
  if (!existsSync(archivo)) throw new FiltroInvalido(`no existe el archivo de casos (${archivo})`);
  const crudo = readFileSync(archivo, "utf8").trim();
  let ids;
  if (crudo.startsWith("[") || crudo.startsWith("{")) {
    let j;
    try { j = JSON.parse(crudo); } catch { throw new FiltroInvalido(`el archivo de casos (${archivo}) no es JSON válido`); }
    const lista = Array.isArray(j) ? j : j?.casos;
    if (!Array.isArray(lista)) throw new FiltroInvalido(`el archivo de casos (${archivo}) necesita una lista de ids o { "casos": [...] }`);
    ids = lista.map(String);
  } else {
    ids = crudo.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"));
  }
  const delSet = new Set(casos.map((c) => c.id));
  const fuera = ids.filter((id) => !delSet.has(id));
  if (fuera.length) throw new FiltroInvalido(`${fuera.length} id(s) del archivo no son del set de TRABAJO (sólo se re-corren casos del set de trabajo): ${fuera.slice(0, 5).join(", ")}${fuera.length > 5 ? "…" : ""}`);
  if (!ids.length) throw new FiltroInvalido(`el archivo de casos (${archivo}) no tiene ningún id`);
  return casos.map((c) => c.id).filter((id) => ids.includes(id));
}

/** Cómo quedó cada caso: aprobado (todas sus unidades), falla (alguna), o sin veredicto (error). */
function estadoPorCaso(unidades, ids, conError, o) {
  const noSonFalla = o.prefijosQueNoSonFalla ?? ["capa", "generacion"];
  const conVeredicto = new Set(unidades.map((u) => u.casoId));
  const m = new Map();
  for (const id of ids) {
    const firmas = [...new Set(unidades.filter((x) => x.casoId === id).flatMap((x) => x.firmas.map((f) => f.firma)))].sort();
    const estado = conError.has(id) || !conVeredicto.has(id) ? "sin_veredicto" : firmas.some((f) => !noSonFalla.some((p) => f.startsWith(p))) ? "falla" : "aprobado";
    m.set(id, { estado, firmas });
  }
  return m;
}

/**
 * Antes y después de cada caso re-corrido. "falla" = alguna unidad no aprobada; un rechazo del
 * validador que terminó en el texto fijo correcto (firmas capa1, capa2 o generacion) no cuenta como falla del caso,
 * pero su firma se muestra.
 * @param antes/ahora { unidades: UnidadDeFalla[], errores: [{ casoId }] }
 */
export function cambiosPorCaso(ids, antes, ahora, o = {}) {
  const a = estadoPorCaso(antes.unidades, ids, new Set((antes.errores ?? []).map((e) => e.casoId)), o);
  const d = estadoPorCaso(ahora.unidades, ids, new Set((ahora.errores ?? []).map((e) => e.casoId)), o);
  return ids.map((id) => ({ casoId: id, antes: a.get(id).estado, ahora: d.get(id).estado, firmasAntes: a.get(id).firmas, firmasAhora: d.get(id).firmas }));
}

export function contarCambios(c) {
  return {
    arreglados: c.filter((x) => x.antes === "falla" && x.ahora === "aprobado").length,
    siguen: c.filter((x) => x.antes === "falla" && x.ahora === "falla").length,
    nuevosFallos: c.filter((x) => x.antes === "aprobado" && x.ahora === "falla").length,
    sinVeredicto: c.filter((x) => x.ahora === "sin_veredicto").length,
  };
}

/** El documento de la re-corrida: PARCIAL arriba (debajo de una regresión, si hubo), ids sin texto, el Pareto de lo re-corrido. */
export function documentoParcial(o) {
  const k = contarCambios(o.cambios);
  const l = [
    `# Enjambre — re-corrida PARCIAL ${o.id} (sobre el ciclo ${o.sobreCiclo})`,
    "",
    ...(o.regresiones?.length ? [...o.regresiones, ""] : []),
    "> **PARCIAL: no decide.** No entra en los ciclos del índice, no mueve la parada y nunca reemplaza a un ciclo completo en la decisión. Para decidir, un ciclo completo.",
    "",
    `Generado el ${o.fecha}. Commit: \`${o.commit ?? "?"}\`. Filtro: \`${o.filtro}\`. ${o.cambios.length} casos del set de TRABAJO (ids, sin texto).`,
    "",
  ];
  for (const a of o.avisos ?? []) l.push(`> ⚠️ ${a}`, "");
  l.push(
    `**Arreglados ${k.arreglados} · siguen fallando ${k.siguen} · nuevos fallos ${k.nuevosFallos}${k.sinVeredicto ? ` · sin veredicto ${k.sinVeredicto}` : ""}** (contra el ciclo ${o.sobreCiclo}).`,
    "",
    "| caso | antes | ahora | firmas antes | firmas ahora |",
    "|---|---|---|---|---|",
  );
  for (const c of o.cambios) l.push(`| \`${c.casoId}\` | ${c.antes} | ${c.ahora}${c.antes === "aprobado" && c.ahora === "falla" ? " ⛔" : ""} | ${c.firmasAntes.join(", ") || "—"} | ${c.firmasAhora.join(", ") || "—"} |`);
  if (o.seccionPareto?.length) l.push("", ...o.seccionPareto);
  return l.join("\n") + "\n";
}
