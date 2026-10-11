# enjambre — plugin de Claude Code

Un enjambre de prueba e iteración para cualquier proyecto, con una regla: **la IA propone, el
código decide.** Agentes que exploran, un verificador independiente que reproduce cada hallazgo
antes de aceptarlo, jueces a ciegas en orden doble para lo que no tiene oráculo, un libro de gasto
con tope, un set reservado ilegible y guardias que son hooks y código, no instrucciones.

## Requisitos

- **Claude Code v2.1.295 o posterior**: las guardias usan `onFailure: "block"` en los hooks, que
  no existe antes (con una versión anterior, una guardia que se cae deja pasar todo).
- **Node.js** (18 o posterior; el plugin usa sólo módulos integrados, sin `npm install`).
- **git** (el libro de gastos guarda su copia canónica en el directorio común del repo).

## Instalación

Agregar el marketplace (dentro de una sesión de Claude Code):

```
/plugin marketplace add danielgrajales323/enjambre-marketplace
```

Instalar el plugin:

```
/plugin install enjambre@enjambre-marketplace
```

Recargar los plugins de la sesión:

```
/reload-plugins
```

La alternativa desde la shell, en dos pasos:

```
claude plugin marketplace add danielgrajales323/enjambre-marketplace
```

```
claude plugin install enjambre@enjambre-marketplace
```

Opcional, sólo para un **fork privado**: Claude Code usa las credenciales git de la máquina, así
que antes hace falta `gh auth login` y `gh auth setup-git` (o una clave SSH sin frase).

## Cómo usarlo en un proyecto

Ver el plan sin escribir nada:

```
/enjambre:init --dry-run
```

Instalar en el proyecto (copia `.enjambre/` sin pisar nada, fusiona reglas `deny` en
`.claude/settings.json` y crea el libro canónico de gastos):

```
/enjambre:init
```

Editar a mano `.enjambre/config.json`: el mapa de código obligatorio, los hosts permitidos (sólo
local y staging; producción va en prohibidos), los topes de gasto, los modelos por rol y la
autorización de seguridad (queda en `null` hasta que el dueño la firme). Después, un ciclo:

```
/enjambre:ciclo
```

`/enjambre:reporte` muestra el estado y `/enjambre:metodo` explica el método (oráculos, jueces,
protecciones, criterios de terminado, seguridad).

## Cómo actualizarlo

```
claude plugin update enjambre@enjambre-marketplace
```

```
/reload-plugins
```

## Cómo desarrollarlo

Probar la copia del repo sin instalarla (deshabilitar antes la instalada, que tiene el mismo nombre):

```
claude --plugin-dir ./plugins/enjambre
```

Validar el plugin y el marketplace, y correr las pruebas (sin red ni modelo):

```
claude plugin validate ./plugins/enjambre --strict
```

```
claude plugin validate . --strict
```

```
node plugins/enjambre/tests/run-all.mjs
```

Las pruebas viven en `plugins/enjambre/tests/` porque cada regla se valida por inversión (sin la
regla, la suite da rojo); por eso se publican con el plugin.

## Qué protege y qué NO

Las guardias (hooks `PreToolUse`) cortan: hosts fuera de la lista permitida y producción, comandos
destructivos, lectura del set reservado, escrituras sobre archivos protegidos y lectura de
secretos, correr lo que gasta pasado el tope o el aviso, y leer código sin consultar antes el mapa.
No hacen nada en un proyecto sin `.enjambre/`; con la configuración rota o borrada bloquean todo.

**Las guardias dificultan, no impiden.** Una evasión de shell (`bash -c`, alias, una ruta armada
por partes) o borrar la carpeta `.enjambre/` desde fuera de Claude Code las apaga. La protección
de fondo es el diseño: el contenido reservado se guarda comprimido, los jueces nunca son el modelo
que escribe, el que arregla nunca juzga, y el auditor revisa el transcript. La lista completa de
lo que cubre y lo que no está en
[`plugins/enjambre/skills/metodo/protecciones.md`](plugins/enjambre/skills/metodo/protecciones.md).

## Uso responsable

- Las pruebas de seguridad que trae el plugin son **sólo defensivas y sólo para sistemas propios**
  (autorización entre roles y tenants de prueba con canarios, aislamiento de datos), o con
  **autorización escrita** del dueño del sistema registrada en `.enjambre/config.json`
  (`seguridad.autorizacionDelDuenio`, con firmante y fecha). Sin ella, el generador tiene la
  instrucción de no generar esos escenarios (categorías `autorizacion`, `aislamiento`, `rls`) y de
  dejarlos como parada para el dueño, y el código los rechaza aunque el modelo los escriba: la
  guardia de escrituras niega guardar (o editar) un escenario con esas categorías, normalizadas y
  contra una lista cerrada (cualquier categoría desconocida también se niega), y
  `lib/escenarios.mjs` los filtra antes de correr. Lo que el código no puede ver: la categoría la
  declara el modelo, así que un escenario de autorización etiquetado como `funcional` no se detecta
  en código; lo ven el verificador y el auditor. Verificado con pruebas sin modelo; que un ciclo
  entero lo respete en una sesión real es parte de lo pendiente (lote 6 del plan).
- **Nunca contra producción.** Local o staging, con datos de prueba, nunca datos de personas reales.
- El plugin no contiene ni genera técnicas ofensivas. No lo uses contra sistemas que no son tuyos.
- Las guardias dificultan pero no impiden: el responsable de lo que corre en su máquina es quien
  la opera. El autor no se hace responsable del mal uso.

## Contribuir / reportar problemas

Los problemas y las propuestas van como *issues* en este repositorio. Para un cambio: un *pull
request* con su prueba validada por inversión (sin el cambio, la prueba tiene que dar rojo) y
`claude plugin validate --strict` en verde. Nada de datos reales de ningún negocio en fixtures ni
en ejemplos.

## Estado

Versión 0.1.0. Verificado sin modelo: `validate --strict`, `plugin details` (4 skills, 9 agentes,
2 hooks) y las suites del plugin (más de 400 aserciones, cada regla con su inversión).

**Falta verificar en vivo** (es lo primero del plan de desarrollo):

1. Las guardias dentro de una sesión real con `--plugin-dir` sobre un proyecto de prueba
   (matchers, tiempos, rutas en Windows).
2. `claude plugin eval` (gasta crédito) y el workflow `ciclo-exploracion` en la build instalada:
   el parámetro de modelo de `agent()` en un workflow de plugin no está documentado y se prueba
   ahí.
3. Un `ciclo.mjs` ejecutable por proyecto que una las piezas de `templates/lib/` (hoy el plugin
   trae las piezas, el flujo y las pruebas; el orquestador se arma en los lotes siguientes).

## Licencia

MIT, 2026, Daniel Grajales. Ver [`LICENSE`](LICENSE).
