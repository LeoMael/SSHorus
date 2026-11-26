// Texto que se guarda en el historial de Administración por cada cambio: con qué se elevó y los
// comandos. Las contraseñas nunca van en los comandos (van por stdin) y aquí solo sale su etiqueta.
import type { Elevation } from "../privileges";
import type { Plan } from "./commands";
import { MASK } from "./shell";

export function elevationNote(el: Elevation): string {
  switch (el.kind) {
    case "root":
      return "# como root";
    case "nopasswd":
      return `# como root con ${el.tool} -n`;
    case "password":
      return `# como root con sudo -S (contraseña por stdin: ${MASK})`;
    default:
      return "# sin elevar";
  }
}

export function historyCommand(plan: Plan, el: Elevation): string {
  return [elevationNote(el), ...plan.steps, ...(plan.secretLabel ? [`# entrada estándar: ${plan.secretLabel}`] : [])].join("\n");
}
