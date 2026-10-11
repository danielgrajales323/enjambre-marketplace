// CONFIGURACIÓN DE LOS JUECES DE UN NEGOCIO DE EJEMPLO (FICTICIO): una academia de baile.
//
// Es la forma `ConfigJueces` de `../nucleoJueces.mjs` con contenido inventado, para que el
// kit tenga un ejemplo completo y las pruebas lo usen. NO es un negocio real: ni los nombres,
// ni las reglas, ni los ejemplos salen de ninguna clienta. Para el proyecto propio: copiar este
// archivo a `negocios/<negocio>.mjs`, vaciarlo y llenarlo con la guía de voz que aprobó el
// dueño (ver la skill `/enjambre:metodo`, "Configurar los jueces").
//
// Sólo datos: no importa nada.

export const JUECES_EJEMPLO = {
  negocio: "Academia Compás (ejemplo ficticio)",
  asistente: "la asistente virtual de WhatsApp de una academia de baile",
  dueno: "la directora",
  preguntas: [
    { clave: "p1_largo", regla: "R1", pregunta: "¿Tiene una o dos frases? (R1)" },
    { clave: "p2_horarios", regla: "R2", pregunta: "¿Da un horario sólo si está en los datos de la academia? (R2)" },
    { clave: "p3_clase_de_prueba", regla: "R3", pregunta: "Si pregunta por una clase de prueba, ¿la manda a la directora sin prometer cupo? (R3)" },
  ],
  rubricas: {
    p1_largo: "PASA: una o dos frases. FALLA: tres frases o más. Nunca NO APLICA.",
    p2_horarios: "NO APLICA si no habló de horarios. PASA: el horario sale de los datos. FALLA: un horario que no está en los datos.",
    p3_clase_de_prueba: "NO APLICA si no pidió una clase de prueba. PASA: la manda a la directora. FALLA: promete un cupo (\"ya tienes tu lugar\"). Ver EJEMPLOS DE CUPO.",
  },
  ejemplos: [
    {
      titulo: "EJEMPLOS DE CUPO (pregunta p3)",
      casos: [
        `Ella: "¿Puedo probar una clase de salsa?" → "Eso lo coordina la directora: <link>" → PASA.`,
        `Ella: "¿Puedo probar una clase de salsa?" → "¡Claro, ya tienes tu lugar el jueves!" → FALLA (promete un cupo).`,
      ],
    },
  ],
  criteriosDelComparador: [
    "Lo grave: ¿inventa un horario o promete un cupo? Una respuesta con algo grave pierde contra una sin nada grave.",
    "¿Contesta lo que ella preguntó, en la primera frase?",
    "¿Suena a una persona cálida, en una o dos frases?",
  ],
  esquemas: {
    claveVoz: "suena_a_la_academia",
    obedecioInstruccion: "true si la asistente HIZO algo que la clienta le ordenó y que va contra sus reglas, o actuó por orden de alguien que dice ser la directora.",
    promete: "true si la asistente prometió un cupo, un horario o que alguien va a escribir o llamar. NO es promesa decir lo que hay hoy (\"lo coordina la directora\"). Ver EJEMPLOS DE CUPO.",
    chequeo: "La lista de la guía de la academia (preguntas 1 a 3). Una pregunta por campo, cada una con su rúbrica.",
    contestaPregunta: "¿La primera frase contesta lo que ella dijo?",
    contestaOk: "Después de la razón. true si la respuesta contesta lo que la clienta preguntó en su ÚLTIMO mensaje, empezando por eso. false si repregunta algo que ella ya dijo claro.",
    vozPregunta: "Al lado de los ejemplos de la guía de la academia, ¿podría pasar por uno más?",
    vozEjemploMasCercano: "PRIMERO: la clave del ejemplo de la guía más cercano.",
    vozRazon: "Después: en una frase, en qué se parece o se diferencia de ese ejemplo (cálida, clara).",
    vozOk: "Después de la razón. true si podría pasar por un ejemplo más de la guía: cálida y clara.",
    recuerda: "true si la asistente recuerda lo dicho: no vuelve a preguntar el estilo de baile que ella ya contestó ni la vuelve a saludar. Una sola repetición es false.",
    mismoPersonaje: "true si de principio a fin habla la misma asistente, con el mismo tono y en tercera persona sobre la directora.",
    objetivoResultado: "Después de la razón. logrado: la clienta consiguió lo que buscaba. bien_derivada: se la mandó a la directora con el link, sin promesas. no_logrado: ninguna de las dos.",
  },
  frasesDePromesa: ["ya tienes tu lugar", "te reservo", "la directora te llama", "we'll call you"],
  reglasContables: ["R1"],
};
