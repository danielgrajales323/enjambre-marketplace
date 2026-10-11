// LAS PLANTILLAS GENÉRICAS (templates/lib): adaptación de las suites del proyecto de origen. Sin red, sin modelo.
//
//   node tests/test-plantillas.mjs
//
// Lo que fija, y cómo se invirtió cada sección (sacando el arreglo, ROJO; restaurándolo, VERDE):
//   1. LIBRO: los topes salen de la configuración; pasado el aviso nada arranca sin la bandera y
//      sin ella una corrida no CRUZA el aviso; la reserva es sólo de la corrida final y una vez;
//      falla cerrado (libro que falta, roto, con un campo de más, gasto negativo, id repetido);
//      fusión canónico/espejo que nunca cuenta de menos; con git REAL y un worktree REAL: borrar o
//      restaurar el espejo no baja el acumulado. Invertida: `fusionarLibros` quedándose con la
//      versión que MENOS cuenta → ROJO; `validarLibro` sin rechazar campos de más → ROJO.
//   2. CORTE: determinista (misma semilla, mismo corte; otra semilla, otro), independiente del
//      orden de llegada, cero ids compartidos, proporción redondeada, `problemasDelCorte` ve un
//      caso filtrado. Invertida: ordenar por id en vez de por clave → "otra semilla, otro corte" ROJO.
//   3. NÚCLEO DE JUECES: el negocio ficticio arma prompts y esquemas sin ninguna palabra del primer
//      negocio; la configuración se valida; los esquemas son estrictos y la razón va antes del
//      veredicto; `reglasIncumplidas` la decide el código; el detector de promesas respeta límites
//      de palabra y el apóstrofo curvo. Invertida: "la directora" fija en el núcleo → ROJO.
//   4. ESQUEMA: errores anidados, campos de más, enum, tipos; `salidaSegunSchema` con cada motivo;
//      un esquema flojo no viaja. Invertida: mirar sólo el primer nivel → ROJO.
//   5. COMPARADOR: ≥120 pares; a ciegas (nunca "nueva"/"anterior" ni el id); orden doble con un
//      juez que siempre prefiere la primera → 0-0 y 100% inconsistente; el código deshace el orden;
//      idénticos no gastan; una salida inválida se reintenta y después queda sin veredicto sin
//      cortar; modelo del juez explícito y obligatorio. Invertida: la segunda pasada en el mismo
//      orden → ROJO.
//   6. REPORTE: el Pareto ordena por total y acumula %; `causasHastaCubrir`; la parada a los dos
//      ciclos sin mejora (y una continuación la reinicia); la meseta; piso y techo; el reporte
//      sólo AGREGA. Invertida: Pareto sin ordenar → ROJO.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { crearChequeo, RAIZ_PLUGIN } from "./_arnes.mjs";
import * as L from "../templates/lib/libroDeGastos.mjs";
import * as C from "../templates/lib/corteReservado.mjs";
import { armarEsquemasJueces, armarPromptsJueces, citaVerificable, detectarFraseDePromesa, problemasDeConfigJueces, reglasIncumplidas } from "../templates/lib/nucleoJueces.mjs";
import { JUECES_EJEMPLO } from "../templates/lib/negocios/ejemplo.mjs";
import { erroresContraSchema, ordenDePropiedades, problemasDeSchemaEstricto, SalidaInvalida, salidaSegunSchema, SchemaNoEstricto } from "../templates/lib/esquema.mjs";
import { combinarPasadas, compararVersiones, MINIMO_DE_PARES, ordenDelPar, inconsistenciaPorJuez } from "../templates/lib/comparador.mjs";
import { agregarAlReporte, causasHastaCubrir, documentoDeCausas, evaluarMeseta, evaluarParada, gravesUnicas, lineaDeCiclo, pareto, proximoCiclo, resumirCiclo, verificarPisoYTecho } from "../templates/lib/reporte.mjs";
import { enParalelo, huellaDe, mezclar, azarConSemilla, semillaDeTexto } from "../templates/lib/util.mjs";

const { check, cerrar } = crearChequeo();
const DIR = mkdtempSync(join(tmpdir(), "enjambre-plantillas-"));
const TOPES = { topeUsd: 30, avisoUsd: 20, reservaFinalUsd: 5, margenUsd: 0.5 };
let n = 0;

