---
name: init
description: Instala el enjambre en el proyecto actual. Copia las plantillas a .enjambre/ sin pisar nada (primero en modo simulación), escribe el manifiesto de hashes, fusiona las reglas deny en .claude/settings.json y crea el libro canónico de gastos. Usar una vez por proyecto, o para volver a copiar una pieza que falta.
disable-model-invocation: true
argument-hint: "[--dry-run] [--force] [--sin-settings] [--sin-canonico]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" *) Read Glob
---
# /enjambre:init

Instala el enjambre en ESTE proyecto. Nunca pisa un archivo del usuario. Todo lo hace un script
con sólo built-ins de Node: `"${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs"` (siempre entre comillas:
la ruta del plugin puede tener espacios).

## Pasos

1. **Simulación primero.** Corré:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --dry-run $ARGUMENTS`
   Mostrale al usuario el plan tal cual sale (qué crea, qué omite por existir, qué fusiona en
   `.claude/settings.json`, si crea el libro canónico). No escribe nada.
2. **Si el usuario confirma**, corré lo mismo sin `--dry-run`. Si pidió `--force`, avisale antes que
   cada archivo pisado deja una copia `.bak` y que `config.json` es suyo: con `--force` vuelve a la
   plantilla.
3. **Leé `.enjambre/config.json`** y repasá con el usuario lo que tiene que ajustar a mano
   (es un archivo protegido: ningún agente lo edita; lo edita él):
   - `proyecto`;
   - `mapa.herramienta` (`graphify` o la suya; `null` apaga la guardia del mapa) y `mapa.rutasDeCodigo`;
   - `red.hostsPermitidos` (sólo local y staging; producción NUNCA va acá) y `red.hostsProhibidos`
     (poné los de producción: la guardia los corta aunque alguien los agregue a permitidos);
   - `gasto.topeUsd`, `avisoUsd`, `reservaFinalUsd`;
   - `modelos` por rol: el juez y el comparador nunca de la familia del builder;
   - `seguridad.autorizacionDelDuenio`: queda `null` hasta que el dueño la escriba (ver
     `/enjambre:metodo`, "Seguridad").
4. **Recordale** que las reglas `deny` ya están en `.claude/settings.json` (el plugin no puede
   distribuir permisos: por eso se escriben en el proyecto), y que `.enjambre/reservado/` quedó
   vacía e ilegible para cualquier agente.
5. **Verificá** que las guardias están activas con una prueba inofensiva: pedile al usuario que en
   la misma sesión intente `Read` de `.enjambre/config.json` (pasa) y `Edit` del mismo archivo
   (la guardia de escrituras lo niega). Si no lo niega, el plugin no está habilitado en esta sesión.

El detalle de cada bandera, lo que hace el manifiesto y cómo se vuelve atrás está en
`detalle.md` de esta skill.
