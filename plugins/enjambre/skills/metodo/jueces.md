# Jueces: para lo que no tiene oráculo, sin engañarse

Cinco reglas, cada una con su mecanismo en `lib/`:

1. **El juez contesta pregunta por pregunta, con la razón primero, y el código decide.** Cada
   pregunta lleva su rúbrica (PASA / FALLA / NO APLICA) en la DESCRIPCIÓN del campo, porque la
   descripción manda sobre el modelo (el `enum` no es vinculante). El código traduce cada "falla"
   en la regla incumplida (`reglasIncumplidas`): una lista escrita por el modelo no sirve, lo que
   no nombra cuenta en silencio como cumplido. Las marcas graves van con cita textual, y el código
   verifica la cita (`citaVerificable`): sin cita en el texto, la marca queda "a revisar".
2. **Toda comparación A contra B se juzga en los dos órdenes** (`lib/comparador.mjs`). Si los dos
   veredictos coinciden, vale; si difieren, el par es inconsistente y cuenta como empate. La tasa
   de inconsistencia se reporta por juez. El orden de la primera pasada sale de una semilla por
   caso, así se repite idéntica. A ciegas: el juez nunca lee "nueva", "anterior" ni el id.
3. **La salida se verifica contra el esquema en todos los niveles** (`lib/esquema.mjs`): campos
   anidados requeridos, campos de más, enum, tipos. Un campo que falta nunca se lee como "no". Un
   esquema que no es estricto no se manda.
4. **Un juez que se niega o se corta es una falla del juez, no de lo juzgado**: `refusal`,
   `max_tokens`, no JSON, fuera del esquema → se reintenta una vez y después queda aparte, con su
   motivo. No entra a las causas del que arregla.
5. **El prompt se arma con un núcleo sin nombres y una configuración por negocio**
   (`lib/nucleoJueces.mjs` + `lib/negocios/<negocio>.mjs`). La configuración se valida antes de
   armar. Las huellas de los prompts aprobados se fijan en una prueba: cambiar un prompt es un
   cambio ENTRE ciclos, y el ciclo anterior se vuelve a juzgar antes de comparar.

Y la regla de oro, en código y en cada llamada: **el juez nunca es el modelo que redactó o arregló
lo que juzga.** El ciclo pasa `model` explícito; `familiaDe(juez) !== familiaDe(redactor)` y
`!== familiaDe(builder)`. Si choca, no se llama.

## Cómo se arma la configuración para un negocio nuevo (en orden)

1. Con la guía de voz del negocio aprobada por su dueño, copiar `lib/negocios/ejemplo.mjs` a
   `lib/negocios/<negocio>.mjs` y vaciarlo. Queda la forma, nada más.
2. `asistente` y `dueno`: una frase cada uno, con artículo, tal como se leen dentro de "Eres un
   juez de calidad de …" y "(aprobada por …)".
3. `preguntas`: una por cada pregunta de la lista de SU guía, con la regla que cuenta y una clave
   estable (`p1_…`).
4. `rubricas`: para cada clave, cuándo PASA, cuándo FALLA y cuándo NO APLICA, con las excepciones
   que su dueño aprobó. Sin PASA y FALLA no se acepta.
5. `ejemplos`: casos reales del negocio SIN datos personales, una línea por caso: lo que dijo el
   cliente, la respuesta, PASA o FALLA con el porqué. Sin casos todavía, la lista queda vacía.
6. `criteriosDelComparador`: lo que un cliente preferiría recibir, en orden; lo grave primero.
7. `esquemas`: la clave de la pregunta de criterio (`claveVoz`, un identificador que no repita
   una clave de pregunta ni un campo fijo) y las doce descripciones, enteras, con los nombres del
   negocio.
8. `frasesDePromesa` (minúsculas, sin tildes, en los idiomas que atiende) y `reglasContables`.
9. `armarPromptsJueces(config)` y `armarEsquemasJueces(config)` revientan con un mensaje que nombra
   el problema si algo falta. Antes de gastar nada.
10. Fijar las huellas (sha256) de los prompts y esquemas armados en la suite del proyecto apenas
    el dueño los apruebe.

Límite declarado del núcleo: el texto está en español con "clienta" y "asistente" en femenino.
Otro tratamiento o idioma necesita una variante del núcleo, no sólo una configuración.
