// VARIAS VARIANTES EN UNA SOLA CORRIDA, contra el MISMO control, y ninguna decide sola.
//
// Pieza genérica, copiada y adaptada de `variantes.ts` (lote proceso) del proyecto
// de origen (regla P4 del núcleo conversacional). Una variante es una configuración distinta del redactor o
// de lo que lee (otro modelo, otro juez de anclaje, otra forma de ver el hilo…). Corre sobre el MISMO
// set que el control, con el mismo azar por caso, y se compara a ciegas en orden doble contra lo que
// generó el CONTROL de esa corrida, nunca contra otra variante. La variante nunca decide: la ganadora
// del ciclo sigue siendo el control; adoptarla es un cambio de código con su prueba.
//
// Qué se valida ANTES de gastar (VarianteInvalida):
//   · 1 a `maximo` variantes, nombres únicos en minúscula ([a-z0-9-], hasta 30);
//   · sólo las claves que el experimento del proyecto entiende (otra clave se rechaza, no se ignora);
//   · que la variante cambie algo (sin parámetros sería el control otra vez);
//   · que pueda redactar (juez de anclaje distinto del redactor, si el proyecto tiene anclaje);
//   · la REGLA DE ORO con la tabla de modelos: ningún juez ni comparador de la familia del redactor
//     de la variante NI del control (`modelos.mjs`);
//   · que haya un perfil de costo para sus modelos (`tienePerfil`), o la estimación mentiría.

import { existsSync, readFileSync } from "node:fs";
import { familiaDe, verificarTablaDeModelos } from "./modelos.mjs";

export const MAXIMO_VARIANTES_POR_DEFECTO = 3;
const NOMBRE = /^[a-z0-9-]{1,30}$/;

export class VarianteInvalida extends Error {
  constructor(msg) {
    super(msg);
    this.name = "VarianteInvalida";
  }
}

/**
 * Valida y arma las variantes.
 * @param defs [{ nombre, ...claves del experimento }]
 * @param o {
 *   clavesDelExperimento: string[],          // p. ej. ["modeloRedactor", "modeloJuez", "verTextoViejo"]
 *   redactorControl: string,                  // el modelo del redactor de producción
 *   redactorDe: (x) => string,                // el redactor que resulta del experimento (por defecto x.modeloRedactor ?? control)
 *   anclajeDe?: (x) => string | null,         // el juez de anclaje que resulta (null = el proyecto no tiene)
 *   modelosPara: (redactores: string[]) => tabla rol → modelo,   // la tabla de jueces para esos redactores
 *   tienePerfil?: (rol, modelo) => boolean,   // perfil de costo
 *   rolesQueJuzgan?: string[], maximo?: number
 * }
 */