console.log("1. LIBRO DE GASTOS (invertida: fusión con la que menos cuenta, ROJO)");
{
  const entradas = (lista) => lista.map((e, i) => ({
    id: `previa-${i}`, nombre: "ciclo", inicio: "2026-10-08T00:00:00Z", fin: "2026-10-08T01:00:00Z", estado: "terminada",
    estimadoUsd: e.gastadoUsd, topeUsd: e.gastadoUsd * 1.3, llamadas: 10, corridaFinal: false, repitioFinal: false, siguioDespuesDelAviso: false, ...e,
  }));
  const libro = (lista) => ({ corridas: entradas(lista) });
  const pedido = (estimadoUsd, b = {}) => ({ estimadoUsd, topeUsd: estimadoUsd * 1.3, corridaFinal: false, repetirFinal: false, sigueDespuesDelAviso: false, ...b });
  const ok = (l, p) => L.evaluarArranque(l, p, TOPES).ok;

  check("validarTopes calcula el tope de los ciclos", L.validarTopes(TOPES).topeCiclosUsd, 25);
  check("topes raros no valen (aviso > tope)", (() => { try { L.validarTopes({ ...TOPES, avisoUsd: 40 }); return "pasó"; } catch (e) { return e.name; } })(), "LibroInvalido");
  check("con US$19 gastados, una de $0,40 arranca con el tope recortado a $0,50", L.evaluarArranque(libro([{ gastadoUsd: 19 }]), pedido(0.4), TOPES).topeUsd, 0.5);
  check("con US$19, una de $0,60 (cruzaría el aviso) NO arranca sin la bandera", ok(libro([{ gastadoUsd: 19 }]), pedido(0.6)), false);
  check("…y el motivo nombra la bandera", L.evaluarArranque(libro([{ gastadoUsd: 19 }]), pedido(0.6), TOPES).motivo.includes(L.BANDERA_SIGUE_DESPUES_DEL_AVISO), true);
  check("con la bandera, arranca", ok(libro([{ gastadoUsd: 19 }]), pedido(0.6, { sigueDespuesDelAviso: true })), true);
  check("pasado el aviso (20,01) ni un centavo arranca sin bandera", ok(libro([{ gastadoUsd: 15 }, { gastadoUsd: 5.01 }]), pedido(0.01)), false);
  check("con US$24, un ciclo de $1 no arranca (la reserva es de la final)", ok(libro([{ gastadoUsd: 24 }]), pedido(1, { sigueDespuesDelAviso: true })), false);
  check("la corrida final de $1 sobre US$24, sí", ok(libro([{ gastadoUsd: 24 }]), pedido(1, { sigueDespuesDelAviso: true, corridaFinal: true })), true);
  check("la corrida final tampoco pasa el tope (29,60 + 0,10 + margen)", ok(libro([{ gastadoUsd: 29.6 }]), pedido(0.1, { sigueDespuesDelAviso: true, corridaFinal: true })), false);
  check("una SEGUNDA corrida final no arranca sin --repetir-final", ok(libro([{ gastadoUsd: 1, corridaFinal: true }]), pedido(0.5, { corridaFinal: true })), false);
  check("…con --repetir-final, sí", ok(libro([{ gastadoUsd: 1, corridaFinal: true }]), pedido(0.5, { corridaFinal: true, repetirFinal: true })), true);
  check("--repetir-final sin --corrida-final no arranca", ok(libro([]), pedido(0.5, { repetirFinal: true })), false);
  check("libro vacío, estimado $19,60 (pasaría 20 − 0,50) no arranca", ok(libro([]), pedido(19.6)), false);
  check("una corrida que murió sin cerrar cuenta su tope entero", L.acumuladoUsd(libro([{ gastadoUsd: null, estado: "en_curso", topeUsd: 19.8 }])), 19.8);
  // Falla cerrado.
  const invalido = (x) => { try { L.validarLibro(x); return "válido"; } catch (e) { return e.name; } };
  check("un campo de raíz que el libro no lleva (subir el tope a mano): inválido", invalido({ corridas: [], topeUsd: 1000 }), "LibroInvalido");
  check("gasto negativo: inválido", invalido(libro([{ gastadoUsd: -5 }])), "LibroInvalido");
  check("id repetido: inválido", invalido(libro([{ gastadoUsd: 1, id: "x" }, { gastadoUsd: 1, id: "x" }])), "LibroInvalido");
  check("estado desconocido: inválido", invalido(libro([{ gastadoUsd: 1, estado: "borrada" }])), "LibroInvalido");
  check("sin las banderas: inválido", invalido({ corridas: [{ ...entradas([{ gastadoUsd: 1 }])[0], repitioFinal: undefined }] }), "LibroInvalido");
  check("un libro bien formado: válido", invalido(libro([{ gastadoUsd: 1 }])), "válido");
  check("leer un libro que no existe lanza (no se toma como vacío)", (() => { try { L.leerLibro(join(DIR, "no.json")); return "leyó"; } catch (e) { return e.name; } })(), "LibroInvalido");
  // Fusión.
  const a = libro([{ gastadoUsd: 1, id: "a" }, { gastadoUsd: 2, id: "b" }]);
  const b = libro([{ gastadoUsd: 3, id: "b" }, { gastadoUsd: 5, id: "c" }]);
  check("fusión: a ∪ b por id, el mayor de cada id (1 + 3 + 5)", [L.acumuladoUsd(L.fusionarLibros(a, b)), L.acumuladoUsd(L.fusionarLibros(b, a))], [9, 9]);
  check("fusión: nunca menos que ninguna de las copias", L.acumuladoUsd(L.fusionarLibros(a, b)) >= Math.max(L.acumuladoUsd(a), L.acumuladoUsd(b)), true);
  // Con git REAL y un worktree REAL.
  const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=p", "-c", "user.email=p@ejemplo.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const raiz = join(DIR, "repo");
  mkdirSync(join(raiz, ".enjambre"), { recursive: true });
  git(raiz, "init", "-q");
  const espejo = join(raiz, ".enjambre", "gastos.json");
  writeFileSync(espejo, JSON.stringify({ corridas: [] }, null, 2) + "\n");
  git(raiz, "add", ".enjambre/gastos.json");
  git(raiz, "commit", "-q", "-m", "libro vacio");
  const wt = join(DIR, "otro-worktree");
  git(raiz, "worktree", "add", "-q", wt);
  const rutas = L.rutasLibro(espejo);
  const rutasWt = L.rutasLibro(join(wt, ".enjambre", "gastos.json"));
  const norm = (p) => resolve(p).toLowerCase();
  check("el canónico vive en <repo>/.git/enjambre/gastos.json", norm(rutas.canonico), norm(join(raiz, ".git", "enjambre", "gastos.json")));
  check("…y desde el otro worktree es EL MISMO archivo", norm(rutasWt.canonico), norm(rutas.canonico));
  check("sin canónico, abrir una corrida lanza (falla cerrado)", (() => { try { L.abrirCorrida(rutas, { nombre: "t", ...pedido(0.4) }, TOPES); return "abrió"; } catch (e) { return e.name; } })(), "LibroInvalido");
  L.crearLibroCanonico(rutas);
  check("crear el canónico dos veces: se niega", (() => { try { L.crearLibroCanonico(rutas); return "pisó"; } catch (e) { return e.name; } })(), "LibroInvalido");
  const r1 = L.abrirCorrida(rutas, { nombre: "ciclo-1", ...pedido(0.4) }, TOPES);
  check("abre: ok, id y tope (0,4 × 1,3 = 0,52)", [r1.ok, typeof r1.id, r1.topeUsd], [true, "string", 0.52]);
  check("mientras corre, el acumulado cuenta el tope entero", L.acumuladoUsd(L.leerLibroEfectivo(rutas)), 0.52);
  check("…y el candado quedó suelto", existsSync(L.rutaCandadoLibro(rutas)), false);
  L.cerrarCorrida(rutas, r1.id, "terminada", 0.5, 7);
  check("al cerrar: lo medido, en las dos copias", [L.acumuladoUsd(L.leerLibro(rutas.canonico)), L.acumuladoUsd(L.leerLibro(rutas.espejo))], [0.5, 0.5]);
  check("el otro worktree (espejo commiteado vacío) también ve $0,50", [L.acumuladoUsd(L.leerLibro(rutasWt.espejo)), L.acumuladoUsd(L.leerLibroEfectivo(rutasWt))], [0, 0.5]);
  git(raiz, "checkout", "--", ".enjambre/gastos.json");
  check("`git checkout --` del espejo lo vacía, pero el acumulado sigue en $0,50", [L.acumuladoUsd(L.leerLibro(espejo)), L.acumuladoUsd(L.leerLibroEfectivo(rutas))], [0, 0.5]);
  unlinkSync(espejo);
  check("borrar el espejo: el acumulado sigue en $0,50", L.acumuladoUsd(L.leerLibroEfectivo(rutas)), 0.5);
  check("desde el otro worktree, una de $19,10 no arranca (0,5 + 19,1 + 0,5 > 20)", L.abrirCorrida(rutasWt, { nombre: "x", ...pedido(19.1) }, TOPES).ok, false);
  check("…y cerrar con un estado raro lanza", (() => { try { L.cerrarCorrida(rutas, r1.id, "lista", 1, 1); return "cerró"; } catch (e) { return e.name; } })(), "LibroInvalido");
  check("banderasDeArgv", L.banderasDeArgv(["node", "x", "--corrida-final", "--sigue-despues-del-aviso"]), { corridaFinal: true, repetirFinal: false, sigueDespuesDelAviso: true });
  check("esScriptCorridaFinal compara rutas reales", [L.esScriptCorridaFinal(join(raiz, "a.mjs"), join(raiz, "a.mjs")), L.esScriptCorridaFinal(join(raiz, "b.mjs"), join(raiz, "a.mjs")), L.esScriptCorridaFinal(undefined, "x")], [true, false, false]);
}

