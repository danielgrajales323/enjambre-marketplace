// EL PARETO POR CAUSA FINA: el diagnóstico de un ciclo, decidido por el código, con ids y sin texto.
//
// Pieza genérica, copiada y adaptada de `causas.ts` (lote proceso) del proyecto de origen
// (regla P1 del núcleo conversacional). `reporte.mjs` agrupa por las causas GRUESAS que se pueden
// arreglar; esto baja un nivel: cada unidad (una respuesta, un turno, una conversación o un caso
// con error) aporta UNA vez a cada FIRMA que tiene, y la firma sale de lo guardado, nunca de un
// modelo:
//   regla:<id>            la regla incumplida que decidió el código (reglasIncumplidas)
//   falla:<falla>         una falla del veredicto que no es de regla
//   capa<n>:<motivo>      la capa del validador que rechazó un borrador (aunque saliera el texto fijo correcto)
//   generacion:<motivo>   la llamada al redactor se cortó o no devolvió borrador
//   conversacion:<falla>  una falla de la conversación entera; `conversacion:turno_grave` si la frenó un turno
//   juez:<etapa>:<motivo> una falla PROPIA del juez (refusal, max_tokens…) o `juez:desacuerdo`
//   error:<etapa>:<error> un error de la corrida en ese caso
//
// Lo que cambia por proyecto entra por parámetros: la tabla falla → causa gruesa, el conjunto de
// reglas contables, los motivos que son de generación y la tabla de "qué mirar" por firma
// (`sugerencias`), que en el primer negocio nombraba archivos suyos y acá es configuración.

/** De qué tipo es cada firma. El orden es el del desempate del Pareto. */
export const DIMENSIONES = ["regla", "falla", "capa_validador", "conversacion", "juez", "error"];

export const MOTIVOS_DE_GENERACION_POR_DEFECTO = new Set(["error_generacion", "corte_por_max_tokens", "rechazo_del_modelo", "sin_borrador"]);

const dedupe = (f) => [...new Map(f.map((x) => [x.firma, x])).values()];

/**
 * Las firmas de UNA respuesta (suelta o turno).
 * @param v { excluida?, fallas: string[], reglasIncumplidas?: string[] }
 * @param r { trasFallarGeneracion?: boolean, motivos?: string[] }  lo que dejó el generador
 * @param o { causaPorFalla, reglasContables?: Set, motivosDeGeneracion?: Set, fallasDeRegla?: string[] }
 */
export function firmasDeRespuesta(v, r = {}, o) {
  if (v.excluida) return [];
  const contables = o.reglasContables ?? new Set();
  const deRegla = new Set(o.fallasDeRegla ?? ["regla_contable", "regla_de_criterio"]);
  const generacion = o.motivosDeGeneracion ?? MOTIVOS_DE_GENERACION_POR_DEFECTO;
  const f = [];
  for (const falla of v.fallas ?? []) {
    if (deRegla.has(falla) && Array.isArray(v.reglasIncumplidas)) {
      // La regla incumplida la decide el código: sólo cuenta un "falla" del chequeo.
      const reglas = v.reglasIncumplidas.filter((x) => contables.has(x) === (falla === "regla_contable"));
      for (const x of reglas) f.push({ firma: `regla:${x}`, dimension: "regla", causa: o.causaPorFalla[falla] ?? null });
      if (reglas.length) continue;
    }
    f.push({ firma: `falla:${falla}`, dimension: "falla", causa: o.causaPorFalla[falla] ?? null });
  }
  if (r.trasFallarGeneracion) {
    for (const m of (r.motivos ?? []).length ? r.motivos : ["sin_motivo"]) {
      if (generacion.has(m)) f.push({ firma: `generacion:${m}`, dimension: "capa_validador", causa: m === "sin_borrador" ? (o.causaDeSinBorrador ?? "prompt") : null });
      else f.push({ firma: `${o.capaDe?.(m) ?? "capa1"}:${m}`, dimension: "capa_validador", causa: o.causaDelValidador ?? "validador" });
    }
  }
  return dedupe(f);
}

