// LOS ESCENARIOS Y LA RED DETERMINISTA DE SEGURIDAD (para el orquestador del proyecto).
//
// Un escenario es `{ id, funcion, rol, estadoInicial, entrada, oraculo, categoria, porQue }`. La
// categoría dice qué clase de prueba es, de una lista CERRADA: `funcional`, `contrato`,
// `propiedad`, `metamorfico`, o las de SEGURIDAD DEFENSIVA del sistema propio: `autorizacion`
// (entre roles o tenants de prueba), `aislamiento` (datos de un tenant que no deben aparecer en
// otro: canarios) y `rls` (políticas de fila). Se normaliza (trim, minúsculas, sin tildes) y
// cualquier otra cosa ("authorization", "permisos", "seguridad", un arreglo) se RECHAZA: falla
// cerrada. Las tres de seguridad exigen `seguridad.autorizacionDelDuenio` (firmante y fecha real,
// no futura): sin ella, el generador no las genera (instrucción) y el código las RECHAZA (esta red
// y la guardia de escrituras del plugin, que duplica esta lógica a conciencia). Quedan como PARADA
// para el dueño, nunca como escenario.
//
// Lo que la red NO ve: la categoría la declara el modelo. Un escenario de autorización etiquetado
// como `funcional` pasa por acá; lo ven el verificador (al reproducirlo) y el auditor. Que el ciclo
// completo lo respete en una sesión real se verifica en el lote 6.

export const CATEGORIAS_VALIDAS = ["funcional", "contrato", "propiedad", "metamorfico", "autorizacion", "aislamiento", "rls"];
export const CATEGORIAS_QUE_EXIGEN_AUTORIZACION = ["autorizacion", "aislamiento", "rls"];

export function normalizarCategoria(x) {
  if (typeof x !== "string") return "";
  return x.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function fechaValidaYNoFutura(fecha, hoy = new Date().toISOString().slice(0, 10)) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha ?? "").slice(0, 10));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return false;
  return `${m[1]}-${m[2]}-${m[3]}` <= hoy;
}

export function autorizacionVigente(config, hoy) {
  const a = config?.seguridad?.autorizacionDelDuenio;
  return !!a && typeof a === "object" && !Array.isArray(a) && typeof a.firmante === "string" && !!a.firmante.trim() && fechaValidaYNoFutura(a.fecha, hoy);
}

/** Lo que está mal en un escenario. Vacío si está bien. */
export function problemasDeEscenario(e, config, hoy) {
  const p = [];
  if (!e || typeof e !== "object" || Array.isArray(e)) return ["el escenario no es un objeto"];
  for (const k of ["id", "funcion", "oraculo"]) if (e[k] === undefined || e[k] === null || e[k] === "") p.push(`falta ${k}`);
  const cat = normalizarCategoria(e.categoria);
  if (!cat) p.push(`falta categoria (una de: ${CATEGORIAS_VALIDAS.join(", ")})`);
  else if (!CATEGORIAS_VALIDAS.includes(cat)) p.push(`categoría desconocida "${cat}": sólo ${CATEGORIAS_VALIDAS.join(", ")} (falla cerrada)`);
  else if (CATEGORIAS_QUE_EXIGEN_AUTORIZACION.includes(cat) && !autorizacionVigente(config, hoy)) {
    p.push(`la categoría "${cat}" exige seguridad.autorizacionDelDuenio (firmante y fecha real, no futura): sin ella es una PARADA para el dueño, no un escenario`);
  }
  return p;
}

/**
 * Separa los escenarios en los que se corren y los que quedan como parada (con su motivo). Un
 * escenario inválido por otra razón (categoría desconocida incluida) va a `invalidos`. Pura.
 */
export function filtrarEscenarios(escenarios, config, hoy) {
  const corren = [];
  const paradas = [];
  const invalidos = [];
  for (const e of escenarios) {
    const p = problemasDeEscenario(e, config, hoy);
    if (!p.length) corren.push(e);
    else if (p.some((x) => x.includes("autorizacionDelDuenio"))) paradas.push({ id: e?.id ?? "?", categoria: e?.categoria ?? "?", motivo: p.join("; ") });
    else invalidos.push({ id: e?.id ?? "?", motivo: p.join("; ") });
  }
  return { corren, paradas, invalidos };
}