console.log("\n2. CORTE DEL RESERVADO (invertida: ordenar por id, ROJO en \"otra semilla, otro corte\")");
{
  const ids = Array.from({ length: 50 }, (_, i) => `caso-${String(i).padStart(3, "0")}`);
  const casos = { mensaje: ids, conversacion: ids.slice(0, 20).map((x) => `conv-${x}`) };
  const c1 = C.cortar(casos, "semilla-1");
  const c2 = C.cortar({ mensaje: [...ids].reverse(), conversacion: [...casos.conversacion].reverse() }, "semilla-1");
  const c3 = C.cortar(casos, "semilla-2");
  check("misma semilla, mismo corte (aunque llegue en otro orden)", JSON.stringify(c1), JSON.stringify(c2));
  check("otra semilla, otro corte", JSON.stringify(c1.reservado) !== JSON.stringify(c3.reservado), true);
  check("30% redondeado por tipo (15 de 50, 6 de 20)", C.tamanios(c1.reservado), { conversacion: 6, mensaje: 15 });
  check("el resto va a trabajo", C.tamanios(c1.trabajo), { conversacion: 14, mensaje: 35 });
  check("cero ids compartidos", C.idsCompartidos(c1.trabajo, c1.reservado), 0);
  check("todo caso está en uno de los dos", C.todosLosIds(c1.trabajo).size + C.todosLosIds(c1.reservado).size, 70);
  check("otra proporción", C.tamanios(C.cortar(casos, "s", 0.5).reservado), { conversacion: 10, mensaje: 25 });
  check("sin semilla, lanza", (() => { try { C.cortar(casos, ""); return "cortó"; } catch (e) { return "lanzó"; } })(), "lanzó");
  const { trabajo, reservado, registro } = C.armarArchivos(casos, "semilla-1", { fecha: "2026-10-10T00:00:00Z" });
  check("los archivos llevan la semilla, la huella y los tamaños", [trabajo.semilla, trabajo.huella === C.huella(trabajo.casos), registro.reservado.tamanios], ["semilla-1", true, { conversacion: 6, mensaje: 15 }]);
  check("el corte bien hecho no tiene problemas", C.problemasDelCorte(trabajo, reservado, registro), []);
  const filtrado = { ...trabajo, casos: { ...trabajo.casos, mensaje: [...trabajo.casos.mensaje, reservado.casos.mensaje[0]] } };
  const p = C.problemasDelCorte(filtrado, reservado, registro);
  check("un caso reservado filtrado al trabajo se detecta (id compartido, huella y tamaño)", [p.length, p[0]], [3, "1 id(s) aparecen en los dos sets"]);
}

