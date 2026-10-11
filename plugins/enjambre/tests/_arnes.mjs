// El arnés mínimo de las pruebas del kit: `check(nombre, obtenido, esperado)` con igualdad por JSON.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ_PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function crearChequeo() {
  const c = { passed: 0, failed: 0 };
  const check = (nombre, obtenido, esperado) => {
    const a = JSON.stringify(obtenido);
    const b = JSON.stringify(esperado);
    if (a === b) c.passed++;
    else {
      c.failed++;
      console.log(`  ✗ ${nombre}\n      esperado: ${b}\n      obtenido: ${a}`);
    }
  };
  const cerrar = () => {
    console.log(`\n${c.passed} pruebas OK, ${c.failed} fallidas`);
    if (c.failed) process.exitCode = 1;
  };
  return { check, cerrar, c };
}

export const configDePlantilla = () => JSON.parse(readFileSync(join(RAIZ_PLUGIN, "templates", "config.json"), "utf8"));

/** Un proyecto temporal con `.enjambre/config.json` (o sin él, o roto). */
export function proyectoTemporal(o = {}) {
  const dir = mkdtempSync(join(tmpdir(), "enjambre-prueba-"));
  if (o.config !== null) {
    mkdirSync(join(dir, ".enjambre"), { recursive: true });
    const contenido = typeof o.config === "string" ? o.config : JSON.stringify(o.config ?? configDePlantilla(), null, 2);
    writeFileSync(join(dir, ".enjambre", "config.json"), contenido);
  }
  return dir;
}

/** Corre una guardia como lo haría Claude Code: JSON por stdin, variables de entorno, código de salida. */
export function correrGuardia(nombreScript, evento, o = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: o.proyecto ?? "" };
  if (!o.proyecto) delete env.CLAUDE_PROJECT_DIR;
  const args = [join(RAIZ_PLUGIN, "scripts", nombreScript), ...(o.args ?? [])];
  try {
    const stdout = execFileSync(process.execPath, args, { input: JSON.stringify(evento), env, cwd: o.cwd ?? o.proyecto ?? tmpdir(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { codigo: 0, stdout, decision: decisionDe(stdout) };
  } catch (err) {
    return { codigo: err.status ?? -1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? ""), decision: decisionDe(String(err.stdout ?? "")) };
  }
}

function decisionDe(stdout) {
  if (!stdout.trim()) return null;
  try {
    return JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? "salida-rara";
  } catch {
    return "salida-rara";
  }
}
