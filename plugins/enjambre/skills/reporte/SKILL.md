---
name: reporte
description: Muestra el estado del enjambre en este proyecto - el reporte por ciclo, el Pareto de causas vigente, el gasto acumulado contra los topes, la parada o la meseta, y qué piezas de .enjambre/ difieren de las plantillas del plugin (manifiesto de hashes). Usar al cerrar un ciclo o cuando el dueño pregunta cómo va.
argument-hint: "[--ciclo N]"
allowed-tools: Read Glob Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --dry-run*) Bash(git log*) Bash(git status*)
---
# /enjambre:reporte

Sólo lectura. Nada de esto gasta ni escribe.

## Qué mostrar, en este orden

1. **El reporte por ciclo**: `.enjambre/trabajo/reporte.md` (lo genera `agregarAlReporte`,
   `lib/reporte.mjs`). Una línea por ciclo: % aprobados, graves, hallazgos nuevos confirmados,
   ¿gana a la anterior? (con la tasa de inconsistencia del comparador en orden doble), causa
   principal, Pareto, costo acumulado, huella de los jueces.
2. **Regresiones y Pareto**: `.enjambre/trabajo/causas-<último>.md`. Si arriba hay una REGRESIÓN
   del set dorado, decila primero: esa medición no contó como mejora. Después qué causas se atacan,
   cuántos hallazgos cubren, y el Pareto por causa fina (firmas, ids, qué mirar).
   Las re-corridas parciales (`indice.parciales`, `parcial-<k>.md`) y las variantes
   (`indice.variantes`, `variantes-<n>.md`) se muestran aparte y marcadas "no decide".
3. **El gasto**: `.enjambre/gastos.json` (espejo) contra `gasto.topeUsd`, `avisoUsd` y
   `reservaFinalUsd` de `.enjambre/config.json`. Si el acumulado pasó el aviso, decilo primero y en
   negrita: nada más arranca sin la decisión del dueño. Si hay una corrida `en_curso`, cuenta su
   tope entero (o murió sin cerrar).
4. **Parada y meseta**: `.enjambre/trabajo/ciclos.json` → `evaluarParada` (dos ciclos sin
   mejora) y `evaluarMeseta` (dos ciclos sin hallazgos nuevos confirmados). Con la cobertura del
   mapa (`.enjambre/trabajo/mapa-<último>.md`: celdas con oráculo / total), eso es lo que dice si
   el enjambre terminó. **Nunca se declara "sin bugs"**: se declara "cobertura X% con oráculo y
   meseta de N ciclos".
5. **Qué difiere de las plantillas**: comparar `.enjambre/manifest.json` con los hashes actuales
   de `.enjambre/lib/*.mjs` y con `${CLAUDE_PLUGIN_ROOT}/templates/`. Lo adaptado por el proyecto
   se lista como "propio"; lo que cambió en el plugin desde que se copió, como "hay versión nueva"
   (se trae con `/enjambre:init --force` SOBRE ESE archivo, con `.bak`). Para ver el plan sin
   escribir: `node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --dry-run`.
6. **Paradas abiertas** del último ciclo (lo que espera al dueño), con la pregunta exacta, las
   opciones y la recomendación.

Formato: corto, números primero, cada afirmación con VERIFICADO (lo leíste del archivo) u
OBSERVADO/INFERIDO. Si falta un archivo, decí cuál y qué paso del ciclo lo crea.
