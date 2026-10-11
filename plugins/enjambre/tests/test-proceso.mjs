// EL PROCESO DEL ENJAMBRE (P1–P4) Y LA REGLA DE ORO: adaptación de `test-enjambre-proceso.ts`. Sin red, sin modelo.
//
//   node tests/test-proceso.mjs
//
// Lo que fija, y cómo se invirtió cada sección (sacando el arreglo, ROJO; restaurándolo, VERDE):
//   1. MODELOS (regla de oro): un rol que juzga de la familia de un redactor no pasa; `inherit` en un
//      rol que juzga no pasa; `soloRol` verifica una llamada. Invertida: sin el chequeo de familia.
//   2. PARETO FINO (P1): las firmas salen de lo guardado (regla contable vs de criterio, capa del
//      validador, generación, conversación, desacuerdo, error del juez); el orden es por total con
//      desempate fijo aunque los datos lleguen en otro orden; ids, nunca texto; qué mirar de una
//      tabla. Invertida: sin ordenar → ROJO.
//   3. SET DORADO (P3): un id que no es del set de trabajo no entra; un derivado sin prefijo o que
//      choca no entra; una regresión se detecta y va arriba del todo; una medición con regresión NO
//      es mejora aunque gane; la parada la cuenta como "no mejoró"; la final no declara éxito; un
//      caso nunca se saca (no hay función). Invertida: `casosDelSetDorado` sin verificar el id →
//      ROJO; `decidirMejora` ignorando las regresiones → ROJO.
//   4. RE-CORRIDA PARCIAL (P2): un filtro desconocido se rechaza antes de gastar; un id fuera del set
//      se rechaza; los cambios por caso se cuentan; el documento dice PARCIAL: no decide; un índice
//      con un parcial entre los ciclos no se usa. Invertida: `verificarIndice` sin el chequeo → ROJO.
//   5. VARIANTES (P4): se validan antes de gastar (máximo, nombre, clave desconocida, sin cambio,
//      regla de oro, perfil de costo); el documento dice que ninguna decide. Invertida: sin la regla
//      de oro → ROJO.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crearChequeo } from "./_arnes.mjs";
import { familiaDe, modelosPara, ReglaDeOroViolada, verificarTablaDeModelos } from "../templates/lib/modelos.mjs";
import { DIMENSIONES, firmaDeError, firmasDeConversacion, firmasDeRespuesta, paretoDeFallas, seccionPareto, sugerenciaPara, unidadesDeFalla } from "../templates/lib/pareto.mjs";
import { agregarAlSetDorado, casosDelSetDorado, evaluarDorado, leerSetDorado, lineasDeRegresion, SET_DORADO_VACIO, textoDorado } from "../templates/lib/setDorado.mjs";
import { cambiosPorCaso, casosDelArchivo, casosPorFiltros, contarCambios, documentoParcial, parsearFiltros } from "../templates/lib/redirigida.mjs";
import { documentoDeVariantes, leerVariantes, variantesDesdeDefiniciones } from "../templates/lib/variantes.mjs";
import { decidirMejora, documentoDeCausas, evaluarFinal, evaluarParada, pareto, verificarIndice } from "../templates/lib/reporte.mjs";

const { check, cerrar } = crearChequeo();
const DIR = mkdtempSync(join(tmpdir(), "enjambre-proceso-"));
const lanza = (f) => { try { f(); return "pasó"; } catch (e) { return e.name; } };

