---
name: ciclo
description: Corre UN ciclo del enjambre sobre el proyecto actual - mapear, generar escenarios, explorar, verificar en contexto limpio, triage, Pareto, arreglar con el builder y auditar - con el modelo explícito en cada rol y las paradas del dueño. Usar cuando el proyecto ya tiene .enjambre/ y el dueño pidió iterar.
argument-hint: "[--ciclo N] [--semilla S] [--solo-estimar]"
allowed-tools: Agent Read Grep Glob Bash(node .enjambre/*) Bash(graphify *) Bash(git status*) Bash(git log --oneline*) Bash(git ls-remote*) Bash(git rev-parse*)
---
# /enjambre:ciclo

Un ciclo completo. Lo dirige el agente `enjambre:supervisor` (o esta sesión, si el usuario lo
pide); nadie más que `enjambre:builder` edita código. El paso a paso con los prompts de cada
etapa está en `flujo.md`; los criterios de terminado, en `/enjambre:metodo`.

## Antes de gastar

1. Leé `.enjambre/config.json`. Si falta, pará: `/enjambre:init` primero.
2. Leé el libro (`gasto.libro` y su canónico). Si el acumulado pasó `gasto.avisoUsd`, pará y
   escribí la parada: el dueño decide si sigue; la bandera `--sigue-despues-del-aviso` la pone el
   supervisor sólo con esa respuesta por escrito.
3. Con `--solo-estimar`, calculá cuántas llamadas y cuánto costaría (llamadas por rol × perfil) y
   terminá ahí.
4. Elegí los modelos de `config.modelos` y verificá en código la regla de oro: ningún rol que
   juzga (juez, comparador, verificador, auditor) es de la familia del builder ni del redactor.
   Pasá `model` EXPLÍCITO en cada `Agent`: el frontmatter no es un candado.

## Las etapas (una por `Agent`, con `model` explícito)

| # | Etapa | Agente | Escribe | Entrada → salida |
|---|---|---|---|---|
| 0 | Set dorado PRIMERO | código (`lib/setDorado.mjs`) | no | los casos que ya fallaron y se arreglaron → regresiones (arriba del todo; la medición no cuenta como mejora) |
| 1 | Mapear | `enjambre:cartografo` | no | repo → mapa de funciones × roles × estados, invariantes, oráculos, cobertura |
| 2 | Escenarios | `enjambre:generador-escenarios` | `.enjambre/trabajo/escenarios/` | mapa + semilla → escenarios con oráculo determinista; lo sin oráculo, aparte |
| 3 | Explorar | `enjambre:explorador` (N en paralelo, uno por tanda) | `.enjambre/trabajo/hallazgos/` | escenarios → hallazgos CANDIDATOS con reproducción mínima |
| 4 | Verificar | `enjambre:verificador` (contexto limpio, uno por hallazgo) | no | reproducción + oráculo → confirmado / refutado / no reproducible |
| 5 | Juzgar (sólo lo sin oráculo) | `enjambre:juez` con la rúbrica de `lib/nucleoJueces.mjs` | no | texto → JSON del esquema; el código decide (`reglasIncumplidas`, `citaVerificable`); comparaciones en orden doble (`lib/comparador.mjs`) |
| 6 | Triage | `enjambre:triage` | no | confirmados → falla y causa por tabla; duplicados |
| 7 | Pareto | código (`lib/reporte.mjs` grueso + `lib/pareto.mjs` fino) | `.enjambre/trabajo/causas-<ciclo>.md` | veredictos → causas ordenadas (las que cubren el 80% o tres) y el Pareto por firma con ids y qué mirar |
| 8 | Arreglar | `enjambre:builder` (UNO por lote) | código del proyecto | causas → arreglos con prueba invertida; `graphify update .` |
| 9 | Auditar | `enjambre:auditor` | no | diff → PASA / FALLA, con una inversión por muestreo |
| 10 | Cerrar | código + `/enjambre:reporte` | `.enjambre/trabajo/ciclos.json`, reporte | números del ciclo, parada o meseta, costo |

## Reglas del ciclo

- **Un hallazgo cuenta sólo confirmado** (etapa 4). Lo refutado o no reproducible se lista aparte
  y no entra al Pareto. Los falsos positivos son el riesgo principal: por eso el verificador no
  lee el razonamiento del explorador antes de reproducir.
- **Los prompts de los jueces no cambian durante el ciclo.** Si cambian entre ciclos, se registra la
  huella (`huellaJueces`) y el ciclo anterior se vuelve a juzgar antes de comparar.
- **El set reservado no se toca** hasta la corrida final (`/enjambre:metodo`, "Reserva oculta").
- **Se para** si dos ciclos seguidos no mejoran (`evaluarParada`), si el aviso de gasto se cruzó, si
  el auditor dio FALLA dos veces sobre el mismo lote, o ante cualquier parada del dueño.
- **Cada ciclo deja**: la línea del reporte, el documento de causas, el índice `ciclos.json` (sólo
  números) y los commits con rutas explícitas, pusheados y confirmados con `git ls-remote`.
- **Después de un arreglo, una re-corrida PARCIAL** (`lib/redirigida.mjs`: `--solo-causas` o
  `--solo-casos`, sólo ids del set de trabajo) mide en minutos si el arreglo movió esos casos. Es
  parcial y nunca decide: va a `indice.parciales`, nunca entre los ciclos (`verificarIndice`).
- **Variantes** (`lib/variantes.mjs`, `--variantes=<archivo>`): hasta 3 configuraciones contra el
  MISMO control, validadas antes de gastar (regla de oro, perfil de costo); van a
  `indice.variantes` y no tocan la ganadora ni la parada.
