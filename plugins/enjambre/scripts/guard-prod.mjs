// GUARDIA: NUNCA PRODUCCIÓN, Y NINGÚN COMANDO DESTRUCTIVO. Hook PreToolUse sobre Bash|PowerShell|WebFetch.
//
// Lo que corta:
//   · cualquier URL cuyo host esté en `red.hostsProhibidos` (gana siempre);
//   · si `red.hostsPermitidos` no está vacía, cualquier URL cuyo host NO coincida con un patrón
//     permitido (`localhost`, `*.test`, `*.localhost`...). Producción nunca está en esa lista;
//   · cualquier subcomando que coincida con una regex de `comandosProhibidos` (force-push,
//     reset --hard, rm -rf, deploy suelto, DROP/TRUNCATE...).
//
// Lo que NO cubre (dicho, no escondido): un host armado por partes en una variable, un script que
// arma la URL adentro, `bash -c`. La guardia cubre lo que un agente escribe normalmente; la
// garantía dura del host vive en el código del proyecto (su cliente HTTP con lista de hosts).
//
// Sin `.enjambre/`: no hace nada. Config rota: bloquea (comun.mjs).

import { coincideHost, correrGuardia, esPrincipal, hostsDe, subcomandos } from "./lib/comun.mjs";

export function decidir(ev, config) {
  const tool = ev.tool_name;
  let texto = "";
  if (tool === "Bash" || tool === "PowerShell") texto = String(ev.tool_input?.command ?? "");
  else if (tool === "WebFetch") texto = String(ev.tool_input?.url ?? "");
  else return null;

  for (const host of hostsDe(texto)) {
    if (config.red.hostsProhibidos.some((p) => coincideHost(host, p))) {
      return { motivo: `el host ${host} está en red.hostsProhibidos (nunca producción). El enjambre corre sólo contra local o staging.` };
    }
    if (config.red.hostsPermitidos.length && !config.red.hostsPermitidos.some((p) => coincideHost(host, p))) {
      return { motivo: `el host ${host} no está en red.hostsPermitidos (${config.red.hostsPermitidos.join(", ")}). El enjambre corre sólo contra los hosts que el dueño permitió en .enjambre/config.json.` };
    }
  }
  if (tool === "Bash" || tool === "PowerShell") {
    for (const sub of subcomandos(texto)) {
      for (const rx of config.comandosProhibidos) {
        if (new RegExp(rx, "i").test(sub)) return { motivo: `comando prohibido por .enjambre/config.json (comandosProhibidos: /${rx}/): "${sub.slice(0, 80)}".` };
      }
    }
  }
  return null;
}

if (esPrincipal(import.meta.url)) await correrGuardia("prod", decidir);
