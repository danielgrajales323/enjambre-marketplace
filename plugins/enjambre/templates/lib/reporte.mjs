// EL REPORTE DE CICLO, EL PARETO DE CAUSAS, LA PARADA Y LA MESETA. Código puro salvo el append.
//
// Pieza genérica, copiada y adaptada de `reporte.ts`, `causas.ts` y
// `estadoCiclos.ts` del proyecto de origen (el Pareto por causa fina viene de la rama
// `enjambre-proceso`, pieza en integración; acá va la versión mínima).
//
// Qué entra: VEREDICTOS genéricos, uno por caso juzgado:
//   { casoId, aprobada: boolean, fallas: string[], graves: { tipo, evidencia }[], excluida?: boolean }
// y una TABLA `causaPorFalla` (falla → causa), que es del proyecto y la decide el código, nunca un
// modelo. Un hallazgo cuenta sólo si tiene reproducción y lo confirmó un oráculo (eso pasa antes
// de llegar acá: `verificado: true`; lo no verificado no suma al Pareto).
//
// Al cerrar cada ciclo se AGREGA una línea al reporte (nunca se reescribe una anterior). Sólo
// números: la línea del set reservado no muestra ningún texto.

import { appendFileSync, existsSync, writeFileSync } from "node:fs";

export const UMBRALES_POR_DEFECTO = { aprobadas: 95, graves: 0 };

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const normal = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Las fallas graves sin repetir: mismo caso, mismo tipo, una evidencia contenida en la otra = una. */
export function gravesUnicas(veredictos) {
  const vistas = [];
  for (const v of veredictos) {
    for (const g of v.graves ?? []) {
      const e = normal(g.evidencia);
      const igual = vistas.find((x) => x.casoId === v.casoId && x.tipo === g.tipo && (normal(x.evidencia).includes(e) || e.includes(normal(x.evidencia))));
      if (!igual) vistas.push({ ...g, casoId: v.casoId });
    }
  }
  return vistas;
}

/**
 * EL PARETO: las fallas agrupadas por causa, de más a menos frecuente, con el porcentaje
 * acumulado. Una falla sin causa en la tabla va a "sin_causa" (y una prueba del proyecto debería
 * darla de alta). Ante empate, el orden en que la tabla declara las causas.
 */
export function pareto(veredictos, causaPorFalla, o = {}) {
  const ordenCausas = [...new Set(Object.values(causaPorFalla))];
  const grupos = new Map();
  for (const v of veredictos) {
    if (o.soloVerificados && v.verificado === false) continue;
    const causas = new Set();
    for (const f of v.fallas ?? []) {
      const causa = causaPorFalla[f] ?? "sin_causa";
      causas.add(causa);
      const g = grupos.get(causa) ?? { causa, total: 0, porFalla: {}, casos: [] };
      g.porFalla[f] = (g.porFalla[f] ?? 0) + 1;
      grupos.set(causa, g);
    }
    for (const causa of causas) {
      const g = grupos.get(causa);
      g.total++;
      if (g.casos.length < (o.maxEjemplos ?? 6)) g.casos.push(v.casoId);
    }
  }
  const idx = (c) => (ordenCausas.indexOf(c) < 0 ? ordenCausas.length : ordenCausas.indexOf(c));
  const lista = [...grupos.values()].sort((a, b) => b.total - a.total || idx(a.causa) - idx(b.causa));
  const total = lista.reduce((s, g) => s + g.total, 0);
  let acumulado = 0;
  return lista.map((g) => {
    acumulado += g.total;
    return { ...g, pct: pct(g.total, total), acumuladoPct: pct(acumulado, total) };
  });
}

/** Cuántas causas hay que atacar para cubrir `cobertura`% de las fallas (el 80 del 80/20). */
export function causasHastaCubrir(paretoCalculado, cobertura = 80) {
  const n = paretoCalculado.findIndex((g) => g.acumuladoPct >= cobertura);
  return n < 0 ? paretoCalculado.length : n + 1;
}

/**
 * @param e { ciclo, set, veredictos, comparacion, costoAcumuladoUsd, huellaJueces, causaPorFalla, umbrales?, fecha?, hallazgosNuevos? }
 */