export function variantesDesdeDefiniciones(defs, o) {
  const maximo = o.maximo ?? MAXIMO_VARIANTES_POR_DEFECTO;
  if (!Array.isArray(defs) || defs.length === 0) throw new VarianteInvalida("el archivo de variantes necesita \"variantes\": [ ... ] con una o más");
  if (defs.length > maximo) throw new VarianteInvalida(`como mucho ${maximo} variantes por corrida (el costo escala con N); hay ${defs.length}`);
  const vistas = new Set();
  const redactorDe = o.redactorDe ?? ((x) => x.modeloRedactor ?? o.redactorControl);
  return defs.map((d) => {
    const nombre = String(d?.nombre ?? "");
    if (!NOMBRE.test(nombre)) throw new VarianteInvalida(`nombre de variante inválido ("${nombre}"): minúsculas, números y guiones, hasta 30`);
    if (vistas.has(nombre)) throw new VarianteInvalida(`la variante "${nombre}" está dos veces`);
    vistas.add(nombre);
    const extra = Object.keys(d).filter((k) => k !== "nombre" && !o.clavesDelExperimento.includes(k));
    if (extra.length) throw new VarianteInvalida(`la variante "${nombre}" trae claves que el experimento no entiende (${extra.join(", ")}): sólo ${o.clavesDelExperimento.join(", ")}`);
    const x = Object.fromEntries(Object.entries(d).filter(([k, v]) => k !== "nombre" && v !== undefined && v !== false));
    if (!Object.keys(x).length) throw new VarianteInvalida(`la variante "${nombre}" no cambia nada: sería el control otra vez`);
    const redactor = redactorDe(x);
    const anclaje = o.anclajeDe ? o.anclajeDe(x) : null;
    if (anclaje && familiaDe(anclaje) === familiaDe(redactor)) throw new VarianteInvalida(`la variante "${nombre}" no puede redactar: el juez de anclaje (${anclaje}) es de la familia del redactor (${redactor})`);
    try {
      verificarTablaDeModelos(o.modelosPara([redactor]), [redactor], { rolesQueJuzgan: o.rolesQueJuzgan });
      verificarTablaDeModelos(o.modelosPara([redactor, o.redactorControl]), [redactor, o.redactorControl], { rolesQueJuzgan: o.rolesQueJuzgan, soloRol: "comparador" });
      if (o.tienePerfil) {
        const tabla = o.modelosPara([redactor, o.redactorControl]);
        for (const [rol, modelo] of [["redactor", redactor], ...(anclaje ? [["anclaje", anclaje]] : []), ["juez", tabla.juez], ["comparador", tabla.comparador]]) {
          if (modelo && !o.tienePerfil(rol, modelo)) throw new Error(`no hay perfil de costo para ${rol} con ${modelo}: la estimación mentiría`);
        }
      }
    } catch (err) {
      throw new VarianteInvalida(`la variante "${nombre}": ${err.message}`);
    }
    return { nombre, experimento: Object.freeze(x), redactor, anclaje };
  });
}

export function leerVariantes(archivo, o) {
  if (!existsSync(archivo)) throw new VarianteInvalida(`no existe el archivo de variantes (${archivo})`);
  let j;
  try { j = JSON.parse(readFileSync(archivo, "utf8")); } catch { throw new VarianteInvalida(`el archivo de variantes (${archivo}) no es JSON`); }
  return variantesDesdeDefiniciones(j?.variantes, o);
}

/** Los redactores de los pares variante contra control (para la tabla del comparador). */
export const redactoresDelPar = (v, redactorControl) => [...new Set([v.redactor, redactorControl])];

/**
 * El documento de las variantes: el control y cada variante lado a lado, con su comparación.
 * @param o { ciclo, fecha, control: ResumenCiclo (reporte.mjs), variantes: [{ nombre, redactor, anclaje, resumen, comparacion, errores }], parcial? }
 */
export function documentoDeVariantes(o) {
  const fila = (nombre, r, extra) => `| ${nombre} | ${r.casos.pct}% (${r.casos.aprobados}/${r.casos.total}) | ${r.graves.total} | ${r.causaPrincipal ?? "—"} | ${extra} |`;
  const l = [
    `# Enjambre — variantes del ciclo ${o.ciclo}${o.parcial ? " (PARCIAL: no decide)" : ""}`,
    "",
    `Generado el ${o.fecha}. Cada variante corrió sobre el MISMO set que el control y se comparó contra el control a ciegas, en orden doble.`,
    "**Ninguna variante cambia la ganadora del ciclo ni la parada**: adoptar una es un cambio de código con su prueba, y lo decide el supervisor.",
    "",
    "| rama | % aprobados | graves | causa principal | contra el control |",
    "|---|---|---|---|---|",
    fila("control (producción)", o.control, "—"),
  ];
  for (const v of o.variantes) {
    const c = v.comparacion;
    const contra = c
      ? `${c.ganaNueva ? "**le gana**" : "no le gana"} (${c.victoriasNueva}-${c.victoriasAnterior}, =${c.iguales}, ${c.pares} pares, semilla ${c.semilla}; orden doble ${c.juez?.modelo ?? "?"}: ${c.inconsistentes}/${c.conDosVeredictos} inconsistentes)`
      : "sin comparación (menos de 120 pares)";
    l.push(fila(`${v.nombre} (redactor ${v.redactor}${v.anclaje ? `, anclaje ${v.anclaje}` : ""})${v.errores ? ` · ${v.errores} errores` : ""}`, v.resumen, contra));
  }
  return l.join("\n") + "\n";
}
