---
name: metodo
description: Explica el método del enjambre y sus reglas - la IA propone y el código decide, oráculos deterministas, verificador independiente, el que arregla nunca juzga, jueces a ciegas en orden doble, piso y techo, reserva oculta, set dorado, criterios de terminado y protecciones por hook. Usar cuando alguien pregunta qué es un oráculo, por qué un hallazgo no cuenta, cómo se mide, cuándo termina, o cómo se configuran los jueces o la seguridad.
user-invocable: true
---
# /enjambre:metodo

El enjambre es una forma de probar e iterar un sistema con muchos agentes sin engañarse. Siete
principios, cada uno con su mecanismo (no con una instrucción):

1. **La IA propone, el código decide.** Un hallazgo cuenta sólo si tiene una reproducción mínima
   y lo confirma un ORÁCULO determinista. El juez de IA es sólo para lo que no tiene oráculo, con
   rúbrica, a ciegas, en doble orden y midiendo su inconsistencia. → `oraculos.md`, `jueces.md`.
2. **Los falsos positivos son el riesgo principal.** Un verificador independiente, en contexto
   limpio, reproduce cada hallazgo antes de aceptarlo (`enjambre:verificador`).
3. **El que arregla nunca juzga.** El builder escribe; verificador, juez y auditor son de sólo
   lectura (sin Write ni Edit en su `tools`). Verificación por inversión: se quita el arreglo y la
   prueba tiene que dar ROJO.
4. **Las protecciones son hooks y código.** Nunca producción (hosts permitidos), tope de gasto con
   libro, set reservado ilegible, mapa obligatorio antes de leer código, escrituras peligrosas
   cortadas. Los hooks no hacen nada sin `.enjambre/`; los `deny` los escribe `init` en el
   proyecto. → `protecciones.md`.
5. **Medición en los dos lados.** Piso y techo fijos para cada detector, una reserva oculta (el
   set reservado, 30%, corte determinista) y un set dorado de regresiones. Terminó cuando la
   cobertura de funciones × roles × estados con oráculo llegó al objetivo y hubo meseta de
   hallazgos nuevos. **Nunca se declara "sin bugs".** → `terminado.md`.
6. **El juez nunca es el modelo que redacta o arregla.** El ciclo pasa el modelo EXPLÍCITO en cada
   llamada; el frontmatter no es un candado. En código: `familiaDe(juez) !== familiaDe(builder)`.
7. **Seguridad: sólo diseño defensivo del sistema propio.** Pruebas de autorización entre roles y
   tenants de prueba con canarios, y de aislamiento de datos (RLS o equivalente), siempre en local
   o staging y con la autorización escrita del dueño en `.enjambre/config.json` →
   `seguridad.autorizacionDelDuenio` (firmante y fecha). Sin ella: el generador tiene la
   instrucción de no generar esos escenarios (`autorizacion`, `aislamiento`, `rls`) y de listarlos
   como parada, y el CÓDIGO los rechaza aunque el modelo los escriba (la guardia de escrituras
   niega el `Write` de un escenario con esas categorías; `lib/escenarios.mjs` los filtra antes de
   correr). Verificado sin modelo; en una sesión real, lote 6. → `seguridad.md`.

## Vocabulario

- **Oráculo**: una regla que decide, por código, si un resultado está bien. Invariante,
  diferencial (dos roles, dos capas, dos versiones), metamórfico, propiedad, contrato.
- **Hallazgo candidato / confirmado / refutado**: lo que un explorador vio; lo que el verificador
  reprodujo con el oráculo; lo que el verificador no pudo reproducir o cuyo oráculo estaba mal.
- **Causa**: a qué parte del sistema se le atribuye una falla, por una tabla fija
  (`causaPorFalla`), nunca por un modelo. El Pareto ordena causas.
- **Inversión**: quitar el arreglo y ver la prueba en rojo. Si da verde, la prueba no prueba.
- **Piso y techo**: cuánto tiene que atrapar un detector como mínimo y cuánto puede tocar como
  máximo de lo que no debe. Los dos lados se miden desde la primera ronda, o el péndulo se va para
  el lado que se mide.
- **Set reservado**: el 30% de los casos, cortado por hash determinista antes de usar nada;
  ilegible por guardia hasta la corrida final.
- **Set dorado**: los casos que una vez fallaron y se arreglaron; corren PRIMERO en cada ciclo y
  nunca se sacan. Un fallo es una REGRESIÓN: esa medición no cuenta como mejora ni como éxito.
- **Re-corrida parcial**: medir en minutos sólo los casos de un arreglo; nunca decide.
- **Variante**: otra configuración medida contra el MISMO control; nunca decide sola.
- **Pareto por causa fina**: las fallas por firma (`regla:R8`, `capa1:x`, `juez:…`), decididas
  por el código, con ids y sin texto; y qué mirar, de una tabla.
- **Meseta**: dos ciclos seguidos sin hallazgos nuevos confirmados.

## Cómo se configuran los jueces para un negocio

Un archivo `lib/negocios/<negocio>.mjs` con la forma `ConfigJueces` (`lib/nucleoJueces.mjs`):
asistente, dueño, preguntas con rúbrica (PASA / FALLA / NO APLICA), ejemplos de casos reales
(nunca datos personales), criterios del comparador, descripciones de los esquemas, frases de
promesa para el detector del código, reglas contables. `problemasDeConfigJueces` lo valida antes
de armar nada. El ejemplo `lib/negocios/ejemplo.mjs` es FICTICIO: se copia y se reemplaza. Una vez
aprobados por el dueño, las huellas de los prompts se fijan en una prueba: moverlos sin querer
invalida la comparación entre ciclos. → `jueces.md`.