console.log("\n3. NÚCLEO DE JUECES con un negocio ficticio (invertida: \"la directora\" fija en el núcleo, ROJO)");
{
  // Los nombres del negocio FICTICIO del ejemplo (la academia) y los de un segundo ficticio: si alguno
  // aparece en el núcleo, el núcleo dejó de ser genérico. Un proyecto agrega acá los de SU negocio.
  const NOMBRES_DEL_PRIMER_NEGOCIO = /comp[aá]s|directora|academia|salsa|baile|whatsapp|peluquer[ií]a|marta/i;
  const nucleo = readFileSync(join(RAIZ_PLUGIN, "templates", "lib", "nucleoJueces.mjs"), "utf8");
  check("el núcleo no nombra a ningún negocio, dueño, canal ni rubro", nucleo.match(NOMBRES_DEL_PRIMER_NEGOCIO), null);
  check("la búsqueda ve cada nombre (sensibilidad)", ["la directora", "Academia Compás", "una clase de salsa", "WhatsApp"].map((s) => NOMBRES_DEL_PRIMER_NEGOCIO.test(s)), [true, true, true, true]);
  check("el núcleo es puro: no importa nada", /^\s*import\s/m.test(nucleo), false);
  check("el ejemplo ficticio es válido", problemasDeConfigJueces(JUECES_EJEMPLO), []);
  const P = armarPromptsJueces(JUECES_EJEMPLO);
  // Lo del negocio entra SÓLO por la configuración: los prompts armados con la academia la nombran, el núcleo no.
  check("los prompts armados nombran a la academia (lo que viene de la configuración)", /academia/.test(P.instruccionesJuezRespuesta) && /directora/.test(P.instruccionesJuezRespuesta), true);
  check("el juez se presenta con la asistente del ejemplo y cita a la directora", [P.instruccionesJuezRespuesta.startsWith("Eres un juez de calidad de la asistente virtual de WhatsApp de una academia de baile."), P.instruccionesJuezRespuesta.includes("(aprobada por la directora)")], [true, true]);
  check("el comparador numera los criterios y cierra con \"esos tres puntos\"", [/\n1\. Lo grave/.test(P.systemComparador), P.systemComparador.includes('Si son equivalentes en esos tres puntos, "igual".')], [true, true]);
  check("estructura del núcleo: razón primero, cita textual, rúbrica", ["escribe PRIMERO la razón", "CITA textual", "cuándo PASA, cuándo FALLA y cuándo NO APLICA", "no prefieras la primera ni la segunda por su lugar"].map((s) => (P.instruccionesJuezRespuesta + P.systemComparador).includes(s)), [true, true, true, true]);
  check("sin ejemplos no queda un renglón colgado", armarPromptsJueces({ ...JUECES_EJEMPLO, ejemplos: [] }).instruccionesJuezRespuesta.endsWith("\n"), false);
  // Validación.
  const con = (cambio) => problemasDeConfigJueces({ ...JUECES_EJEMPLO, ...cambio });
  check("pregunta sin rúbrica", con({ rubricas: { p1_largo: JUECES_EJEMPLO.rubricas.p1_largo, p2_horarios: JUECES_EJEMPLO.rubricas.p2_horarios } }), ["Academia Compás (ejemplo ficticio): p3_clase_de_prueba no tiene rúbrica"]);
  check("rúbrica sin FALLA", con({ rubricas: { ...JUECES_EJEMPLO.rubricas, p1_largo: "PASA: x." } }).length, 1);
  check("clave de criterio que pisa un campo fijo", con({ esquemas: { ...JUECES_EJEMPLO.esquemas, claveVoz: "seguridad" } }), ["Academia Compás (ejemplo ficticio): claveVoz pisa el campo fijo seguridad"]);
  check("frase de promesa con tilde", con({ frasesDePromesa: ["Te llamaré"] }).length, 1);
  check("comparador sin criterios", con({ criteriosDelComparador: [] }).length, 1);
  check("armar con una config inválida revienta", (() => { try { armarEsquemasJueces({ ...JUECES_EJEMPLO, frasesDePromesa: [] }); return "armó"; } catch (e) { return e.message.startsWith("Configuración de los jueces inválida"); } })(), true);
  // Esquemas.
  const E = armarEsquemasJueces(JUECES_EJEMPLO);
  // Los esquemas de la academia la nombran (viene de su configuración) y no nombran a OTRO negocio.
  check("los esquemas nombran a la academia y a ningún otro negocio", [/directora/.test(JSON.stringify(E)), /peluquer[ií]a|marta/i.test(JSON.stringify(E))], [true, false]);
  check("la clave de criterio sale de la configuración, en el cuarto lugar", Object.keys(E.respuesta.properties), ["contesta", "chequeo", "dato_no_respaldado", "suena_a_la_academia", "plantilla", "seguridad"]);
  check("estrictos en todos los niveles", [problemasDeSchemaEstricto(E.respuesta), problemasDeSchemaEstricto(E.conversacion)], [[], []]);
  const antes = (schema, a, b) => { const o = ordenDePropiedades(schema); return o.indexOf(a) >= 0 && o.indexOf(a) < o.indexOf(b); };
  check("la razón antes del veredicto en cada pregunta, en contesta y en objetivo", [JUECES_EJEMPLO.preguntas.every((p) => antes(E.chequeo.properties[p.clave], "razon", "veredicto")), antes(E.respuesta.properties.contesta, "por_que", "ok"), antes(E.conversacion.properties.objetivo, "por_que", "resultado")], [true, true, true]);
  check("cada pregunta lleva su rúbrica en la descripción del veredicto", JUECES_EJEMPLO.preguntas.every((p) => E.chequeo.properties[p.clave].properties.veredicto.description.endsWith(JUECES_EJEMPLO.rubricas[p.clave])), true);
  // El código decide.
  const salida = { chequeo: { p1_largo: { razon: "x", veredicto: "pasa" }, p2_horarios: { razon: "x", veredicto: "falla" }, p3_clase_de_prueba: { razon: "x", veredicto: "no_aplica" } } };
  check("reglasIncumplidas: sólo \"falla\" cuenta", reglasIncumplidas(salida, JUECES_EJEMPLO.preguntas), ["R2"]);
  check("el detector: encuentra las del ejemplo (tildes, apóstrofo curvo) y respeta límites de palabra", [
    detectarFraseDePromesa("¡Claro! Ya tienes tu lugar el jueves.", JUECES_EJEMPLO.frasesDePromesa),
    detectarFraseDePromesa("We’ll call you tomorrow", JUECES_EJEMPLO.frasesDePromesa),
    detectarFraseDePromesa("tengo mi te reservorio", JUECES_EJEMPLO.frasesDePromesa),
    detectarFraseDePromesa("Lo coordina la directora", JUECES_EJEMPLO.frasesDePromesa),
  ], ["ya tienes tu lugar", "we'll call you", null, null]);
  check("citaVerificable ignora mayúsculas, tildes y signos; rechaza citas cortas o ausentes", [citaVerificable("Ya tienes tu LUGAR", ["¡Claro! ya tienes tu lugar el jueves"]), citaVerificable("ab", ["ab"]), citaVerificable("no está", ["otra cosa"])], [true, false, false]);
}

