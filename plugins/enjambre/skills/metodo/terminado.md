# Cuándo terminó: medición en los dos lados

El enjambre no declara "sin bugs". Declara números, sobre dos sets:

## El set de trabajo (con el que se itera)

- **Cobertura con oráculo**: celdas del mapa (función × rol × estado) que tienen un oráculo
  determinista y un escenario que lo ejercita, sobre el total. El objetivo lo fija el dueño en el
  primer ciclo (por ejemplo, 100% de las celdas de dinero y autorización, 80% del resto).
- **Meseta**: dos ciclos seguidos sin hallazgos nuevos CONFIRMADOS (`evaluarMeseta`).
- **Parada**: dos ciclos seguidos sin ganarle a la versión anterior (`evaluarParada`) → se reporta,
  no se sigue solo.
- **Piso y techo** de cada detector, con las dos baterías fijas en la suite
  (`verificarPisoYTecho`).
- **Set dorado** (`lib/setDorado.mjs`, `set-dorado.json`): cada hallazgo confirmado y arreglado
  entra con su reproducción; corre PRIMERO en cada ciclo, completo o parcial; nunca se saca. Un
  fallo es una REGRESIÓN, arriba del todo en el documento de causas, y esa medición NO cuenta
  como mejora aunque gane la comparación (`decidirMejora`); la parada la cuenta como "no mejoró"
  (`evaluarParada`) y la final no declara éxito (`evaluarFinal`).
- **Re-corrida parcial** (`lib/redirigida.mjs`): después de un arreglo, sólo los casos de ciertas
  firmas, causas o categorías del set de trabajo, comparados caso por caso (arreglados, siguen,
  nuevos fallos). Es PARCIAL y nunca decide: vive aparte de los ciclos (`verificarIndice`).
- **Variantes** (`lib/variantes.mjs`): N configuraciones contra el MISMO control, a ciegas y en
  orden doble; ninguna decide sola.

## El set reservado (una sola vez, al final)

- El 30% de los casos, cortado por hash determinista antes de usar nada
  (`lib/corteReservado.mjs`), guardado COMPRIMIDO (`escribirReservado` → `.json.gz`, para que
  ningún grep ni `git log -p` muestre texto) y con la guardia del plugin que dificulta leerlo
  durante toda la iteración (dificulta, no impide: la regla es que ningún builder lo abre).
- La corrida final lo lee por dentro (el script de `reservado.lectoresAutorizados`) y devuelve
  SÓLO números. Nadie ve los casos.
- **Sobreajuste**: si el reservado da más de 10 puntos peor que el de trabajo, se reporta al dueño y
  se para.

## El reporte final para el dueño

- Cobertura con oráculo y meseta alcanzadas o no.
- El resultado sobre el set reservado.
- Los hallazgos confirmados por ciclo y su Pareto.
- Los desacuerdos entre jueces y la tasa de inconsistencia de cada comparador.
- Qué cambió en cada ciclo y por qué (commits).
- El costo total (libro) contra el tope.
- Las paradas que siguen abiertas.