/**
 * Las firmas de UNA conversación completa (no las de sus turnos).
 * @param c { aprobada, fallas: string[], desacuerdo?: boolean }
 */
export function firmasDeConversacion(c, o) {
  if (c.aprobada) return [];
  const f = [];
  for (const falla of new Set(c.fallas ?? [])) f.push({ firma: `conversacion:${falla}`, dimension: "conversacion", causa: o.causaPorFalla[falla] ?? null });
  if (c.desacuerdo) f.push({ firma: "juez:desacuerdo", dimension: "juez", causa: null });
  if (!f.length) f.push({ firma: "conversacion:turno_grave", dimension: "conversacion", causa: null });
  return dedupe(f);
}

/** La firma de un error de la corrida en un caso: si es de una etapa del juez, es falla PROPIA del instrumento. */
export function firmaDeError(e, etapasDeJuez = new Set(["juez_respuesta", "juez_conversacion", "comparador"])) {
  if (etapasDeJuez.has(e.etapa) && e.motivo) return { firma: `juez:${e.etapa}:${e.motivo}`, dimension: "juez", causa: null };
  return { firma: `error:${e.etapa}:${e.error ?? "desconocido"}`, dimension: "error", causa: null };
}

/**
 * Todas las unidades de un set juzgado con sus firmas (con o sin falla).
 * @param respuestas [{ casoId, id?, turno?, categoria?, veredicto: {...}, respuesta?: {...} }]
 * @param conversaciones [{ casoId, categoria?, combinado: { aprobada, fallas, desacuerdo? } }]
 * @param errores [{ casoId, etapa, motivo?, error? }]
 */