console.log("\n4. ESQUEMA en todos los niveles (invertida: sólo el primer nivel, ROJO)");
{
  const schema = { type: "object", properties: { a: { type: "object", properties: { hay: { type: "boolean" }, cita: { type: "string" } }, required: ["hay", "cita"], additionalProperties: false }, e: { type: "string", enum: ["x", "y"] }, lista: { type: "array", items: { type: "integer" } } }, required: ["a", "e", "lista"], additionalProperties: false };
  check("una salida completa cumple", erroresContraSchema({ a: { hay: true, cita: "c" }, e: "x", lista: [1] }, schema), []);
  check("falta un campo ANIDADO: se nombra la ruta", erroresContraSchema({ a: { cita: "c" }, e: "x", lista: [] }, schema), ["$.a.hay: falta (requerido)"]);
  check("campo de más, enum y tipo", erroresContraSchema({ a: { hay: true, cita: "c", extra: 1 }, e: "z", lista: ["no"] }, schema), ["$.a.extra: campo que el esquema no tiene", "$.e: valor fuera del enum", "$.lista[0]: se esperaba integer y llegó string"]);
  check("un esquema flojo se nombra", problemasDeSchemaEstricto({ type: "object", properties: { a: { type: "string" } } }), ["$: falta additionalProperties: false", "$.a: no está en required"]);
  const motivo = (texto, stop) => { try { salidaSegunSchema("juez", texto, stop, schema); return "ok"; } catch (e) { return `${e.name}:${e.motivo ?? ""}`; } };
  check("salidaSegunSchema: refusal, max_tokens, no_json, esquema", [motivo("{}", "refusal"), motivo("{}", "max_tokens"), motivo("no json", "end_turn"), motivo("{}", "end_turn")], ["SalidaInvalida:refusal", "SalidaInvalida:max_tokens", "SalidaInvalida:no_json", "SalidaInvalida:esquema"]);
  check("salidaSegunSchema: una salida válida vuelve como objeto", salidaSegunSchema("juez", JSON.stringify({ a: { hay: false, cita: "" }, e: "y", lista: [] }), "end_turn", schema).e, "y");
  check("un esquema que no es estricto no viaja", (() => { try { salidaSegunSchema("juez", "{}", "end_turn", { type: "object", properties: { a: { type: "string" } } }); return "viajó"; } catch (e) { return e instanceof SchemaNoEstricto; } })(), true);
}