console.log("1. MODELOS: la regla de oro en código (invertida: sin el chequeo de familia, ROJO)");
{
  check("familiaDe", [familiaDe("claude-haiku-5-5"), familiaDe("sonnet"), familiaDe("Opus"), familiaDe("gpt-x")], ["haiku", "sonnet", "opus", "gpt-x"]);
  const tabla = { builder: "sonnet", juez: "haiku", comparador: "haiku", verificador: "opus", auditor: "opus", cartografo: "sonnet" };
  check("una tabla sana contra el builder sonnet: pasa", lanza(() => verificarTablaDeModelos(tabla, ["sonnet"])), "pasó");
  check("el juez de la familia del redactor: lanza", lanza(() => verificarTablaDeModelos({ ...tabla, juez: "claude-sonnet-5-5" }, ["sonnet"])), "ReglaDeOroViolada");
  check("el comparador de la familia de UNO de dos redactores (variante y control): lanza", lanza(() => verificarTablaDeModelos(tabla, ["sonnet", "claude-haiku-5-5"])), "ReglaDeOroViolada");
  check("un rol que juzga con inherit: lanza", lanza(() => verificarTablaDeModelos({ ...tabla, auditor: "inherit" }, ["sonnet"])), "ReglaDeOroViolada");
  check("un rol que NO juzga puede ser de la familia del redactor", lanza(() => verificarTablaDeModelos(tabla, ["sonnet"], { rolesQueJuzgan: ["juez"] })), "pasó");
  check("soloRol: mira una sola llamada", [lanza(() => verificarTablaDeModelos({ ...tabla, juez: "sonnet" }, ["sonnet"], { soloRol: "comparador" })), lanza(() => verificarTablaDeModelos({ ...tabla, juez: "sonnet" }, ["sonnet"], { soloRol: "juez" }))], ["pasó", "ReglaDeOroViolada"]);
  check("un rol sin modelo: lanza", lanza(() => verificarTablaDeModelos({ ...tabla, juez: "" }, ["sonnet"])), "ReglaDeOroViolada");
  check("modelosPara devuelve la tabla congelada", Object.isFrozen(modelosPara(tabla, ["sonnet"])), true);
  check("el error nombra la regla", (() => { try { verificarTablaDeModelos({ juez: "sonnet" }, ["claude-sonnet-5-5"]); } catch (e) { return e instanceof ReglaDeOroViolada && /REGLA DE ORO/.test(e.message); } })(), true);
}

