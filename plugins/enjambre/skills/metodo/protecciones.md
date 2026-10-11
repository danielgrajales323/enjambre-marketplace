# Protecciones: hooks y código, no instrucciones en el prompt

Una regla que depende de que el agente la lea no es una regla. Cada protección del enjambre
tiene un mecanismo, y el prompt sólo lo explica.

| Protección | Mecanismo | Dónde | Qué pasa sin `.enjambre/` |
|---|---|---|---|
| Nunca producción | Hook PreToolUse `guard-prod.mjs` sobre Bash, PowerShell y WebFetch: todo host de una URL tiene que coincidir con `red.hostsPermitidos`; `red.hostsProhibidos` gana siempre | `.enjambre/config.json` → `red` | No actúa |
| Comandos destructivos | El mismo hook: regex de `comandosProhibidos` (force-push, reset --hard, rm -rf, deploy suelto, DROP/TRUNCATE) + reglas `deny` en `.claude/settings.json` que escribió `init` | `comandosProhibidos`; `templates/settings-deny.json` | No actúa |
| Tope de gasto | `guard-gasto.mjs` antes de lanzar un script de `gasto.scriptsQueGastan`: libro roto, al tope o pasado el aviso sin bandera → no arranca. Dentro del script, `lib/libroDeGastos.mjs` decide fino con el candado, el canónico y el espejo | `gasto` | No actúa |
| Set reservado ilegible (lo que la guardia puede) | `guard-reservado.mjs`: Read/Edit del reservado; Grep con `path` dentro o en un ancestro (raíz, `.enjambre`, `.`) salvo filtro a `.md`/`.txt`; Glob recursivo desde un ancestro; en la shell, lo que nombre la carpeta (glob, mayúsculas, barras invertidas incluidos) y los lectores recursivos sin ruta que lo excluya (`grep -r`, `rg`, `git grep`, `git log -p`, `git show`, `git diff`, `find -exec cat`, `tar`). Permitido: Write (el corte), `git add/commit`, los `lectoresAutorizados`, y el pathspec `:!<reservado>`. **DIFICULTA, no impide.** La protección de fondo: el contenido se guarda COMPRIMIDO (`escribirReservado` → `.json.gz`, ningún grep ni `git log -p` muestra texto) y ningún builder lo abre; el auditor lo revisa en el transcript | `reservado` + `deny` en settings | No actúa |
| Mapa antes del código | `guard-mapa.mjs pre` niega leer o buscar código sin una consulta reciente a `mapa.herramienta`; `post` anota cada consulta. Configurable: la herramienta, los subcomandos, la ventana, las carpetas, las extensiones. `herramienta: null` la apaga | `mapa` | No actúa |
| Escrituras peligrosas y secretos | `guard-escrituras.mjs`: Edit/Write y shell (redirección con o sin espacio, tee, sed -i, cp, mv, rm, git rm, Remove-Item) sobre `protegidos`; Read/Grep/Glob y shell (cat, glob `.env*`, `node -e`/`python -c` que lo lean, source/export) sobre `secretos` | `protegidos`, `secretos` | No actúa |
| Config rota o BORRADA | Toda guardia busca la CARPETA `.enjambre/` (sin pasar la raíz del repo git): si existe y falta `config.json`, o no es JSON, o no pasa `problemasDeConfig` (estricta), BLOQUEA todo salvo los dos comandos de recuperación exactos (`git checkout -- .enjambre/config.json`, `node <plugin>/scripts/init.mjs`). `init` escribe `config.json` PRIMERO y valida la que queda (sale con 2 si es inválida) | `scripts/lib/comun.mjs`, `scripts/init.mjs` | — |
| Escenarios de seguridad sin autorización | `guard-escrituras.mjs`: `Write`/`Edit` bajo `.enjambre/trabajo/escenarios*/` con categoría `autorizacion`/`aislamiento`/`rls` (normalizada) sin `seguridad.autorizacionDelDuenio` → deny; categoría fuera de la lista cerrada, sin categoría o JSON roto → deny; escribirlos por shell o código → deny. `lib/escenarios.mjs` repite la regla en el orquestador | `seguridad.autorizacionDelDuenio` | No actúa |
| La carpeta `.enjambre/` misma | `guard-escrituras.mjs` corta borrarla, moverla o renombrarla por shell, PowerShell, git, find o código (`rmSync`, `shutil.rmtree`); `settings-deny.json` niega `rm`/`mv`/`git rm`/`Remove-Item`/`Rename-Item`/`Move-Item` sobre `*.enjambre*` | `scripts/guard-escrituras.mjs`, `templates/settings-deny.json` | No actúa (es el límite: ver abajo) |
| Guardia caída | `onFailure: "block"` y `timeout: 10` en `hooks/hooks.json`: una guardia que se cae o se cuelga bloquea, nunca deja pasar | `hooks/hooks.json` | — |
| El juez no es el redactor | Código: `familiaDe(modelos.juez) !== familiaDe(modelos.builder)` verificado antes de cada llamada; `model` explícito en cada `Agent` | `modelos` | — |
| Sólo lectura de verdad | `tools` sin Write ni Edit en verificador, juez, auditor, triage, cartógrafo | `agents/*.md` | — |