console.log("\n5. COMPARADOR en orden doble, a ciegas (invertida: la segunda pasada en el mismo orden, ROJO)");
{
  const pares = (k, nueva = "Eso lo coordina la directora: <link>", anterior = "¡Perfecto! Te atiendo personalmente ✨ <link>") =>
    Array.from({ length: k }, (_, i) => ({ id: `par_${i}`, contexto: `Ella escribió: """quiero probar ${i}"""`, nueva, anterior }));
  const r1De = (usuario) => /Respuesta 1:\n"""([\s\S]*?)"""/.exec(usuario)?.[1] ?? "";
  const vistos = [];
  const prefiereLaNueva = async (usuario) => { vistos.push(usuario); return { mejor: r1De(usuario).startsWith("Eso lo coordina") ? "1" : "2", por_que: "contesta sin prometer" }; };
  const base = { semilla: 20261008, enEmpate: "anterior", juez: { modelo: "modelo-juez-ficticio" }, system: "SYSTEM" };
  const e = await (async () => { try { await compararVersiones(pares(119), { ...base, llamar: prefiereLaNueva }); return ""; } catch (err) { return err.message; } })();
  check("119 pares: se rechaza sin gastar", [/hacen falta 120/.test(e), vistos.length], [true, 0]);
  check("no se puede bajar el mínimo", await (async () => { try { await compararVersiones(pares(50), { ...base, llamar: prefiereLaNueva, minimo: 40 }); return ""; } catch (err) { return /no puede bajar de 120/.test(err.message); } })(), true);
  check("sin el modelo explícito del juez, no compara", await (async () => { try { await compararVersiones(pares(MINIMO_DE_PARES), { ...base, juez: {}, llamar: prefiereLaNueva }); return ""; } catch (err) { return /modelo EXPL/.test(err.message); } })(), true);
  const ids = Array.from({ length: 200 }, (_, i) => `par_${i}`);
  const orden = ids.map((id) => ordenDelPar(id, 20261008));
  check("el orden sale de la semilla y del id: misma semilla mismo orden; otra, otro; no depende del lugar", [
    JSON.stringify(ids.map((id) => ordenDelPar(id, 20261008))) === JSON.stringify(orden),
    JSON.stringify(ids.map((id) => ordenDelPar(id, 7))) !== JSON.stringify(orden),
    JSON.stringify([...ids].reverse().map((id) => ordenDelPar(id, 20261008)).reverse()) === JSON.stringify(orden),
    orden.filter(Boolean).length > 70 && orden.filter(Boolean).length < 130,
  ], [true, true, true, true]);
  const r = await compararVersiones(pares(MINIMO_DE_PARES), { ...base, llamar: prefiereLaNueva });
  check("la nueva gana los 120, esté primera o segunda", [r.victoriasNueva, r.victoriasAnterior, r.ganaNueva, r.inconsistentes], [120, 0, true, 0]);
  check("dos llamadas por par distinto (orden doble)", vistos.length, 240);
  check("las dos pasadas de cada par van en órdenes opuestos", r.detalle.every((d) => d.pasadas.length === 2 && d.pasadas[0].nuevaPrimero !== d.pasadas[1].nuevaPrimero), true);
  const todo = vistos.join("\n").toLowerCase();
  check("a ciegas: el modelo nunca lee \"nueva\", \"anterior\", \"versión\" ni el id", [/\bnueva\b|\banterior\b|versi[oó]n/.test(todo), /par_\d+/.test(todo)], [false, false]);
  check("el juez queda registrado", r.juez, { rol: "comparador", modelo: "modelo-juez-ficticio" });
  // Un juez con sesgo de posición puro: siempre la primera.
  const siemprePrimera = async () => ({ mejor: "1", por_que: "la primera" });
  const s = await compararVersiones(pares(MINIMO_DE_PARES), { ...base, llamar: siemprePrimera });
  check("un juez que siempre elige la primera: 0-0, 120 inconsistentes, 100%", [s.victoriasNueva, s.victoriasAnterior, s.inconsistentes, s.tasaInconsistenciaPct, s.ganaNueva], [0, 0, 120, 100, false]);
  check("combinarPasadas: la regla", [combinarPasadas("nueva", "nueva"), combinarPasadas("nueva", "anterior"), combinarPasadas("nueva", "igual"), combinarPasadas(null, "nueva")], ["nueva", "inconsistente", "inconsistente", "sin_veredicto"]);
  // Idénticos no gastan; empate decide quien llama.
  let llamadas = 0;
  const igual = async () => { llamadas++; return { mejor: "igual", por_que: "equivalentes" }; };
  const t = await compararVersiones([...pares(60), ...pares(60, "Te leo.", "Te leo.")], { ...base, llamar: igual });
  check("60 idénticos no llamaron; 60 distintos, dos veces", [llamadas, t.detalle.filter((d) => d.identico).length, t.iguales], [120, 60, 120]);
  check("empate: enEmpate manda", [t.empate, t.ganaNueva, (await compararVersiones(pares(MINIMO_DE_PARES, "a", "a"), { ...base, enEmpate: "nueva", llamar: igual })).ganaNueva], [true, false, true]);
  // Salida inválida: reintento, y después sin veredicto sin cortar.
  let intentos = 0;
  const fallaUnaVez = async (u) => { intentos++; if (intentos === 1) throw new SalidaInvalida("x", "no_json"); return prefiereLaNueva(u); };
  const f = await compararVersiones(pares(MINIMO_DE_PARES), { ...base, llamar: fallaUnaVez });
  check("una salida inválida se reintenta y el par queda con veredicto", [f.sinVeredicto, f.victoriasNueva], [0, 120]);
  const siempreFalla = async () => { throw new SalidaInvalida("x", "refusal"); };
  const g = await compararVersiones(pares(MINIMO_DE_PARES), { ...base, llamar: siempreFalla });
  check("si vuelve a fallar: sin veredicto, con su motivo (una vez por pasada: 2 × 120), y la comparación sigue", [g.sinVeredicto, g.sinVeredictoPorMotivo.refusal, g.conDosVeredictos], [120, 240, 0]);
  const otroError = async () => { throw new Error("tope de gasto alcanzado"); };
  check("cualquier otro error corta la comparación entera", await (async () => { try { await compararVersiones(pares(MINIMO_DE_PARES), { ...base, llamar: otroError }); return "siguió"; } catch (err) { return err.message; } })(), "tope de gasto alcanzado");
  check("inconsistenciaPorJuez agrupa por modelo", inconsistenciaPorJuez([r, s])["modelo-juez-ficticio"], { inconsistentes: 120, conDosVeredictos: 240, pct: 50, sinVeredicto: 0 });
  check("normalizar se aplica antes de comparar (los tokens no llegan al juez)", await (async () => {
    const vis = [];
    await compararVersiones(pares(MINIMO_DE_PARES, "Son {precio}.", "Son {precio}. ¿Qué zona?"), { ...base, llamar: async (u) => { vis.push(u); return { mejor: "igual", por_que: "" }; }, normalizar: (s) => s.replace("{precio}", "$180") });
    return vis.every((u) => u.includes("$180") && !u.includes("{precio}"));
  })(), true);
}

