# /enjambre:init — detalle

## Banderas de `scripts/init.mjs`

| Bandera | Qué hace |
|---|---|
| `--dry-run` | Imprime el plan y no escribe nada: ni `.enjambre/`, ni el manifiesto, ni settings, ni el canónico |
| `--force` | Pisa los archivos que ya existen, dejando antes una copia `.bak` (`.bak.2`, `.bak.3`… si ya había) |
| `--sin-settings` | No toca `.claude/settings.json` |
| `--sin-canonico` | No crea el libro canónico en el directorio común de git |
| `--proyecto <dir>` | La raíz del proyecto (por defecto `CLAUDE_PROJECT_DIR` o el cwd) |
| `--plantillas <dir>` | Otra carpeta de plantillas (por defecto `templates/` del plugin) |

## Qué se copia y adónde

`templates/<ruta>` → `.enjambre/<ruta>`, con la bandera `wx`: si el archivo aparece entre la
comprobación y la escritura, choca y se informa; nunca se pisa. `settings-deny.json` no se copia:
se fusiona.

## El manifiesto (`.enjambre/manifest.json`)

Un sha256 por archivo copiado, tal como quedó escrito, más la versión del plugin. Un archivo
omitido conserva su hash real (o el que decía el manifiesto previo). `/enjambre:reporte` lo
compara con `templates/` para decir qué piezas el proyecto adaptó y cuáles siguen como vinieron.

## `.claude/settings.json`

Se fusionan las reglas de `templates/settings-deny.json` en `permissions.deny`: se agregan las que
faltan, no se quita ninguna, no se toca otra clave. La primera vez se guarda una copia en
`.claude/settings.json.antes-de-enjambre.bak`. Si el archivo no es JSON válido, no se toca y se
avisa.

Por qué acá: un plugin no puede distribuir reglas de permiso (su `settings.json` sólo aplica
`agent` y `subagentStatusLine`). Las guardias (hooks) refuerzan, pero una regla `deny` del
proyecto es la que vale aunque un hook falle.

## El libro canónico

`<git common dir>/<gasto.carpetaCanonico>/gastos.json`, creado una vez desde el espejo. Compartido
por todos los worktrees y fuera del árbol: `checkout`, `stash` y `reset` no lo tocan. Si el
proyecto no es un repo de git, se avisa y ninguna corrida que gaste arranca hasta que lo sea.

## Volver atrás

Borrar `.enjambre/` y quitar de `.claude/settings.json` las reglas que agregó init (la copia
`.antes-de-enjambre.bak` tiene el estado anterior). El libro canónico queda a propósito: si se
borra, el gasto acumulado se pierde.