console.log("\n2. PARETO FINO: firmas del código, orden fijo, ids sin texto (invertida: sin ordenar, ROJO)");
{
  const O = { causaPorFalla: { regla_contable: "validador", regla_de_criterio: "prompt", no_contesta: "prompt", promete: "validador", conv_no_recuerda: "prompt" }, reglasContables: new Set(["R1", "R2"]) };
  check("regla contable y de criterio, separadas por el código", firmasDeRespuesta({ fallas: ["regla_contable", "regla_de_criterio"], reglasIncumplidas: ["R1", "R8"] }, {}, O).map((f) => [f.firma, f.causa]), [["regla:R1", "validador"], ["regla:R8", "prompt"]]);
  check("una falla que no es de regla", firmasDeRespuesta({ fallas: ["no_contesta"] }, {}, O).map((f) => f.firma), ["falla:no_contesta"]);
  check("un rechazo del validador cuenta aunque saliera el texto fijo correcto", firmasDeRespuesta({ fallas: [] }, { trasFallarGeneracion: true, motivos: ["voseo", "afirmacion_sin_respaldo"] }, { ...O, capaDe: (m) => (m === "afirmacion_sin_respaldo" ? "capa2" : "capa1") }).map((f) => f.firma), ["capa1:voseo", "capa2:afirmacion_sin_respaldo"]);
  check("generación cortada: sin causa (no es de la voz); sin borrador: prompt", firmasDeRespuesta({ fallas: [] }, { trasFallarGeneracion: true, motivos: ["corte_por_max_tokens", "sin_borrador"] }, O).map((f) => [f.firma, f.causa]), [["generacion:corte_por_max_tokens", null], ["generacion:sin_borrador", "prompt"]]);
  check("una respuesta excluida no tiene firmas", firmasDeRespuesta({ excluida: true, fallas: ["no_contesta"] }, {}, O), []);
  check("conversación: fallas, desacuerdo, y turno_grave si nada la frenó", [firmasDeConversacion({ aprobada: false, fallas: ["conv_no_recuerda"], desacuerdo: true }, O).map((f) => f.firma), firmasDeConversacion({ aprobada: false, fallas: [] }, O).map((f) => f.firma), firmasDeConversacion({ aprobada: true, fallas: [] }, O)], [["conversacion:conv_no_recuerda", "juez:desacuerdo"], ["conversacion:turno_grave"], []]);
  check("un error en una etapa del juez es falla PROPIA del juez", [firmaDeError({ casoId: "c", etapa: "juez_respuesta", motivo: "max_tokens" }).firma, firmaDeError({ casoId: "c", etapa: "asistente", error: "Timeout" }).firma], ["juez:juez_respuesta:max_tokens", "error:asistente:Timeout"]);
  // Datos en un orden DISTINTO del esperado: si no ordenara, se notaría.
  const respuestas = [
    { casoId: "c1", categoria: "es", veredicto: { fallas: ["no_contesta"] } },
    { casoId: "c2", turno: 2, categoria: "en", veredicto: { fallas: ["promete"] } },
    { casoId: "c3", categoria: "es", veredicto: { fallas: ["promete"] } },
    { casoId: "c4", categoria: "es", veredicto: { fallas: ["promete", "no_contesta"] } },
    { casoId: "c5", categoria: "es", veredicto: { fallas: [] } },
    { casoId: "c6", categoria: "es", veredicto: { excluida: true, fallas: ["promete"] } },
  ];
  const conversaciones = [{ casoId: "c2", categoria: "en", combinado: { aprobada: false, fallas: ["conv_no_recuerda"] } }];
  const errores = [{ casoId: "c7", etapa: "juez_respuesta", motivo: "refusal" }, { casoId: "c7", etapa: "juez_respuesta", motivo: "refusal" }];
  const u = unidadesDeFalla(respuestas, conversaciones, errores, { ...O, categoriaDe: () => "es" });
  check("unidades: 5 respuestas (sin la excluida) + 1 conversación + 1 error (sin repetir)", [u.length, u.map((x) => x.id)], [7, ["c1", "c2#2", "c3", "c4", "c5", "c2#conversacion", "c7"]]);
  const p = paretoDeFallas(u);
  check("ordenado por total y desempate fijo (los cuatro grupos, en orden)", p.grupos.map((g) => [g.firma, g.total]), [["falla:promete", 3], ["falla:no_contesta", 2], ["conversacion:conv_no_recuerda", 1], ["juez:juez_respuesta:refusal", 1]]);
  check("porcentajes sobre la suma de firmas (7) y acumulado", p.grupos.map((g) => [g.pct, g.acumuladoPct]), [[42.9, 42.9], [28.6, 71.4], [14.3, 85.7], [14.3, 100]]);
  check("unidades y con falla", [p.unidades, p.conFalla], [7, 6]);
  check("ejemplos: ids, nunca texto; por categoría", [p.grupos[0].ejemplos, p.grupos[0].porCategoria], [["c2#2", "c3", "c4"], { en: 1, es: 2 }]);
  check("qué mirar: de la tabla por defecto (prefijo) o del proyecto (firma exacta)", [/validador/.test(sugerenciaPara({ firma: "capa1:voseo", dimension: "capa_validador" })), sugerenciaPara({ firma: "regla:R8", dimension: "regla" }, { "regla:R8": "mirar X" })], [true, "mirar X"]);
  check("la tabla de sugerencias por defecto no nombra a ningún negocio", /academia|directora|salsa/i.test(JSON.stringify(p.grupos.map((g) => g.sugerencia))), false);
  const sec = seccionPareto(p);
  check("la sección numera P1, P2… y lleva la sugerencia", [/\| P1 \| `falla:promete`/.test(sec.join("\n")), /\| P4 \| `juez:juez_respuesta:refusal` \| juez \| — \(instrumento\)/.test(sec.join("\n"))], [true, true]);
  check("DIMENSIONES es el orden del desempate", DIMENSIONES, ["regla", "falla", "capa_validador", "conversacion", "juez", "error"]);
  // El Pareto grueso (reporte.mjs) y el fino conviven en el documento de causas.
  const doc = documentoDeCausas({ ciclo: 1, fecha: "2026-10-10", huellaJueces: "abc", commit: "x", pareto: pareto([{ casoId: "c1", aprobada: false, fallas: ["no_contesta"] }], O.causaPorFalla), seccionParetoFino: sec, regresiones: ["## ⛔ REGRESIÓN: 1 caso", ""] });
  check("el documento: la regresión ARRIBA, las causas gruesas, y el Pareto fino después", [doc.indexOf("REGRESIÓN") < doc.indexOf("Pareto de fallas por causa"), doc.indexOf("Pareto de fallas por causa") < doc.indexOf("Pareto por causa fina")], [true, true]);
}

