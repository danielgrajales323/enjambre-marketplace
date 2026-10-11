# /enjambre:ciclo — el flujo con los prompts de cada etapa

Cada llamada a `Agent` lleva `subagent_type: "enjambre:<rol>"` y `model: <config.modelos[rol]>`
EXPLÍCITO. Lo que sigue son los prompts mínimos; el supervisor los completa con los nombres de
archivos reales.

## 1. Mapear

```
Agent(enjambre:cartografo, model: modelos.cartografo)
"Ciclo <n>. Mapeá el sistema según tu definición. Hosts permitidos: <red.hostsPermitidos>.
Carpetas de código: <mapa.rutasDeCodigo>. Devolvé el mapa de cobertura con la tabla
función × (rol, estado) y si tiene oráculo."
```
El supervisor guarda el resultado en `.enjambre/trabajo/mapa-<n>.md`.

## 2. Escenarios

```
Agent(enjambre:generador-escenarios, model: modelos.generador)
"Ciclo <n>, semilla <s>. Mapa: .enjambre/trabajo/mapa-<n>.md. seguridad.autorizacionDelDuenio:
<el valor tal cual de config.json: null o el objeto>. Generá escenarios para las celdas SIN
oráculo primero, después las de riesgo, cada uno con su categoría. Sin autorización válida, nada
de autorizacion/aislamiento/rls: listalos como paradas. Escribí en .enjambre/trabajo/escenarios/.
Devolvé ids, celdas sin escenario y paradas de seguridad."
```
La red determinista: la guardia de escrituras rechaza un `Write` de un escenario con esas
categorías sin autorización (`problemasDeEscenario`), y el orquestador del proyecto filtra con
`filtrarEscenarios` (`lib/escenarios.mjs`) antes de correr.

## 3. Explorar (en paralelo, por tandas de ~10 escenarios)

```
Agent(enjambre:explorador, model: modelos.explorador)
"Ciclo <n>. Corré los escenarios <ids> contra <host local/staging>. Cada hallazgo con su
reproducción mínima en .enjambre/trabajo/hallazgos/. No arregles nada."
```
Lanzá varios en paralelo (uno por tanda). Nunca más exploradores que escenarios.

## 4. Verificar (contexto limpio, uno por hallazgo)

```
Agent(enjambre:verificador, model: modelos.verificador)
"Reproducí el hallazgo <archivo .json>: leé SÓLO `reproduccion` y `oraculo`, corré en limpio,
evaluá el oráculo con código, intentá refutarlo una vez. Veredicto: confirmado / refutado /
no reproducible, con la salida textual."
```
El supervisor anota el veredicto en el JSON del hallazgo (`veredicto`, `verificado: true/false`).

## 5. Juzgar lo sin oráculo

Sólo para `sin-oraculo.json`: el supervisor arma el pedido con `armarPromptsJueces(config)` y
`armarEsquemasJueces(config)` de `lib/nucleoJueces.mjs` y la configuración del negocio
(`lib/negocios/<negocio>.mjs`), y llama a `enjambre:juez` con `model: modelos.juez`. Para comparar
dos versiones usa `compararVersiones` (`lib/comparador.mjs`) con `llamar` apuntando al juez y
`juez.modelo` explícito: cada par dos veces, en órdenes opuestos.

La regla de oro, en código: `familiaDe(modelos.juez) !== familiaDe(modelos.builder)` y lo mismo
contra el redactor del proyecto. Si choca, el ciclo no arranca.

## 6. Triage

```
Agent(enjambre:triage, model: modelos.triage)
"Hallazgos CONFIRMADOS: <lista>. Tabla causaPorFalla vigente: <tabla>. Deduplicá y clasificá.
Devolvé el JSON."
```

## 7. Pareto (código)

```js
import { pareto, documentoDeCausas, resumirCiclo } from "./.enjambre/lib/reporte.mjs";
```
`pareto(veredictos, causaPorFalla, { soloVerificados: true })` → `documentoDeCausas(...)` en
`.enjambre/trabajo/causas-<n>.md`. Se atacan las causas que cubren el 80% o tres, lo que sea
menor (`causasHastaCubrir`).

## 8. Arreglar

```
Agent(enjambre:builder, model: modelos.builder)
"Lote del ciclo <n>: causas <lista>. Documento: .enjambre/trabajo/causas-<n>.md. Cada arreglo
con prueba invertida. Commit con rutas explícitas y push."
```
UN builder por lote. Si el lote es grande, varios lotes en serie, cada uno auditado.

## 9. Auditar

```
Agent(enjambre:auditor, model: modelos.auditor)
"Auditá el lote del ciclo <n> desde <SHA anterior>. Corré las suites, hacé una inversión por
muestreo, verificá que cada arreglo responde a un hallazgo confirmado."
```
FALLA → vuelve al builder con los hallazgos numerados. Dos FALLA seguidas sobre el mismo lote →
parada.

## 10. Cerrar

`resumirCiclo` → `agregarAlReporte`; actualizar `.enjambre/trabajo/ciclos.json` con
`{ ciclo, mejoro, hallazgosNuevos, costoCicloUsd, costoAcumuladoUsd }`; `evaluarParada` y
`evaluarMeseta`; `/enjambre:reporte`.

## Qué pasa con el gasto

Toda corrida que llama a un modelo por API (jueces, comparador, clientes simulados si el proyecto
los tiene) pasa por el libro: `abrirCorrida` antes de la primera llamada, `cerrarCorrida` al
terminar o al salir por error (registrar `process.on("exit")`). Un script que gasta se llama como
`gasto.scriptsQueGastan` dice, para que la guardia lo reconozca.