export function resumirCiclo(e) {
  const u = { ...UMBRALES_POR_DEFECTO, ...(e.umbrales ?? {}) };
  const contadas = e.veredictos.filter((v) => !v.excluida);
  const aprobadas = contadas.filter((v) => v.aprobada).length;
  const graves = gravesUnicas(e.veredictos);
  const porTipo = {};
  for (const g of graves) porTipo[g.tipo] = (porTipo[g.tipo] ?? 0) + 1;
  const par = pareto(e.veredictos, e.causaPorFalla);
  const aPct = pct(aprobadas, contadas.length);
  const c = e.comparacion;
  return {
    ciclo: e.ciclo,
    set: e.set,
    fecha: e.fecha ?? new Date().toISOString().slice(0, 16).replace("T", " "),
    casos: { total: contadas.length, aprobados: aprobadas, pct: aPct },
    graves: { total: graves.length, porTipo },
    pareto: par,
    causaPrincipal: par[0]?.causa ?? null,
    hallazgosNuevos: e.hallazgosNuevos ?? null,
    comparacion: c
      ? {
        gana: c.ganaNueva, nueva: c.victoriasNueva, anterior: c.victoriasAnterior, iguales: c.iguales, pares: c.pares, semilla: c.semilla,
        ordenDoble: c.ordenDoble && c.juez ? { juez: c.juez.modelo, inconsistentes: c.inconsistentes, conDosVeredictos: c.conDosVeredictos, pct: c.tasaInconsistenciaPct, sinVeredicto: c.sinVeredicto } : null,
      }
      : null,
    costoAcumuladoUsd: e.costoAcumuladoUsd,
    huellaJueces: e.huellaJueces,
    criterios: {
      aprobadas: contadas.length > 0 && aPct >= u.aprobadas,
      graves: graves.length <= u.graves,
    },
  };
}

export const ENCABEZADO_REPORTE = [
  "# Enjambre — reporte por ciclo",
  "",
  "Generado por `lib/reporte.mjs`. Una línea por ciclo; las anteriores no se tocan. Sólo números (el set reservado no muestra texto).",
  "",
  "| ciclo | set | fecha | % aprobados | graves | hallazgos nuevos | ¿gana? | causa principal | Pareto (causa: total, % acumulado) | costo acumulado | huella jueces |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
].join("\n");

export function lineaDeCiclo(r) {
  const graves = r.graves.total === 0 ? "0" : `**${r.graves.total}** (${Object.entries(r.graves.porTipo).map(([k, v]) => `${k} ${v}`).join(", ")})`;
  const od = r.comparacion?.ordenDoble;
  const orden = od ? ` · orden doble ${od.juez}: ${od.inconsistentes}/${od.conDosVeredictos} inconsistentes (${od.pct}%)${od.sinVeredicto ? `, ${od.sinVeredicto} sin veredicto` : ""}` : "";
  const gana = r.comparacion ? `${r.comparacion.gana ? "sí" : "no"} (${r.comparacion.nueva}-${r.comparacion.anterior}, =${r.comparacion.iguales}, ${r.comparacion.pares} pares, semilla ${r.comparacion.semilla})${orden}` : "—";
  const par = r.pareto.map((g) => `${g.causa}: ${g.total}, ${g.acumuladoPct}%`).join(" · ") || "—";
  return `| ${r.ciclo} | ${r.set} | ${r.fecha} | ${r.casos.pct}% (${r.casos.aprobados}/${r.casos.total}) | ${graves} | ${r.hallazgosNuevos ?? "—"} | ${gana} | ${r.causaPrincipal ?? "—"} | ${par} | US$${r.costoAcumuladoUsd.toFixed(2)} | ${r.huellaJueces} |`;
}

/** Agrega la línea del ciclo. Crea el archivo con su encabezado si no existe. Nunca reescribe. */
export function agregarAlReporte(r, archivo) {
  const linea = lineaDeCiclo(r);
  if (!existsSync(archivo)) writeFileSync(archivo, `${ENCABEZADO_REPORTE}\n`);
  appendFileSync(archivo, `${linea}\n`);
  return linea;
}

// ── La parada y la meseta (índice de ciclos: sólo números) ──────────────────────────────────

export const MENSAJE_PARADA = "PARAR: dos ciclos sin mejora";

/**
 * "Se para si dos ciclos seguidos no mejoran". Mejorar = ganarle a la versión anterior en la
 * comparación a ciegas. El ciclo cero no cuenta. Una continuación registrada por el supervisor
 * (`continuoTrasParada`) reinicia la cuenta.
 */