console.log("\n3. SET DORADO: corre primero, nunca del reservado, una regresión no es mejora (invertida: sin verificar el id, ROJO)");
{
  const archivo = join(DIR, "set-dorado.json");
  check("sin archivo: lanza (el ciclo lo corre siempre)", lanza(() => leerSetDorado(archivo)), "SetDoradoInvalido");
  writeFileSync(archivo, JSON.stringify(SET_DORADO_VACIO, null, 2));
  check("el vacío se lee", leerSetDorado(archivo).casos, []);
  const trabajo = new Set(["t1", "t2", "t3"]);
  const derivado = (id, extra = {}) => ({ id, origen: "derivado", agregado: "2026-10-10", motivo: "borde documentado", fuente: "doc", caso: { id, mensaje: "x" }, ...extra });
  check("un id del set de trabajo entra", casosDelSetDorado({ version: 1, casos: [{ id: "t1", origen: "trabajo", motivo: "m", fuente: "f" }] }, { idsDeTrabajo: trabajo }).map((c) => c.id), ["t1"]);
  check("un id que NO es del set de trabajo (p. ej. uno reservado) no entra", lanza(() => casosDelSetDorado({ version: 1, casos: [{ id: "reservado-9", origen: "trabajo", motivo: "m", fuente: "f" }] }, { idsDeTrabajo: trabajo })), "SetDoradoInvalido");
  check("sin lista de ids, un caso de trabajo no entra (se agrega después del ciclo cero)", lanza(() => casosDelSetDorado({ version: 1, casos: [{ id: "t1", origen: "trabajo", motivo: "m", fuente: "f" }] }, { idsDeTrabajo: null })), "SetDoradoInvalido");
  check("un derivado con prefijo entra; sin prefijo no; si choca con el set no; sin motivo no", [
    casosDelSetDorado({ version: 1, casos: [derivado("dorado_a")] }, { idsDeTrabajo: trabajo }).length,
    lanza(() => casosDelSetDorado({ version: 1, casos: [derivado("a")] }, { idsDeTrabajo: trabajo })),
    lanza(() => casosDelSetDorado({ version: 1, casos: [derivado("t1")] }, { idsDeTrabajo: trabajo })),
    lanza(() => casosDelSetDorado({ version: 1, casos: [derivado("dorado_a", { motivo: " " })] }, { idsDeTrabajo: trabajo })),
  ], [1, "SetDoradoInvalido", "SetDoradoInvalido", "SetDoradoInvalido"]);
  check("validarCaso del proyecto (p. ej. PII) frena un derivado", lanza(() => casosDelSetDorado({ version: 1, casos: [derivado("dorado_a")] }, { idsDeTrabajo: trabajo, validarCaso: () => ["tiene un teléfono"] })), "SetDoradoInvalido");
  check("un id repetido no entra", lanza(() => casosDelSetDorado({ version: 1, casos: [derivado("dorado_a"), derivado("dorado_a")] }, { idsDeTrabajo: trabajo })), "SetDoradoInvalido");
  const casos = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];
  const r = evaluarDorado(casos, [{ casoId: "d1", id: "d1", aprobada: true }, { casoId: "d2", id: "d2#1", aprobada: false, firmas: ["regla:R8"] }, { casoId: "d2", id: "d2#conversacion", aprobada: true }], [{ casoId: "d3" }]);
  check("regresión en d2, d3 sin veredicto, 1 aprobado", [r.aprobados, r.regresiones.map((x) => x.id), r.sinVeredicto], [1, ["d2#1"], ["d3"]]);
  check("las líneas de la regresión van con ids y sin texto, y dicen que no cuenta como mejora", [/⛔ REGRESIÓN: 1 caso/.test(lineasDeRegresion(r).join("\n")), /no cuenta como mejora/.test(lineasDeRegresion(r).join("\n")), /`d2#1` — `regla:R8`/.test(lineasDeRegresion(r).join("\n"))], [true, true, true]);
  check("sin regresión ni sin-veredicto, no hay líneas", lineasDeRegresion(evaluarDorado([{ id: "d1" }], [{ casoId: "d1", id: "d1", aprobada: true }])), []);
  check("textoDorado", /⛔ REGRESIÓN/.test(textoDorado(r)), true);
  // La regla P3 en las decisiones.
  const gana = { ganaNueva: true, victoriasNueva: 100, victoriasAnterior: 10 };
  check("decidirMejora: gana la comparación pero hay regresión → NO mejoró", decidirMejora({ comparacion: gana, regresionesDorado: 1 }), { mejoro: false, motivo: "no: REGRESIÓN del set dorado (1)" });
  check("decidirMejora: gana y sin regresión → mejoró", decidirMejora({ comparacion: gana, regresionesDorado: 0 }).mejoro, true);
  check("decidirMejora: SIN comparación → false, nunca null (hallazgo del auditor)", decidirMejora({ comparacion: null, regresionesDorado: 0 }).mejoro, false);
  check("tres ciclos ≥1 sin comparación → para", evaluarParada([1, 2, 3].map((n) => ({ ciclo: n, mejoro: decidirMejora({ comparacion: null }).mejoro }))).parar, true);
  check("evaluarParada cuenta una regresión como 'no mejoró' aunque la entrada diga que sí", evaluarParada([{ ciclo: 1, mejoro: true, regresionesDorado: 1 }, { ciclo: 2, mejoro: true, regresionesDorado: 2 }]).parar, true);
  check("evaluarFinal: con regresiones en el último ciclo, no concluyente", evaluarFinal({ criteriosOk: true, regresionesUltimoCiclo: 1, pctTrabajo: 95, pctReservado: 94 }).veredicto, "no concluyente");
  check("evaluarFinal: sobreajuste (>10 puntos), no concluyente; limpio, éxito", [evaluarFinal({ criteriosOk: true, regresionesUltimoCiclo: 0, pctTrabajo: 95, pctReservado: 80 }).veredicto, evaluarFinal({ criteriosOk: true, regresionesUltimoCiclo: 0, pctTrabajo: 95, pctReservado: 90 }).veredicto], ["no concluyente", "exito"]);
  // Sumar un caso valida TODO antes de escribir; y no existe una función para quitar.
  const a = agregarAlSetDorado({ archivo, id: "t2", motivo: "falló R8 y se arregló el validador", fuente: "ciclo 1", idsDeTrabajo: trabajo, fecha: "2026-10-10" });
  check("agregar: queda en el archivo con origen trabajo", [a.casos.length, leerSetDorado(archivo).casos[0].origen], [1, "trabajo"]);
  check("agregar el mismo id dos veces: lanza", lanza(() => agregarAlSetDorado({ archivo, id: "t2", motivo: "m", idsDeTrabajo: trabajo })), "SetDoradoInvalido");
  check("agregar un id que no es del set: lanza y no escribe", [lanza(() => agregarAlSetDorado({ archivo, id: "reservado-1", motivo: "m", idsDeTrabajo: trabajo })), leerSetDorado(archivo).casos.length], ["SetDoradoInvalido", 1]);
  check("no hay función para quitar un caso del set dorado", typeof (await import("../templates/lib/setDorado.mjs")).quitarDelSetDorado, "undefined");
}

