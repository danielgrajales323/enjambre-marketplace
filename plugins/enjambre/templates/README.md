# `.enjambre/` — lo que el plugin dejó en este proyecto

Lo copió `/enjambre:init` desde `templates/` del plugin. Cada archivo tiene su hash en
`manifest.json`; `init` nunca pisa un archivo que ya existe (sólo con `--force`, con copia `.bak`).

| Archivo | Qué es | Quién lo toca |
|---|---|---|
| `config.json` | La configuración del enjambre para este proyecto: mapa obligatorio, hosts permitidos, comandos prohibidos, set reservado, topes de gasto, modelos por rol, autorización de seguridad | El dueño, a mano. Ningún agente (protegido) |
| `gastos.json` | El ESPEJO del libro de gastos. El canónico vive en el directorio común de git | Sólo los scripts del enjambre, dentro del candado |
| `manifest.json` | Hash de cada archivo copiado y la versión del plugin que lo copió | `init` |
| `lib/*.mjs` | Las piezas genéricas: libro de gastos, corte del reservado, núcleo de jueces, esquema estricto, comparador en doble orden, reporte (parada, meseta, piso y techo, `decidirMejora`, `verificarIndice`), Pareto por causa fina, set dorado, re-corrida parcial, variantes y la regla de oro de modelos | El proyecto puede adaptarlas; `init` no las vuelve a pisar |
| `set-dorado.json` | El set dorado: casos que ya fallaron y se arreglaron; corren primero en cada ciclo; un fallo es una REGRESIÓN y la medición no cuenta como mejora | Se suma con `agregarAlSetDorado` y se commitea; un caso nunca se saca |
| `lib/negocios/ejemplo.mjs` | Una configuración de jueces FICTICIA, para copiar | Reemplazar por la del negocio |
| `reservado/` | El set reservado. Ninguna herramienta de un agente lo lee (guardia + deny del proyecto) | Lo escribe el corte, una vez; lo lee sólo el script autorizado |

Las reglas de permiso (`permissions.deny`) se fusionaron en `.claude/settings.json`; `init` guardó
una copia previa en `.claude/settings.json.antes-de-enjambre.bak` la primera vez.
