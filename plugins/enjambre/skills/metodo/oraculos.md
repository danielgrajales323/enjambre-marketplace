# Oráculos: lo que decide por código

Un hallazgo sin oráculo es una opinión. Estos son los oráculos por defecto del enjambre, del más
barato al más caro. El generador de escenarios elige uno por celda del mapa; el verificador lo
evalúa con código.

| Tipo | Qué compara | Ejemplo genérico | Cuándo no sirve |
|---|---|---|---|
| **Invariante** | Un estado consigo mismo | "la suma de movimientos de una cuenta es igual a su saldo"; "nunca dos apartados activos para el mismo horario"; "toda fila creada tiene dueño" | Cuando la invariante no está escrita: primero hay que escribirla (es trabajo del cartógrafo encontrarlas) |
| **Diferencial entre roles** | La misma acción con dos identidades | "lo que ve el rol A no lo ve el rol B"; "el tenant 1 no lee al tenant 2 (canario)" | Cuando los roles no están modelados: entonces el hallazgo es "no hay roles", no un bug puntual |
| **Diferencial entre capas** | El cliente y el servidor, el esquema y la base, la API y la UI | "el validador del cliente y el del servidor rechazan lo mismo"; "el enum del esquema y el `check` de la base coinciden" | Cuando una capa es sólo cosmética por diseño (se documenta) |
| **Metamórfico** | Dos entradas relacionadas | "si cambio la zona horaria, la hora local cambia y el instante no"; "si reordeno los ítems, el total no cambia" | Cuando la relación no está definida (se pide al dueño) |
| **Propiedad** | Muchas entradas generadas con semilla | "para 500 montos al azar sembrado, redondear nunca cambia el signo"; "parsear(imprimir(x)) === x" | Cuando no hay generador: el escenario lo trae (sembrado, reproducible) |
| **Contrato** | Un acuerdo escrito entre dos partes | "el webhook responde 200 antes de 3 s"; "la salida cumple el JSON schema en todos los niveles" | Cuando el contrato no existe: primero se escribe |
| **Regresión (set dorado)** | El resultado de hoy contra el de un caso que ya falló una vez | "el caso #17 que prometía sigue rechazado" | Nunca se saca un caso del dorado |

Reglas:

- El oráculo lo evalúa el verificador con código (`lib/esquema.mjs` para esquemas,
  `verificarPisoYTecho` para detectores, una consulta o una comparación para invariantes). Si para
  decidir hace falta "leer y opinar", no es un oráculo: va al juez con rúbrica.
- Un oráculo que falla en TODOS los casos probablemente está mal planteado: el verificador lo
  intenta refutar una vez antes de confirmar.
- Las dos baterías de un detector (lo que debe atrapar, lo que no debe tocar) son datos fijos de
  la suite, con piso y techo. Medir un solo lado empuja el péndulo.
- La reproducción mínima es un comando que cualquiera corre en limpio. Sin eso, no hay hallazgo.
