# enjambre — plugin de Claude Code

Enjambre de prueba e iteración para cualquier proyecto: **la IA propone, el código decide.**

| Pieza | Qué hay |
|---|---|
| `skills/` | `/enjambre:init`, `/enjambre:ciclo`, `/enjambre:reporte`, `/enjambre:metodo` (cada SKILL.md corto; el detalle en archivos de apoyo) |
| `agents/` | supervisor, cartógrafo, generador de escenarios, explorador, verificador, triage, juez, builder, auditor (sólo el builder edita) |
| `hooks/hooks.json` | Las guardias: producción, reservado, escrituras, gasto, mapa. `onFailure: "block"`. No hacen nada sin `.enjambre/` |
| `scripts/` | `init.mjs` (copia `templates/` sin pisar, manifiesto, fusión de `deny`) y `guard-*.mjs` (sólo built-ins de Node) |
| `templates/` | Lo que `init` deja en `.enjambre/`: `config.json`, `gastos.json`, `set-dorado.json`, `lib/*.mjs` (libro, corte, núcleo de jueces, esquema, comparador en orden doble, reporte, Pareto por causa fina, set dorado, re-corrida parcial, variantes, regla de oro de modelos) y una configuración de jueces FICTICIA |
| `workflows/` | `ciclo-exploracion.js`: mapear → escenarios → explorar → verificar → triage, reproducible (sin azar ni hora) |
| `evals/` | Dos casos para `claude plugin eval` |
| `tests/` | `node tests/run-all.mjs`: guardias, init, plantillas y proceso (P1–P4), sin red ni modelo |

Desarrollo: `claude --plugin-dir ./enjambre`, `/reload-plugins`, `claude plugin validate ./enjambre --strict`,
`node enjambre/tests/run-all.mjs`.

Instalación (Claude Code 2.1.275 o posterior; `<owner>/<repo>` es el repo del marketplace):

```
/plugin install enjambre --marketplace <owner>/<repo>
```

Seguridad: este plugin sólo hace diseño defensivo del sistema propio (autorización entre roles y
tenants de prueba con canarios, aislamiento de datos) en local o staging, con autorización escrita
del dueño en `.enjambre/config.json`. No contiene ni genera técnicas ofensivas.