console.log("\n4. RE-CORRIDA PARCIAL: filtros, ids del set, cambios por caso, nunca decide (invertida: verificarIndice sin el chequeo, ROJO)");
{
  const O = { causas: ["prompt", "validador"], categorias: ["es", "en"] };
  check("filtros válidos: firma, prefijo, causa, categoría", parsearFiltros("regla:R8, capa1, validador, categoria:en", O), [{ tipo: "firma", valor: "regla:R8" }, { tipo: "prefijo", valor: "capa1" }, { tipo: "causa", valor: "validador" }, { tipo: "categoria", valor: "en" }]);
  check("un filtro desconocido se rechaza antes de gastar", [lanza(() => parsearFiltros("loquesea", O)), lanza(() => parsearFiltros("categoria:fr", O)), lanza(() => parsearFiltros("", O)), lanza(() => parsearFiltros("regla:", O))], ["FiltroInvalido", "FiltroInvalido", "FiltroInvalido", "FiltroInvalido"]);
  const casos = [{ id: "c1", categoria: "es" }, { id: "c2", categoria: "en" }, { id: "c3", categoria: "es" }, { id: "c4", categoria: "es" }];
  const unidades = [
    { casoId: "c1", id: "c1", categoria: "es", firmas: [{ firma: "regla:R8", dimension: "regla", causa: "prompt" }] },
    { casoId: "c3", id: "c3", categoria: "es", firmas: [{ firma: "capa1:voseo", dimension: "capa_validador", causa: "validador" }] },
    { casoId: "c4", id: "c4", categoria: "es", firmas: [] },
  ];
  check("por firma exacta: sólo c1; por prefijo: c3; por causa: c3; por categoría: TODOS los de la categoría", [
    casosPorFiltros(parsearFiltros("regla:R8", O), unidades, casos), casosPorFiltros(parsearFiltros("capa1", O), unidades, casos),
    casosPorFiltros(parsearFiltros("validador", O), unidades, casos), casosPorFiltros(parsearFiltros("categoria:es", O), unidades, casos),
  ], [["c1"], ["c3"], ["c3"], ["c1", "c3", "c4"]]);
  const archivo = join(DIR, "casos.json");
  writeFileSync(archivo, JSON.stringify(["c2", "c1"]));
  check("casosDelArchivo: ids del set, en el orden del set", casosDelArchivo(archivo, casos), ["c1", "c2"]);
  writeFileSync(archivo, "c1\n# comentario\nreservado-7\n");
  check("un id que no es del set de trabajo se rechaza", lanza(() => casosDelArchivo(archivo, casos)), "FiltroInvalido");
  const antes = { unidades, errores: [] };
  const ahora = { unidades: [{ casoId: "c1", id: "c1", categoria: "es", firmas: [] }, { casoId: "c3", id: "c3", categoria: "es", firmas: [{ firma: "capa1:voseo", dimension: "capa_validador", causa: "validador" }] }, { casoId: "c4", id: "c4", categoria: "es", firmas: [{ firma: "falla:promete", dimension: "falla", causa: "validador" }] }], errores: [] };
  const cambios = cambiosPorCaso(["c1", "c3", "c4"], antes, ahora);
  check("cambios: c1 arreglado, c3 sigue aprobado (capa1 no es falla del caso), c4 nuevo fallo", cambios.map((c) => [c.casoId, c.antes, c.ahora]), [["c1", "falla", "aprobado"], ["c3", "aprobado", "aprobado"], ["c4", "aprobado", "falla"]]);
  check("contarCambios", contarCambios(cambios), { arreglados: 1, siguen: 0, nuevosFallos: 1, sinVeredicto: 0 });
  const doc = documentoParcial({ id: "p1", sobreCiclo: 2, fecha: "2026-10-10", commit: "x", filtro: "regla:R8", cambios, regresiones: ["## ⛔ REGRESIÓN"], avisos: [] });
  check("el documento dice PARCIAL: no decide, con la regresión arriba y el nuevo fallo marcado", [/PARCIAL: no decide/.test(doc), doc.indexOf("REGRESIÓN") < doc.indexOf("PARCIAL: no decide"), /`c4` \| aprobado \| falla ⛔/.test(doc)], [true, true, true]);
  check("un índice sano pasa", verificarIndice({ ciclos: [{ ciclo: 0 }, { ciclo: 1, mejoro: true }], parciales: [{ parcial: true, sobreCiclo: 1 }], variantes: [] }), []);
  check("un parcial entre los ciclos no se usa (por marca, por forma o por archivo)", [
    verificarIndice({ ciclos: [{ ciclo: 1, parcial: true }] }).length, verificarIndice({ ciclos: [{ ciclo: 1, sobreCiclo: 0 }] }).length,
    verificarIndice({ ciclos: [{ ciclo: 1, archivo: "trabajo/parciales/parcial-1.json.gz" }] }).length, verificarIndice({ ciclos: [{ ciclo: 1, variante: "haiku" }] }).length,
  ], [1, 1, 1, 1]);
}