export function evaluarParada(ciclos, seguidosParaParar = 2) {
  const iteraciones = ciclos.filter((c) => c.ciclo >= 1).sort((a, b) => a.ciclo - b.ciclo);
  let seguidos = 0;
  for (const c of iteraciones) {
    if (c.continuoTrasParada) seguidos = 0;
    // Una REGRESIÓN del set dorado cuenta como "no mejoró" aunque la entrada diga otra cosa (P3).
    const noMejoro = c.mejoro === false || (c.regresionesDorado ?? 0) > 0;
    seguidos = noMejoro ? seguidos + 1 : 0;
  }
  if (seguidos >= seguidosParaParar) {
    const ultimos = iteraciones.slice(-seguidosParaParar).map((c) => c.ciclo);
    return { parar: true, motivo: `${MENSAJE_PARADA} (ciclos ${ultimos.join(" y ")} no le ganaron a su anterior). Se reporta al dueño.` };
  }
  return { parar: false, motivo: null };
}

/**
 * LA MESETA de hallazgos nuevos: K ciclos seguidos sin ningún hallazgo nuevo CONFIRMADO por un
 * oráculo. Es uno de los criterios de terminado (con la cobertura), nunca "sin bugs".
 */
export function evaluarMeseta(ciclos, seguidosParaMeseta = 2) {
  const ordenados = [...ciclos].sort((a, b) => a.ciclo - b.ciclo);
  let seguidos = 0;
  for (const c of ordenados) {
    if (typeof c.hallazgosNuevos !== "number") { seguidos = 0; continue; }
    seguidos = c.hallazgosNuevos === 0 ? seguidos + 1 : 0;
  }
  return { meseta: seguidos >= seguidosParaMeseta, ciclosSinNuevos: seguidos };
}

/** El próximo ciclo: 0 si no hay ninguno; si no, el último + 1. */
export function proximoCiclo(ciclos) {
  return ciclos.length ? Math.max(...ciclos.map((c) => c.ciclo)) + 1 : 0;
}

/**
 * ¿El ciclo mejoró? Le ganó a la anterior en la comparación a ciegas Y no tuvo ninguna REGRESIÓN
 * del set dorado (P3): una mejora que rompe algo ya arreglado no es una mejora.
 */
export function decidirMejora(o) {
  const regresiones = o.regresionesDorado ?? 0;
  if (regresiones > 0) return { mejoro: false, motivo: `no: REGRESIÓN del set dorado (${regresiones})` };
  // Sin comparación NO se puede afirmar que mejoró: cuenta como "no mejoró" (como el orquestador de
  // origen); si devolviera null, un ciclo sin comparación nunca sumaría para la parada.
  if (!o.comparacion) return { mejoro: false, motivo: "no: sin comparación (no se puede afirmar que mejoró)" };
  return { mejoro: o.comparacion.ganaNueva === true, motivo: o.comparacion.ganaNueva ? "sí" : "no" };
}

/**
 * La medición FINAL (sobre el set reservado) no declara éxito si el último ciclo de trabajo tuvo
 * regresiones, ni si el reservado dio más de `toleranciaPuntos` peor que el de trabajo (sobreajuste).
 * @param o { criteriosOk: boolean, regresionesUltimoCiclo: number, pctTrabajo, pctReservado, toleranciaPuntos? }
 */
export function evaluarFinal(o) {
  const motivos = [];
  if ((o.regresionesUltimoCiclo ?? 0) > 0) motivos.push(`el último ciclo de trabajo tuvo ${o.regresionesUltimoCiclo} regresión(es) del set dorado`);
  const diff = (o.pctTrabajo ?? 0) - (o.pctReservado ?? 0);
  if (diff > (o.toleranciaPuntos ?? 10)) motivos.push(`sobreajuste: el reservado da ${diff.toFixed(1)} puntos peor que el de trabajo`);
  if (!o.criteriosOk) motivos.push("los criterios no se cumplen");
  return { veredicto: motivos.length ? "no concluyente" : "exito", motivos };
}

/**
 * El índice de ciclos sólo lleva ciclos COMPLETOS. Las re-corridas parciales y las variantes viven
 * aparte (`indice.parciales`, `indice.variantes`): un índice con un parcial o una variante entre los
 * ciclos no se usa (P2, P4). Devuelve los problemas; vacío si está bien.
 */