export function unidadesDeFalla(respuestas, conversaciones, errores, o) {
  const u = [];
  for (const s of respuestas) {
    if (s.veredicto.excluida) continue;
    const id = s.id ?? (s.turno ? `${s.casoId}#${s.turno}` : s.casoId);
    u.push({ casoId: s.casoId, id, categoria: s.categoria ?? "?", firmas: firmasDeRespuesta(s.veredicto, s.respuesta ?? {}, o) });
  }
  for (const c of conversaciones) u.push({ casoId: c.casoId, id: `${c.casoId}#conversacion`, categoria: c.categoria ?? "?", firmas: firmasDeConversacion(c.combinado, o) });
  const vistos = new Set();
  for (const e of errores ?? []) {
    const f = firmaDeError(e, o.etapasDeJuez);
    const clave = `${e.casoId}|${f.firma}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const cat = o.categoriaDe?.(e.casoId) ?? respuestas.find((s) => s.casoId === e.casoId)?.categoria ?? conversaciones.find((c) => c.casoId === e.casoId)?.categoria ?? "?";
    u.push({ casoId: e.casoId, id: e.casoId, categoria: cat, firmas: [f] });
  }
  return u;
}

/** Qué mirar para cada firma, de una tabla del proyecto (por firma exacta o por prefijo). Nunca de un modelo. */
export function sugerenciaPara(f, sugerencias = {}) {
  const pre = f.firma.slice(0, f.firma.indexOf(":"));
  return sugerencias[f.firma] ?? sugerencias[pre] ?? sugerencias[f.dimension] ?? `Mirar la causa ${f.causa ?? f.dimension}.`;
}

/** Sugerencias genéricas (sin nombres de ningún negocio). El proyecto las reemplaza o las completa. */
export const SUGERENCIAS_POR_DEFECTO = {
  regla: "Una regla de la guía que el juez marcó: si es contable, que la cuente el validador con su prueba invertida; si es de criterio, el prompt y los ejemplos. Nunca una regla para un caso puntual.",
  capa1: "El redactor escribe algo que el validador rechaza. Si el rechazo es justo: el prompt o los ejemplos. Si es injusto: el validador, con el caso en su batería de falsos positivos (piso y techo).",
  capa2: "El juez de anclaje no encontró respaldo: ¿falta el dato en la información del negocio o el redactor lo inventa (prompt)?",
  generacion: "La llamada al redactor se cortó o no devolvió borrador: max_tokens, esfuerzo o la red. No es de la voz.",
  juez: "Falla PROPIA del juez o desacuerdo entre jueces: es del instrumento, no de lo juzgado. El prompt del juez se cambia ENTRE ciclos; el desacuerdo va al dueño.",
  error: "Error de la corrida en ese caso: mirar la etapa. No cuenta como aprobado ni como falla.",
  conversacion: "Una falla de la conversación entera: el prompt (memoria del hilo), la guía de voz o el ruteo.",
  falla: "Una falla del veredicto: la tabla causaPorFalla dice a qué parte del sistema se le atribuye.",
};

/**
 * El Pareto por firma: de la más frecuente a la menos. Ante un empate, el orden fijo de DIMENSIONES
 * y después la firma (alfabético): el mismo set da siempre el mismo orden. Porcentajes sobre la suma
 * de las firmas (una unidad con dos firmas cuenta en las dos). Ejemplos: ids, nunca texto.
 */
export function paretoDeFallas(unidades, o = {}) {
  const maxEjemplos = o.maxEjemplos ?? 5;
  const grupos = new Map();
  for (const un of unidades) {
    for (const f of un.firmas) {
      const g = grupos.get(f.firma) ?? { firma: f.firma, dimension: f.dimension, causa: f.causa, total: 0, pct: 0, acumuladoPct: 0, porCategoria: {}, ejemplos: [], sugerencia: sugerenciaPara(f, o.sugerencias ?? SUGERENCIAS_POR_DEFECTO) };
      g.total++;
      g.porCategoria[un.categoria] = (g.porCategoria[un.categoria] ?? 0) + 1;
      if (g.ejemplos.length < maxEjemplos) g.ejemplos.push(un.id);
      grupos.set(f.firma, g);
    }
  }
  const orden = [...grupos.values()].sort((a, b) =>
    b.total - a.total || DIMENSIONES.indexOf(a.dimension) - DIMENSIONES.indexOf(b.dimension) || (a.firma < b.firma ? -1 : a.firma > b.firma ? 1 : 0)
  );
  const suma = orden.reduce((s, g) => s + g.total, 0);
  let acumulado = 0;
  for (const g of orden) {
    acumulado += g.total;
    g.pct = suma ? Math.round((1000 * g.total) / suma) / 10 : 0;
    g.acumuladoPct = suma ? Math.round((1000 * acumulado) / suma) / 10 : 0;
  }
  return { unidades: unidades.length, conFalla: unidades.filter((x) => x.firmas.length > 0).length, grupos: orden };
}

/** La sección del documento: la tabla del Pareto (ids, sin texto) y la sugerencia de cada fila. */
export function seccionPareto(p, titulo = "Diagnóstico automático: Pareto por causa fina") {
  const l = [
    `## ${titulo}`,
    "",
    `${p.conFalla} de ${p.unidades} unidades (respuestas, turnos, conversaciones y casos con error) tienen al menos una firma. Los ejemplos son ids del set de TRABAJO, sin texto. El porcentaje es sobre la suma de las firmas (una unidad con dos firmas cuenta en las dos).`,
    "",
    "| # | firma | dimensión | causa | total | % | acumulado | por categoría | ejemplos | qué mirar |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  p.grupos.forEach((g, i) => {
    const cats = Object.entries(g.porCategoria).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c, n]) => `${c} ${n}`).join(" · ");
    l.push(`| P${i + 1} | \`${g.firma}\` | ${g.dimension} | ${g.causa ?? "— (instrumento)"} | ${g.total} | ${g.pct}% | ${g.acumuladoPct}% | ${cats} | ${g.ejemplos.map((e) => `\`${e}\``).join(", ")} | ${g.sugerencia} |`);
  });
  if (!p.grupos.length) l.push("| — | ninguna | — | — | 0 | — | — | — | — | — |");
  return l;
}
