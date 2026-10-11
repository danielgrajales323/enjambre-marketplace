// UTILIDADES DEL ENJAMBRE. Código puro o de disco local: nada de red, nada de modelo.
//
// Pieza genérica, copiada y adaptada de `util.ts` y `llamarModelo.ts` de
// el proyecto de origen (azar con semilla, huella, mezcla determinista, paralelismo que corta al
// primer error). Sólo módulos integrados de Node.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

/** ¿Este módulo es el script que se está corriendo? (para que importarlo no lo ejecute) */
export function esPrincipal(urlDelModulo) {
  const script = process.argv[1];
  if (!script) return false;
  const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(script) === norm(fileURLToPath(urlDelModulo));
}

/** Un entero de 31 bits a partir de un texto: la semilla del azar de un caso o de un ciclo. */
export function semillaDeTexto(texto) {
  return createHash("sha256").update(texto).digest().readUInt32BE(0) & 0x7fffffff;
}

/** Azar con semilla (mulberry32): mismo número, misma secuencia. Nunca `Math.random()` en el enjambre. */
export function azarConSemilla(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mezcla determinista (Fisher-Yates con un azar sembrado). No toca el arreglo original. */
export function mezclar(xs, azar) {
  const r = [...xs];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Huella corta (12 hex) de varias partes: la registra cada ciclo para saber si un prompt cambió. */
export function huellaDe(...partes) {
  const h = createHash("sha256");
  for (const p of partes) h.update(String(p)).update("\u0001");
  return h.digest("hex").slice(0, 12);
}

/** sha256 completo de un texto. */
export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** JSON comprimido (.json.gz): un grep de todo el repo no muestra lo que hay adentro. */
export function escribirGz(ruta, dato, o = {}) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, gzipSync(Buffer.from(JSON.stringify(dato), "utf8")), { flag: o.pisar ? "w" : "wx" });
}

export function leerGz(ruta) {
  return JSON.parse(gunzipSync(readFileSync(ruta)).toString("utf8"));
}

export function leerJsonSiExiste(ruta, porDefecto) {
  return existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : porDefecto;
}

/**
 * Corre `fn` sobre cada elemento con `n` en vuelo a la vez y devuelve los resultados EN ORDEN.
 * Al primer error deja de tomar elementos nuevos, espera a los que están en vuelo y relanza ese
 * error: un tope de gasto alcanzado corta todo, no se traga como un caso más.
 */
export async function enParalelo(xs, n, fn) {
  const res = new Array(xs.length);
  let cursor = 0;
  let error = null;
  const trabajador = async () => {
    while (error === null && cursor < xs.length) {
      const i = cursor++;
      try {
        res[i] = await fn(xs[i], i);
      } catch (e) {
        if (error === null) error = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, xs.length)) }, trabajador));
  if (error !== null) throw error;
  return res;
}

/**
 * El nombre de un error SIN su mensaje. Lo usa la corrida final: el mensaje de un error puede
 * traer un pedazo de la salida del modelo (un caso reservado), y eso no se imprime.
 */
export function errorSinTexto(err) {
  const nombre = (err && err.name) || "Error";
  return `${nombre} (detalle omitido: puede traer texto del set reservado)`;
}

export const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);
