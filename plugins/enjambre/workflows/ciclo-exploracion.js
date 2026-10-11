export const meta = {
  name: 'ciclo-exploracion',
  description: 'Fase de exploracion de un ciclo del enjambre: mapear, generar escenarios, explorar en paralelo, verificar cada hallazgo en contexto limpio y hacer el triage. No arregla nada.',
  whenToUse: 'Cuando el proyecto ya tiene .enjambre/ y el supervisor quiere la fase de exploracion de un ciclo como una sola corrida reproducible.',
  phases: [
    { title: 'Mapear', detail: 'el cartografo mapea funciones, roles, estados y oraculos' },
    { title: 'Escenarios', detail: 'el generador convierte el mapa en escenarios con oraculo' },
    { title: 'Explorar', detail: 'un explorador por tanda, en paralelo' },
    { title: 'Verificar', detail: 'un verificador por hallazgo, en contexto limpio' },
    { title: 'Triage', detail: 'agrupa los confirmados por causa' },
  ],
}

// RESTRICCIONES DE LOS WORKFLOWS (verificadas en la doc): `meta` es la primera sentencia y un
// literal puro; sin `import()`, sin acceso a archivos ni a la shell (eso lo hacen los agentes);
// sin `Math.random()`, `Date.now()` ni `new Date()` sin argumentos, para que una relanzada repita
// exactamente las mismas llamadas. Todo lo variable entra por `args`.
//
// `args` esperado (lo pasa el supervisor desde .enjambre/config.json):
//   { ciclo: 1, semilla: 20261010, fecha: "2026-10-10", hosts: ["localhost"],
//     modelos: { cartografo, generador, explorador, verificador, triage }, tandas: 4,
//     autorizacionDelDuenio: null | { firmante, fecha, alcance, tenantsDePrueba } }
//   `autorizacionDelDuenio` es el valor de `seguridad.autorizacionDelDuenio`: sin él (o sin firmante
//   y fecha) no se generan escenarios de autorizacion/aislamiento/rls; quedan como parada. La red
//   determinista (guard-escrituras.mjs, problemasDeEscenario) los rechaza aunque el modelo los escriba.
//
// NO VERIFICADO EN LA DOC [G]: el nombre exacto del parametro de modelo y de tipo de agente en
// `agent()` dentro de un workflow de plugin. Aca se usan `model` y `agentType`, que son los del
// helper del tool Workflow. El lote 2 del plan los prueba en la build instalada; si difieren,
// este archivo se ajusta y el supervisor sigue pasando el modelo explicito por otra via.

const a = args || {}
const ciclo = a.ciclo || 0
const semilla = a.semilla || 1
const modelos = a.modelos || {}
const tandas = a.tandas || 4
const aut = a.autorizacionDelDuenio
const autorizado = !!(aut && typeof aut === 'object' && typeof aut.firmante === 'string' && aut.firmante.trim() && typeof aut.fecha === 'string' && /^\d{4}-\d{2}-\d{2}/.test(aut.fecha))
const candadoSeguridad = autorizado
  ? `Hay autorizacion escrita del dueño (firmante ${aut.firmante}, fecha ${aut.fecha}, alcance ${aut.alcance || 'sin alcance declarado'}): los escenarios de autorizacion, aislamiento y rls se generan SOLO dentro de ese alcance y con tenants de prueba.`
  : 'NO hay autorizacion escrita del dueño (seguridad.autorizacionDelDuenio es null o invalida): NO generes ningun escenario de categoria autorizacion, aislamiento ni rls; listalos como paradas en .enjambre/trabajo/escenarios/sin-autorizacion.json.'

const MAPA = {
  type: 'object',
  properties: {
    resumen: { type: 'string' },
    celdasTotal: { type: 'number' },
    celdasConOraculo: { type: 'number' },
    archivoMapa: { type: 'string' },
  },
  required: ['resumen', 'celdasTotal', 'celdasConOraculo', 'archivoMapa'],
}

const ESCENARIOS = {
  type: 'object',
  properties: {
    ids: { type: 'array', items: { type: 'string' } },
    sinOraculo: { type: 'array', items: { type: 'string' } },
    celdasSinEscenario: { type: 'number' },
    paradasDeSeguridad: { type: 'number' },
  },
  required: ['ids', 'sinOraculo', 'celdasSinEscenario', 'paradasDeSeguridad'],
}

const HALLAZGOS = {
  type: 'object',
  properties: {
    candidatos: { type: 'array', items: { type: 'string' } },
    sospechas: { type: 'number' },
    bloqueados: { type: 'number' },
  },
  required: ['candidatos', 'sospechas', 'bloqueados'],
}

const VEREDICTO = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    veredicto: { type: 'string', enum: ['confirmado', 'refutado', 'no_reproducible'] },
    razon: { type: 'string' },
  },
  required: ['id', 'veredicto', 'razon'],
}

const TRIAGE = {
  type: 'object',
  properties: {
    hallazgos: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, falla: { type: 'string' }, causa: { type: 'string' }, grave: { type: 'boolean' } }, required: ['id', 'falla', 'causa', 'grave'] } },
    fallasPropuestas: { type: 'array', items: { type: 'object', properties: { falla: { type: 'string' }, causa: { type: 'string' } }, required: ['falla', 'causa'] } },
  },
  required: ['hallazgos', 'fallasPropuestas'],
}

