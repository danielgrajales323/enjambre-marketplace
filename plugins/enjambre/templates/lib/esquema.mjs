// EL ESQUEMA DE SALIDA, VERIFICADO EN CÓDIGO. Código puro: nada de red, nada de modelo.
//
// Pieza genérica, copiada de `esquema.ts` del proyecto de origen (regla J3 del
// núcleo conversacional). Con salidas estrictas la API promete que lo devuelto cumple el
// esquema, pero el código no se apoya en esa promesa: una salida cortada, un campo anidado
// que falta o un valor fuera del `enum` se detectan acá, y el rol no sigue con una salida a
// medias. Un campo que falta NUNCA se lee como "no".
//
// Los mensajes de error nombran RUTAS y TIPOS, nunca valores: una salida puede traer texto
// del set reservado.

const tipoDe = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

function cumpleTipo(v, tipo) {
  const t = tipoDe(v);
  if (tipo === "number") return t === "number" || t === "integer";
  return t === tipo;
}

/**
 * Lo que la salida NO cumple del esquema: tipos, `required` (en todos los niveles),
 * `additionalProperties: false`, `enum` y los elementos de cada arreglo. [] = cumple.
 */
export function erroresContraSchema(valor, schema, ruta = "$") {
  const errores = [];
  const tipo = typeof schema.type === "string" ? schema.type : null;
  if (tipo && !cumpleTipo(valor, tipo)) return [`${ruta}: se esperaba ${tipo} y llegó ${tipoDe(valor)}`];
  if (Array.isArray(schema.enum) && !schema.enum.includes(valor)) errores.push(`${ruta}: valor fuera del enum`);
  if (tipo === "object" && valor && typeof valor === "object" && !Array.isArray(valor)) {
    const props = schema.properties ?? {};
    for (const k of Array.isArray(schema.required) ? schema.required.map(String) : []) {
      if (!(k in valor)) errores.push(`${ruta}.${k}: falta (requerido)`);
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(valor)) if (!(k in props)) errores.push(`${ruta}.${k}: campo que el esquema no tiene`);
    }
    for (const [k, sub] of Object.entries(props)) if (k in valor) errores.push(...erroresContraSchema(valor[k], sub, `${ruta}.${k}`));
  }
  if (tipo === "array" && Array.isArray(valor) && schema.items && typeof schema.items === "object") {
    valor.forEach((x, i) => errores.push(...erroresContraSchema(x, schema.items, `${ruta}[${i}]`)));
  }
  return errores;
}

/**
 * ¿El esquema es ESTRICTO? Cada objeto, en todos los niveles: `additionalProperties: false` y
 * `required` con TODAS sus propiedades (lo que no es requerido el modelo lo puede omitir, y el
 * código lo leería como "no"). Devuelve las rutas que no cumplen.
 */
export function problemasDeSchemaEstricto(schema, ruta = "$") {
  const p = [];
  if (schema.type === "object") {
    const props = schema.properties ?? {};
    if (schema.additionalProperties !== false) p.push(`${ruta}: falta additionalProperties: false`);
    const req = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    for (const k of Object.keys(props)) if (!req.has(k)) p.push(`${ruta}.${k}: no está en required`);
    for (const [k, sub] of Object.entries(props)) p.push(...problemasDeSchemaEstricto(sub, `${ruta}.${k}`));
  }
  if (schema.type === "array" && schema.items && typeof schema.items === "object") p.push(...problemasDeSchemaEstricto(schema.items, `${ruta}[]`));
  return p;
}

/** El orden de las propiedades de un objeto del esquema (el modelo las escribe en este orden). */
export function ordenDePropiedades(schema) {
  return Object.keys(schema.properties ?? {});
}

/** Un esquema que no es estricto es un error del código: se corta ANTES de llamar al modelo. */
export class SchemaNoEstricto extends Error {
  constructor(msg) {
    super(msg);
    this.name = "SchemaNoEstricto";
  }
}

/**
 * Por qué una salida no sirve. Es una causa de falla PROPIA del rol (del juez, del comparador),
 * no de lo juzgado: el reporte la cuenta aparte (regla J4).
 *   refusal · max_tokens · no_json · esquema
 */
export const MOTIVOS_SALIDA_INVALIDA = ["refusal", "max_tokens", "no_json", "esquema"];

export class SalidaInvalida extends Error {
  constructor(msg, motivo = "esquema") {
    super(msg);
    this.name = "SalidaInvalida";
    this.motivo = motivo;
  }
}

/**
 * Valida una respuesta cruda del modelo contra su esquema y devuelve el objeto, o lanza
 * `SalidaInvalida` con su motivo. `stopReason` es el de la API (`refusal`, `max_tokens`...).
 * Rutas y tipos en el mensaje, nunca valores.
 */
export function salidaSegunSchema(rol, texto, stopReason, schema) {
  const flojo = problemasDeSchemaEstricto(schema);
  if (flojo.length) throw new SchemaNoEstricto(`${rol}: el esquema de salida no es estricto (${flojo.slice(0, 5).join("; ")})`);
  if (stopReason === "refusal") throw new SalidaInvalida(`${rol}: el modelo se negó (stop_reason refusal)`, "refusal");
  if (stopReason === "max_tokens") throw new SalidaInvalida(`${rol}: la salida se cortó por max_tokens`, "max_tokens");
  let obj;
  try {
    obj = JSON.parse(texto);
  } catch {
    throw new SalidaInvalida(`${rol}: la salida no es JSON (${String(texto ?? "").length} caracteres)`, "no_json");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new SalidaInvalida(`${rol}: la salida no es un objeto`, "esquema");
  const incumple = erroresContraSchema(obj, schema);
  if (incumple.length) throw new SalidaInvalida(`${rol}: la salida no cumple el esquema: ${incumple.slice(0, 8).join("; ")}`, "esquema");
  return obj;
}