console.log("\n6. REPORTE: Pareto, parada, meseta, piso y techo, append-only (invertida: Pareto sin ordenar, ROJO)");
{
  const CAUSA = { no_contesta: "prompt", promete: "validador", dato_falso: "validador", no_recuerda: "prompt", plantilla_incorrecta: "ruteo" };
  const v = (casoId, fallas, graves = []) => ({ casoId, aprobada: fallas.length === 0, fallas, graves });
  // El orden de llegada es DISTINTO del orden por frecuencia (si el Pareto no ordenara, se notaría).
  const veredictos = [
    v("c3", ["no_contesta"]), v("c5", ["plantilla_incorrecta"]), v("c7", ["rara"]),
    v("c1", ["promete"], [{ tipo: "promete", evidencia: "te llamo" }]), v("c2", ["promete", "dato_falso"], [{ tipo: "promete", evidencia: "Te LLAMO mañana" }]),
    v("c4", ["promete"]), v("c6", []),
  ];
  const p = pareto(veredictos, CAUSA);
  check("ordenado por total, con % y acumulado", p.map((g) => [g.causa, g.total, g.acumuladoPct]), [["validador", 3, 50], ["prompt", 1, 66.7], ["ruteo", 1, 83.3], ["sin_causa", 1, 100]]);
  check("por tipo de falla dentro de la causa", p[0].porFalla, { promete: 3, dato_falso: 1 });
  check("causasHastaCubrir el 80%: 3", causasHastaCubrir(p, 80), 3);
  check("gravesUnicas: la misma promesa citada dos veces en el mismo caso es una", gravesUnicas([v("c1", [], [{ tipo: "promete", evidencia: "te llamo" }, { tipo: "promete", evidencia: "TE LLAMO mañana" }])]).length, 1);
  const r = resumirCiclo({ ciclo: 1, set: "trabajo", veredictos, comparacion: null, costoAcumuladoUsd: 3.5, huellaJueces: "abc", causaPorFalla: CAUSA, fecha: "2026-10-10 12:00", hallazgosNuevos: 2 });
  check("resumen: % aprobados, graves, causa principal, criterios", [r.casos, r.graves.total, r.causaPrincipal, r.criterios], [{ total: 7, aprobados: 1, pct: 14.3 }, 2, "validador", { aprobadas: false, graves: false }]);
  const linea = lineaDeCiclo(r);
  check("la línea del reporte lleva el Pareto y el costo", [/validador: 3, 50%/.test(linea), /US\$3\.50/.test(linea), /\| 2 \|/.test(linea)], [true, true, true]);
  const archivo = join(DIR, "reporte.md");
  agregarAlReporte(r, archivo);
  const antes = readFileSync(archivo, "utf8");
  agregarAlReporte({ ...r, ciclo: 2 }, archivo);
  const despues = readFileSync(archivo, "utf8");
  check("el reporte sólo agrega: lo anterior queda igual y hay una línea más", [despues.startsWith(antes), despues.split("\n").length - antes.split("\n").length], [true, 1]);
  const doc = documentoDeCausas({ ciclo: 1, fecha: "2026-10-10", huellaJueces: "abc", commit: "deadbee", pareto: p });
  check("el documento de causas marca las que se arreglan y exige reproducción con oráculo", [/validador \*\*\(arreglar\)\*\*/.test(doc), /reproducción mínima y lo confirmó un oráculo/.test(doc), /Nunca\*\* una regla ad hoc/.test(doc)], [true, true, true]);
  // Parada y meseta.
  const c = (ciclo, mejoro, extra = {}) => ({ ciclo, mejoro, ...extra });
  check("dos ciclos seguidos sin mejora: parar", evaluarParada([c(0, null), c(1, false), c(2, false)]).parar, true);
  check("uno sí, uno no: sigue", evaluarParada([c(1, false), c(2, true), c(3, false)]).parar, false);
  check("una continuación del supervisor reinicia la cuenta", evaluarParada([c(1, false), c(2, false, { continuoTrasParada: true }), c(3, true)]).parar, false);
  check("el ciclo cero no cuenta", evaluarParada([c(0, false), c(1, false)]).parar, false);
  check("meseta: dos ciclos sin hallazgos nuevos confirmados", [evaluarMeseta([{ ciclo: 1, hallazgosNuevos: 3 }, { ciclo: 2, hallazgosNuevos: 0 }, { ciclo: 3, hallazgosNuevos: 0 }]).meseta, evaluarMeseta([{ ciclo: 1, hallazgosNuevos: 0 }, { ciclo: 2, hallazgosNuevos: 1 }]).meseta], [true, false]);
  check("proximoCiclo", [proximoCiclo([]), proximoCiclo([c(0, null), c(3, true)])], [0, 4]);
  check("piso y techo: los dos lados", [verificarPisoYTecho({ atrapados: 63, totalPositivos: 63, tocados: 0, totalNegativos: 54 }, { piso: 49, techo: 6 }).ok, verificarPisoYTecho({ atrapados: 40, totalPositivos: 63, tocados: 9, totalNegativos: 54 }, { piso: 49, techo: 6 }).problemas.length], [true, 2]);
}

console.log("\n7. UTILIDADES");
{
  check("azar con semilla: misma secuencia", [azarConSemilla(7)(), azarConSemilla(7)()], [azarConSemilla(7)(), azarConSemilla(7)()]);
  check("semillaDeTexto: estable y de 31 bits", [semillaDeTexto("a") === semillaDeTexto("a"), semillaDeTexto("a") < 2 ** 31], [true, true]);
  check("mezclar no toca el original y es determinista", (() => { const xs = [1, 2, 3, 4, 5]; const m = mezclar(xs, azarConSemilla(1)); return [xs, m.length, JSON.stringify(m) === JSON.stringify(mezclar(xs, azarConSemilla(1)))]; })(), [[1, 2, 3, 4, 5], 5, true]);
  check("huellaDe: 12 hex, sensible a cada parte", [huellaDe("a", "b").length, huellaDe("a", "b") !== huellaDe("ab")], [12, true]);
  check("enParalelo: en orden, y el primer error corta", [await enParalelo([3, 1, 2], 2, async (x) => x * 2), await (async () => { try { await enParalelo([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error("tope"); return x; }); return "siguió"; } catch (e) { return e.message; } })()], [[6, 2, 4], "tope"]);
}

cerrar();