export function verificarIndice(indice) {
  const p = [];
  if (!indice || !Array.isArray(indice.ciclos)) return ["el índice no tiene la lista ciclos"];
  indice.ciclos.forEach((c, i) => {
    if (c.parcial === true || c.variante !== undefined || c.sobreCiclo !== undefined || /parcial|-var-/i.test(String(c.archivo ?? ""))) {
      p.push(`ciclos[${i}] es un parcial o una variante: no va entre los ciclos completos`);
    }
    if (typeof c.ciclo !== "number") p.push(`ciclos[${i}] sin número de ciclo`);
  });
  for (const k of ["parciales", "variantes"]) if (indice[k] !== undefined && !Array.isArray(indice[k])) p.push(`${k} tiene que ser una lista`);
  return p;
}

// ── Piso y techo fijos (la lección del péndulo) ──────────────────────────────────────────────

/**
 * Un detector que protege una excepción se mide EN LOS DOS LADOS desde la primera ronda: lo que
 * tiene que atrapar (PISO: al menos N de la batería positiva) y lo que no tiene que tocar (TECHO:
 * como mucho M de la batería negativa). Si sólo se mide un lado, cada ronda empuja el péndulo.
 * @param medido { atrapados, totalPositivos, tocados, totalNegativos }
 * @param limites { piso, techo }
 */
export function verificarPisoYTecho(medido, limites) {
  const problemas = [];
  if (medido.atrapados < limites.piso) problemas.push(`PISO: atrapó ${medido.atrapados}/${medido.totalPositivos}, el piso es ${limites.piso}`);
  if (medido.tocados > limites.techo) problemas.push(`TECHO: tocó ${medido.tocados}/${medido.totalNegativos}, el techo es ${limites.techo}`);
  return { ok: problemas.length === 0, problemas };
}

/** El documento de causas para el que arregla: el Pareto, cuántas atacar, y ejemplos SÓLO del set de trabajo. */
export function documentoDeCausas(o) {
  const par = o.pareto;
  const atacar = o.causasAArreglar ?? Math.min(3, causasHastaCubrir(par, 80));
  const l = [
    `# Enjambre — causas del ciclo ${o.ciclo}`,
    "",
    // Las REGRESIONES del set dorado van ARRIBA DEL TODO, antes que nada (P3).
    ...(o.regresiones?.length ? [...o.regresiones, ""] : []),
    `Generado el ${o.fecha}. Huella de los jueces: \`${o.huellaJueces}\`. Commit: \`${o.commit ?? "?"}\`.`,
    "Set de TRABAJO (el reservado no aparece nunca acá).",
    "",
    "**Para el builder arreglador:**",
    `- Se arreglan las ${atacar} causas más frecuentes (las que cubren el 80% o tres, lo que sea menor), cada una con su prueba offline invertida.`,
    "- Un hallazgo entra acá sólo si tiene reproducción mínima y lo confirmó un oráculo.",
    "- **Nunca** una regla ad hoc para un caso puntual. Los casos de abajo son ejemplos de la causa, no la lista a parchear.",
    "- Los prompts de los jueces no se tocan durante el ciclo. Si cambian entre ciclos, el ciclo siguiente vuelve a juzgar el anterior antes de comparar.",
    "",
    "## Pareto de fallas por causa",
    "",
    "| # | causa | total | % | % acumulado | por tipo de falla |",
    "|---|---|---|---|---|---|",
  ];
  par.forEach((g, i) => l.push(`| ${i + 1} | ${g.causa}${i < atacar ? " **(arreglar)**" : ""} | ${g.total} | ${g.pct}% | ${g.acumuladoPct}% | ${Object.entries(g.porFalla).map(([f, n]) => `${f} ${n}`).join(" · ")} |`));
  if (!par.length) l.push("| — | ninguna | 0 | — | — | — |");
  l.push("");
  for (const g of par.slice(0, atacar)) l.push(`## ${g.causa} — ${g.total}`, "", `Casos de ejemplo (set de trabajo): ${g.casos.map((c) => `\`${c}\``).join(", ") || "—"}`, "");
  // El Pareto por causa FINA (pareto.mjs, `seccionPareto`), después de las causas gruesas (P1).
  if (o.seccionParetoFino?.length) l.push(...o.seccionParetoFino, "");
  return l.join("\n") + "\n";
}
