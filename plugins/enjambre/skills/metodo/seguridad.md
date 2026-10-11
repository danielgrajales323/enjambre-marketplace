# Seguridad: sólo diseño defensivo del sistema propio

El enjambre prueba que el sistema PROPIO cumple sus reglas de autorización y aislamiento. No
ataca nada: no hay payloads, no hay técnicas de explotación, no hay instrucciones de ataque en
este plugin, y ningún agente las genera.

## Qué se prueba

- **Autorización entre roles**: la misma acción con dos identidades de prueba; el oráculo
  diferencial dice que lo que puede el rol A no lo puede el rol B.
- **Aislamiento entre tenants**: cada tenant de prueba tiene un CANARIO (un dato marcado y único);
  si un canario aparece en la respuesta de otro tenant, es la falla. Es un oráculo determinista.
- **Políticas de fila (RLS o equivalente)**: con el cliente de cada rol, leer y escribir filas
  propias y ajenas; el oráculo es la política escrita.
- **Contratos**: lo que el esquema promete (campos obligatorios, enums) coincide con lo que la base
  exige.

## Condiciones, todas obligatorias

1. **Local o staging, nunca producción.** `red.hostsPermitidos` sólo con hosts de prueba; los de
   producción en `red.hostsProhibidos`.
2. **Autorización escrita del dueño** en `.enjambre/config.json` →
   `seguridad.autorizacionDelDuenio`:
   ```json
   { "firmante": "<nombre>", "fecha": "<ISO>", "alcance": "staging <host>", "tenantsDePrueba": ["t1", "t2"], "notas": "…" }
   ```
   `firmante` y `fecha` son obligatorios (`problemasDeConfig` los exige). Mientras es `null` o
   inválida, pasan DOS cosas, y las dos están en el código:
   - el generador (`agents/generador-escenarios.md`, y el prompt del workflow
     `ciclo-exploracion.js`, que recibe el valor por `args.autorizacionDelDuenio`) tiene la
     instrucción de NO generar escenarios de categoría `autorizacion`, `aislamiento` ni `rls`, y de
     listarlos en `sin-autorizacion.json` como PARADA para el dueño;
   - la red DETERMINISTA: `guard-escrituras.mjs` niega el `Write` (y el `Edit` que cambie la
     categoría) de cualquier `.enjambre/trabajo/escenarios*/**.json|jsonc` cuya `categoria`, una
     vez NORMALIZADA (trim, minúsculas, sin tildes), sea `autorizacion`, `aislamiento` o `rls` sin
     autorización vigente (`problemasDeEscenario`, `scripts/lib/comun.mjs`). La categoría tiene
     que ser una de la lista CERRADA (`funcional`, `contrato`, `propiedad`, `metamorfico`,
     `autorizacion`, `aislamiento`, `rls`): "authorization", "permisos", "seguridad", un arreglo o
     una inventada se NIEGAN (falla cerrada), igual que un escenario sin categoría o que no es
     JSON. Escribir escenarios por la shell o por código (`>`, `cp`, `writeFileSync`) también se
     niega: se escriben sólo con `Write`, donde la guardia los revisa. `lib/escenarios.mjs`
     (`filtrarEscenarios`) repite la regla para el orquestador antes de correr nada. La fecha de la
     autorización tiene que ser real (no `99-99`) y no futura.

   **Lo que la red NO ve:** la categoría la declara el modelo. Un escenario de autorización
   etiquetado como `funcional` pasa por el código; lo ven el verificador (al reproducirlo: "¿esto
   compara dos roles o dos tenants?") y el auditor. Por eso la instrucción al generador sigue
   siendo necesaria, y por eso la parada de autorización es del dueño y no del código.

   Lo verificado: `tests/test-guardias.mjs` §7 (Write/Edit con y sin autorización, categorías
   escritas distinto, lista cerrada, `escenarios2/` y `.jsonc`, shell y código, fechas) y
   `tests/test-proceso.mjs` §6 (`filtrarEscenarios`, normalización, fechas), con sus
   inversiones. Lo que falta: que un ciclo completo en una sesión real respete el candado de punta
   a punta (lote 6).
3. **Datos de prueba**, nunca de personas reales. Los tenants y usuarios se crean para la prueba
   y se nombran como tales.
4. **Herramientas externas** (escáneres de dependencias, linters de políticas): sólo las que el
   dueño configure, por nombre y licencia, en la documentación del proyecto. El plugin no trae
   ninguna.

## Qué queda fuera

Cualquier prueba contra sistemas que no son del dueño, cualquier técnica ofensiva, cualquier
dato real. Si un escenario lo necesitara, no se genera: se reporta como fuera de alcance.