console.log("\n5. VARIANTES: validadas antes de gastar, contra el mismo control, ninguna decide (invertida: sin la regla de oro, ROJO)");
{
  const O = {
    clavesDelExperimento: ["modeloRedactor", "modeloJuez", "verTextoViejo"],
    redactorControl: "claude-sonnet-5-5",
    anclajeDe: (x) => x.modeloJuez ?? "claude-haiku-5-5",
    modelosPara: (redactores) => (redactores.some((r) => familiaDe(r) === "haiku") ? { juez: "claude-sonnet-5-5", comparador: "claude-opus-5-5" } : { juez: "claude-haiku-5-5", comparador: "claude-haiku-5-5" }),
    tienePerfil: (_rol, modelo) => /sonnet|haiku|opus/.test(modelo),
    rolesQueJuzgan: ["juez", "comparador"],
  };
  const v = variantesDesdeDefiniciones([{ nombre: "haiku", modeloRedactor: "claude-haiku-5-5", modeloJuez: "claude-sonnet-5-5" }, { nombre: "texto-viejo", verTextoViejo: true }], O);
  check("dos variantes válidas, con su redactor y anclaje", v.map((x) => [x.nombre, x.redactor, x.anclaje]), [["haiku", "claude-haiku-5-5", "claude-sonnet-5-5"], ["texto-viejo", "claude-sonnet-5-5", "claude-haiku-5-5"]]);
  const l = (defs) => lanza(() => variantesDesdeDefiniciones(defs, O));
  check("más del máximo", l([{ nombre: "a", verTextoViejo: true }, { nombre: "b", verTextoViejo: true }, { nombre: "c", verTextoViejo: true }, { nombre: "d", verTextoViejo: true }]), "VarianteInvalida");
  check("nombre inválido o repetido", [l([{ nombre: "Mala Mayúscula", verTextoViejo: true }]), l([{ nombre: "a", verTextoViejo: true }, { nombre: "a", verTextoViejo: true }])], ["VarianteInvalida", "VarianteInvalida"]);
  check("una clave que el experimento no entiende se rechaza (no se ignora)", l([{ nombre: "a", prompt: "otro" }]), "VarianteInvalida");
  check("una variante que no cambia nada sería el control", l([{ nombre: "a" }]), "VarianteInvalida");
  check("anclaje de la familia del redactor: no puede redactar", l([{ nombre: "a", modeloRedactor: "claude-haiku-5-5", modeloJuez: "claude-haiku-5-5" }]), "VarianteInvalida");
  check("REGLA DE ORO: un juez de la familia del redactor de la variante se rechaza", lanza(() => variantesDesdeDefiniciones([{ nombre: "a", modeloRedactor: "claude-opus-5-5" }], { ...O, modelosPara: () => ({ juez: "claude-opus-5-5", comparador: "claude-haiku-5-5" }) })), "VarianteInvalida");
  check("REGLA DE ORO del par: el comparador no puede ser de la familia del CONTROL", lanza(() => variantesDesdeDefiniciones([{ nombre: "a", modeloRedactor: "claude-haiku-5-5", modeloJuez: "claude-sonnet-5-5" }], { ...O, modelosPara: () => ({ juez: "claude-opus-5-5", comparador: "claude-sonnet-5-5" }) })), "VarianteInvalida");
  check("sin perfil de costo para su modelo, no arranca (la estimación mentiría)", lanza(() => variantesDesdeDefiniciones([{ nombre: "a", modeloRedactor: "otro-modelo-1" }], { ...O, modelosPara: () => ({ juez: "claude-haiku-5-5", comparador: "claude-haiku-5-5" }) })), "VarianteInvalida");
  const archivo = join(DIR, "variantes.json");
  writeFileSync(archivo, JSON.stringify({ variantes: [{ nombre: "texto-viejo", verTextoViejo: true }] }));
  check("leerVariantes", leerVariantes(archivo, O).map((x) => x.nombre), ["texto-viejo"]);
  writeFileSync(archivo, "{ roto");
  check("un archivo roto o inexistente", [lanza(() => leerVariantes(archivo, O)), lanza(() => leerVariantes(join(DIR, "no.json"), O))], ["VarianteInvalida", "VarianteInvalida"]);
  const resumen = { casos: { total: 10, aprobados: 9, pct: 90 }, graves: { total: 0 }, causaPrincipal: null };
  const doc = documentoDeVariantes({ ciclo: 1, fecha: "2026-10-10", control: resumen, variantes: [{ nombre: "haiku", redactor: "claude-haiku-5-5", anclaje: "claude-sonnet-5-5", resumen, comparacion: { ganaNueva: true, victoriasNueva: 70, victoriasAnterior: 30, iguales: 20, pares: 120, semilla: 1, juez: { modelo: "claude-opus-5-5" }, inconsistentes: 3, conDosVeredictos: 100 }, errores: 0 }] });
  check("el documento dice que ninguna variante decide y muestra la comparación en orden doble", [/Ninguna variante cambia la ganadora/.test(doc), /\*\*le gana\*\* \(70-30/.test(doc), /orden doble claude-opus-5-5: 3\/100/.test(doc)], [true, true, true]);
}

console.log("\n6. ESCENARIOS: la red determinista de seguridad (invertida: sin el chequeo de la categoría, ROJO)");
{
  const { filtrarEscenarios, problemasDeEscenario, autorizacionVigente } = await import("../templates/lib/escenarios.mjs");
  const sin = { seguridad: { autorizacionDelDuenio: null } };
  const con = { seguridad: { autorizacionDelDuenio: { firmante: "La dueña", fecha: "2026-10-10", alcance: "staging" } } };
  const e = (id, categoria) => ({ id, funcion: "a#b", oraculo: { tipo: "invariante", regla: "x" }, categoria });
  check("autorizacionVigente: null, sin firmante, fecha mala, válida", [autorizacionVigente(sin), autorizacionVigente({ seguridad: { autorizacionDelDuenio: { fecha: "2026-10-10" } } }), autorizacionVigente({ seguridad: { autorizacionDelDuenio: { firmante: "x", fecha: "ayer" } } }), autorizacionVigente(con)], [false, false, false, true]);
  check("sin autorización, autorizacion/aislamiento/rls tienen problema; funcional no", [problemasDeEscenario(e("1", "autorizacion"), sin).length, problemasDeEscenario(e("2", "aislamiento"), sin).length, problemasDeEscenario(e("3", "rls"), sin).length, problemasDeEscenario(e("4", "funcional"), sin)], [1, 1, 1, []]);
  check("con autorización, pasan", problemasDeEscenario(e("1", "autorizacion"), con), []);
  check("sin categoría o sin oráculo: problema", [problemasDeEscenario({ id: "x", funcion: "f", oraculo: {} }, con).length > 0, problemasDeEscenario({ id: "x", funcion: "f", categoria: "funcional" }, con)], [true, ["falta oraculo"]]);
  const r = filtrarEscenarios([e("1", "autorizacion"), e("2", "funcional"), e("3", "rls"), { id: "4" }], sin);
  check("filtrarEscenarios: corren 1, paradas 2 (con su motivo), inválidos 1", [r.corren.map((x) => x.id), r.paradas.map((p) => p.id), /autorizacionDelDuenio/.test(r.paradas[0].motivo), r.invalidos.map((x) => x.id)], [["2"], ["1", "3"], true, ["4"]]);
  check("con autorización, las tres corren", filtrarEscenarios([e("1", "autorizacion"), e("2", "funcional"), e("3", "rls")], con).corren.length, 3);
  // Re-verificación sobre 24a5403: normalización y lista cerrada.
  const { normalizarCategoria, fechaValidaYNoFutura, CATEGORIAS_VALIDAS } = await import("../templates/lib/escenarios.mjs");
  check("normalizarCategoria: tilde, mayúsculas, espacios; lo que no es texto → ''", [normalizarCategoria(" Autorización "), normalizarCategoria("RLS"), normalizarCategoria(["rls"]), normalizarCategoria(null)], ["autorizacion", "rls", "", ""]);
  check("'autorización', ' rls ', 'Aislamiento' sin autorización → problema de autorización (no pasan)", ["autorización", " rls ", "Aislamiento"].map((c) => problemasDeEscenario(e("x", c), sin).some((p) => p.includes("autorizacionDelDuenio"))), [true, true, true]);
  check("'authorization', 'permisos', 'seguridad', inventada, arreglo → categoría desconocida (falla cerrada)", ["authorization", "permisos", "seguridad", "lo-que-sea", ["autorizacion"]].map((c) => problemasDeEscenario(e("x", c), con).some((p) => /desconocida|falta categoria/.test(p))), [true, true, true, true, true]);
  check("la lista cerrada", CATEGORIAS_VALIDAS, ["funcional", "contrato", "propiedad", "metamorfico", "autorizacion", "aislamiento", "rls"]);
  check("fechaValidaYNoFutura: real y pasada sí; 99-99, 2026-02-30, futura, texto: no", [fechaValidaYNoFutura("2026-10-10", "2026-10-10"), fechaValidaYNoFutura("2026-99-99"), fechaValidaYNoFutura("2026-02-30"), fechaValidaYNoFutura("2099-01-01", "2026-10-10"), fechaValidaYNoFutura("ayer")], [true, false, false, false, false]);
  check("una autorización con fecha futura no vale", autorizacionVigente({ seguridad: { autorizacionDelDuenio: { firmante: "x", fecha: "2099-01-01" } } }, "2026-10-10"), false);
  check("filtrarEscenarios manda la categoría desconocida a inválidos, no a paradas", filtrarEscenarios([e("1", "permisos")], sin).invalidos.length, 1);
}

cerrar();