## Lo que las guardias NO cubren (dicho, no escondido)

Las guardias DIFICULTAN y no impiden. Lo que hace el código, y lo que queda afuera:

- **Evasiones de shell que no se miran:** `bash -c '...'`, `sh -c`, alias, una variable que
  arma la ruta o el host por partes, `eval`, un script propio que haga adentro lo prohibido,
  `xargs` (`find … | xargs zcat`), copiar la carpeta y leer la copia (`cp -r` del reservado a
  otro lado), `python -c`/`node -e` que lean el reservado con la ruta armada (sólo se reconoce
  la ruta escrita entera). La garantía dura vive en el código del proyecto (su cliente HTTP con
  lista de hosts, su key de desarrollo obligatoria) y, para el reservado, en el contenido
  comprimido y en que el auditor revisa el transcript.
- **La carpeta `.enjambre/` misma:** borrarla, moverla o renombrarla apaga todas las guardias.
  Se corta `rm`/`rmdir`/`mv`/`del`/`Remove-Item`/`Rename-Item`/`Move-Item`/`git rm`/`git mv`/
  `find -delete`/`rmSync`/`shutil.rmtree` sobre cualquier token que SEA la carpeta (mayúsculas,
  barras, comillas, `./`, dentro de código), y `settings-deny.json` niega `rm`/`mv`/`git rm`/
  `Remove-Item`/`Rename-Item`/`Move-Item` sobre `*.enjambre*`. Lo que queda: una evasión de
  shell de las de arriba, o hacerlo desde fuera de Claude Code. Si la carpeta no está, las
  guardias no actúan: es un límite, dicho acá.
- **Sin `config.json`** (con la carpeta presente) todo se niega salvo exactamente dos comandos
  de recuperación, solos: `git checkout -- .enjambre/config.json` y `node <plugin>/scripts/init.mjs`
  (con sus banderas). Cualquier otra forma de restaurarla (otro archivo, un `node -e`, un
  comando encadenado) la hace el dueño fuera de las herramientas.
- **Hosts:** se reconocen URLs con esquema; `-h`/`--host`/`-H`; `host:puerto`; cualquier
  argumento con forma de host después de un verbo de red (curl, wget, psql, mysql, nc, ssh,
  Invoke-WebRequest…); `host=…` en una cadena de conexión; `user@host`. No se reconoce un host
  en una variable de entorno, en un archivo de configuración ni armado por partes.
- **Secretos:** se reconocen por nombre (`secretos`: `.env`, `.env.*`) en Read/Grep/Glob y en la
  shell cuando el subcomando los nombra (token, glob, literal dentro de código) y lee, escribe,
  carga (`source`, `export`, `--env-file`) o evalúa. Un secreto con otro nombre no está cubierto.
- **Reservado:** se cortan los lectores recursivos listados (incluidos `git -C`, `git --no-pager`
  y `git format-patch`) y lo que nombre la carpeta. Un lector que no esté en la lista, o que
  reciba la ruta por `xargs` o por variable, pasa: por eso el contenido va comprimido.
- `ubicarRaiz` no sube más allá de la raíz del repo git (una `.enjambre/` en HOME no activa las
  guardias en todos los proyectos); un proyecto sin `.git` sube hasta la raíz del disco.
- **Escenarios de seguridad:** la guardia de escrituras niega `Write`/`Edit` de un escenario con
  categoría `autorizacion`/`aislamiento`/`rls` (normalizada: tilde, mayúsculas, espacios) sin
  `seguridad.autorizacionDelDuenio` (firmante y fecha real, no futura), niega cualquier categoría
  fuera de la lista cerrada, y niega escribir escenarios por la shell o por código. Lo que NO ve: la
  categoría la declara el modelo; un escenario de autorización etiquetado como `funcional` pasa por
  el código y lo ven el verificador y el auditor.
- Un hook duplicado (el mismo en el proyecto y en el plugin) corre dos veces: no es un problema de
  seguridad, pero sí de tiempo.
- `if` en hooks.json es best-effort: por eso el bloqueo duro va por reglas `deny` del proyecto.

## Cómo se prueban

`tests/test-guardias.mjs` del plugin: cada guardia como proceso (JSON por stdin, código de salida,
JSON de respuesta) y como función pura. Incluye "proyecto sin `.enjambre/` → no actúa" y "config
rota → bloquea". Cada regla se validó por inversión: sin ella, la suite da ROJO.