phase('Mapear')
const mapa = await agent(
  `Ciclo ${ciclo}. Mapea el sistema segun tu definicion (funciones, roles, estados, invariantes, oraculos, cobertura). Hosts permitidos: ${(a.hosts || []).join(', ')}. Escribi el mapa en .enjambre/trabajo/mapa-${ciclo}.md y devolve el resumen con los numeros de cobertura.`,
  { schema: MAPA, agentType: 'enjambre:cartografo', model: modelos.cartografo, phase: 'Mapear', label: 'cartografo' },
)
if (!mapa) throw new Error('el cartografo no devolvio un mapa: no se sigue sin mapa')
log(`mapa: ${mapa.celdasConOraculo}/${mapa.celdasTotal} celdas con oraculo`)

phase('Escenarios')
const esc = await agent(
  `Ciclo ${ciclo}, semilla ${semilla}. Mapa: ${mapa.archivoMapa}. ${candadoSeguridad} Genera escenarios para las celdas SIN oraculo primero y despues las de riesgo; cada uno con un oraculo determinista y su categoria. Escribi en .enjambre/trabajo/escenarios/. Lo que no tiene oraculo va a sin-oraculo.json. Devolve los ids y cuantas paradas de seguridad listaste.`,
  { schema: ESCENARIOS, agentType: 'enjambre:generador-escenarios', model: modelos.generador, phase: 'Escenarios', label: 'generador' },
)
if (!esc || !esc.ids.length) throw new Error('sin escenarios no hay exploracion')
log(`${esc.ids.length} escenarios; ${esc.sinOraculo.length} sin oraculo (van al juez); ${esc.celdasSinEscenario} celdas sin escenario; ${esc.paradasDeSeguridad} paradas de seguridad${autorizado ? '' : ' (sin autorizacion del dueño)'}`)

// Tandas deterministas: el orden de los ids es el del generador; nada de azar.
const porTanda = Math.max(1, Math.ceil(esc.ids.length / tandas))
const grupos = []
for (let i = 0; i < esc.ids.length; i += porTanda) grupos.push(esc.ids.slice(i, i + porTanda))

phase('Explorar')
const explorado = await parallel(grupos.map((ids, i) => () => agent(
  `Ciclo ${ciclo}. Corre los escenarios ${ids.join(', ')} contra los hosts permitidos (${(a.hosts || []).join(', ')}). Cada hallazgo candidato con su reproduccion minima en .enjambre/trabajo/hallazgos/. No arregles nada. Devolve los ids de los hallazgos.`,
  { schema: HALLAZGOS, agentType: 'enjambre:explorador', model: modelos.explorador, phase: 'Explorar', label: `explorador ${i + 1}/${grupos.length}` },
)))
const candidatos = explorado.filter(Boolean).flatMap((r) => r.candidatos)
const perdidas = explorado.filter((r) => !r).length
if (perdidas) log(`${perdidas} tanda(s) sin resultado (el explorador se detuvo): se reportan como no exploradas, no como limpias`)
log(`${candidatos.length} hallazgos candidatos`)

phase('Verificar')
// Un verificador por hallazgo, en contexto limpio: lee SOLO la reproduccion y el oraculo.
const veredictos = (await pipeline(candidatos, (id) => agent(
  `Reproduci el hallazgo ${id} (.enjambre/trabajo/hallazgos/${id}.json): lee SOLO reproduccion y oraculo, corre en limpio contra el mismo entorno, evalua el oraculo con codigo, intenta refutarlo una vez. Devolve id, veredicto y razon.`,
  { schema: VEREDICTO, agentType: 'enjambre:verificador', model: modelos.verificador, phase: 'Verificar', label: id, effort: 'high' },
))).filter(Boolean)
const confirmados = veredictos.filter((v) => v.veredicto === 'confirmado')
log(`${confirmados.length} confirmados, ${veredictos.filter((v) => v.veredicto === 'refutado').length} refutados, ${veredictos.filter((v) => v.veredicto === 'no_reproducible').length} no reproducibles, ${candidatos.length - veredictos.length} sin veredicto`)

phase('Triage')
let triage = { hallazgos: [], fallasPropuestas: [] }
if (confirmados.length) {
  triage = (await agent(
    `Hallazgos CONFIRMADOS del ciclo ${ciclo}: ${confirmados.map((v) => v.id).join(', ')}. La tabla causaPorFalla vigente esta en .enjambre/trabajo/causas.json. Deduplica y clasifica. Devolve el JSON.`,
    { schema: TRIAGE, agentType: 'enjambre:triage', model: modelos.triage, phase: 'Triage', label: 'triage', effort: 'low' },
  )) || triage
}

// El Pareto lo calcula el codigo del proyecto (lib/reporte.mjs) con lo que devuelve esto: el
// workflow no toca archivos.
return {
  ciclo,
  semilla,
  cobertura: { conOraculo: mapa.celdasConOraculo, total: mapa.celdasTotal },
  escenarios: esc.ids.length,
  sinOraculo: esc.sinOraculo,
  paradasDeSeguridad: esc.paradasDeSeguridad,
  autorizacionDelDuenio: autorizado,
  candidatos: candidatos.length,
  veredictos,
  confirmados: confirmados.map((v) => v.id),
  triage,
  tandasSinResultado: perdidas,
}
