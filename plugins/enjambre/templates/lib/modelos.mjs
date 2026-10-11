// LA REGLA DE ORO, EN CÓDIGO: el que juzga nunca es de la familia del que redacta o arregla.
//
// Pieza genérica, copiada y adaptada de `llamarModelo.ts` (`familiaDe`, `verificarTablaDeModelos`)
// del proyecto de origen. El `model` del frontmatter de un agente de plugin es un valor por defecto, no
// un candado: por eso el ciclo pasa el modelo EXPLÍCITO en cada llamada y, antes de llamar,
// verifica acá que ningún rol que juzga comparta familia con ningún redactor en uso.

export const ROLES_QUE_JUZGAN_POR_DEFECTO = ["juez", "comparador", "verificador", "auditor"];

/** La familia de un modelo: "claude-haiku-5-5" → "haiku"; "sonnet" → "sonnet"; otra cosa → tal cual. */
export function familiaDe(modelo) {
  const m = /^claude-([a-z]+)-/.exec(String(modelo ?? ""));
  if (m) return m[1];
  const alias = /^(haiku|sonnet|opus|fable)$/i.exec(String(modelo ?? "").trim());
  return alias ? alias[1].toLowerCase() : String(modelo ?? "");
}

export class ReglaDeOroViolada extends Error {
  constructor(msg) {
    super(msg);
    this.name = "ReglaDeOroViolada";
  }
}

/**
 * Lanza ante la primera violación: un rol que juzga de la familia de algún redactor, o un rol sin
 * modelo. `tabla`: rol → modelo (por ejemplo `config.modelos`). `redactores`: los modelos que
 * escribieron o arreglaron lo que se juzga (el builder, el redactor del proyecto, el de una variante).
 * `soloRol`: verifica sólo ese rol (una llamada concreta).
 */
export function verificarTablaDeModelos(tabla, redactores, o = {}) {
  const lista = typeof redactores === "string" ? [redactores] : [...(redactores ?? [])];
  const juzgan = o.rolesQueJuzgan ?? ROLES_QUE_JUZGAN_POR_DEFECTO;
  for (const rol of Object.keys(tabla)) {
    const modelo = tabla[rol];
    if (!modelo) throw new ReglaDeOroViolada(`el rol "${rol}" no tiene modelo declarado`);
    if (!juzgan.includes(rol) || (o.soloRol && rol !== o.soloRol)) continue;
    if (modelo === "inherit") throw new ReglaDeOroViolada(`el rol "${rol}" juzga y no puede heredar el modelo de la sesión: tiene que ser explícito`);
    const choca = lista.find((r) => familiaDe(modelo) === familiaDe(r));
    if (choca) throw new ReglaDeOroViolada(`REGLA DE ORO: el rol "${rol}" juzga y no puede usar ${modelo}, de la misma familia que el redactor (${choca}).`);
  }
}

/** La tabla de modelos para una llamada, con los roles que juzgan verificados contra los redactores. */
export function modelosPara(tabla, redactores, o = {}) {
  verificarTablaDeModelos(tabla, redactores, o);
  return Object.freeze({ ...tabla });
}
