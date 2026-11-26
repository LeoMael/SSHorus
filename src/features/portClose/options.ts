// «Cerrar puerto»: qué formas de cerrarlo funcionan de verdad según quién lo abre y qué cortafuegos hay,
// y la explicación en palabras simples. Funciones puras.
import { WELL_KNOWN, type ListenPort } from "../admin/ports";
import { ownerKey } from "../containers/owner";
import { blockPort } from "../infra/firewall/block";
import type { FwReport } from "../infra/firewall/types";
import { containerStopStep, killStep, localPublish, mappingFor, unitStep } from "./commands";
import type { CloseAction, CloseOption, CloseOptionId, ClosePlan, CloseStep, PortOpener } from "./types";

export interface CloseInput {
  port: ListenPort;
  opener: PortOpener;
  /** Lo leído del cortafuegos (null = no se pudo leer; `firewallError` dice por qué). */
  firewall: FwReport | null;
  firewallError?: string | null;
  /** Puertos de SSH (el de esta conexión primero): nunca se cierran. */
  sshPorts: number[];
  me: string | null;
}

const WHY_OPEN = "Un puerto está abierto porque un programa lo escucha";
const GENERAL = `${WHY_OPEN}: se cierra bloqueándolo en el cortafuegos (el programa sigue en marcha, pero desde fuera no se llega) o parando ese programa.`;

function engineName(o: Extract<PortOpener, { kind: "container" }>): string {
  const e = o.engine === "docker" ? "Docker" : o.engine === "podman" ? "Podman" : "un motor de contenedores";
  return o.rootless === null ? e : `${e} ${o.rootless ? "sin root" : "con root"}`;
}

function ctrLabel(o: Extract<PortOpener, { kind: "container" }>): string {
  return o.name ? `el contenedor «${o.name}»` : "un contenedor";
}

/** Docker y Podman con root ponen sus propias reglas antes que el cortafuegos (no basta con bloquearlo). */
function bypassesFirewall(o: PortOpener): boolean {
  return o.kind === "container" && o.rootless === false;
}

function explainText(i: CloseInput): string {
  const o = i.opener;
  switch (o.kind) {
    case "ssh":
      return "Es el puerto de SSH, por donde entra SSHorus: si lo cierras te quedas fuera del servidor, así que SSHorus no lo cierra.";
    case "container":
      if (o.rootless === false) {
        return `Este puerto lo publica ${ctrLabel(o)} (${engineName(o)}), que se salta el cortafuegos: para cerrarlo hay que parar el contenedor o publicarlo solo en local.`;
      }
      if (o.rootless) {
        return `Este puerto lo publica ${ctrLabel(o)} (${engineName(o)}), que sí respeta el cortafuegos: puedes bloquearlo ahí y el contenedor sigue funcionando para el propio servidor, o pararlo.`;
      }
      return `Este puerto lo publica ${ctrLabel(o)}. ${GENERAL}`;
    case "service":
      return `Lo escucha el servicio «${o.unit.replace(/\.service$/, "")}» (systemd). ${GENERAL}`;
    case "process":
      return `Lo escucha el programa «${o.procs[0].name}» (PID ${o.procs[0].pid}), que no es un servicio. ${GENERAL}`;
    default:
      return `${WHY_OPEN}, pero no se ve cuál (sin sudo solo se ven los tuyos): por ahora solo se puede bloquear en el cortafuegos.`;
  }
}

function option(id: CloseOptionId, title: string, text: string, action: CloseAction | null, blocked: string | null = null): CloseOption {
  return { id, title, text, action: blocked ? null : action, blocked: action || blocked ? blocked : "SSHorus no sabe hacerlo en este caso.", recommended: false };
}

function run(steps: (CloseStep | null)[], success: string): CloseAction | null {
  const ok = steps.filter((s): s is CloseStep => s !== null);
  return ok.length && ok.length === steps.length ? { kind: "run", steps: ok, success } : null;
}

function firewallOption(i: CloseInput): CloseOption {
  const title = "Bloquearlo en el cortafuegos";
  const text = "El programa sigue funcionando dentro del servidor, pero desde fuera ya no se llega. Se aplica a prueba: si no lo confirmas en 5 minutos, se deshace solo.";
  if (bypassesFirewall(i.opener)) {
    const engine = i.opener.kind === "container" && i.opener.engine === "docker" ? "Docker" : "El motor de contenedores con root";
    return option("firewall", title, text, null, `${engine} publica el puerto con sus propias reglas, antes que el cortafuegos: bloquearlo ahí no basta.`);
  }
  if (!i.firewall) return option("firewall", title, text, null, i.firewallError ?? "No se pudo leer el cortafuegos.");
  const b = blockPort(i.firewall, i.port.port, i.port.proto, i.sshPorts);
  if (b.kind === "already") return option("firewall", title, text, null, b.text);
  if (b.kind === "error") return option("firewall", title, text, null, b.text);
  return option("firewall", title, text, { kind: "firewall", plan: b.plan });
}

function containerOptions(i: CloseInput, o: Extract<PortOpener, { kind: "container" }>): CloseOption[] {
  const c = o.ctr;
  const noCtr = "No se sabe qué contenedor es: con sudo se ven los de todos los usuarios.";
  const stop = option(
    "ctr-stop",
    "Parar el contenedor",
    "La aplicación deja de funcionar mientras esté parado. Si tiene reinicio automático, puede volver a arrancar al reiniciar el servidor.",
    c ? run([containerStopStep(c, i.me)], `Contenedor «${c.name}» parado.`) : null,
    c ? null : noCtr,
  );
  const m = c ? mappingFor(c, i.port.port, i.port.proto) : null;
  const pub = m ? localPublish(m) : null;
  const localTitle = "Publicarlo solo en local";
  const localText = "El contenedor sigue funcionando, pero solo se llega desde el propio servidor (o con un túnel SSH desde tu PC).";
  let local: CloseOption;
  if (!c || !pub) local = option("ctr-local", localTitle, localText, null, c ? "No se encontró cómo publica este puerto." : noCtr);
  else if (c.composeProject) {
    const hint = `En Contenedores → Compose, abre «Editar compose» del proyecto «${c.composeProject}» y, en «ports:», cambia "${pub.now}" por "${pub.local}" (o quita esa línea). Después pulsa «Aplicar cambios».`;
    local = option("ctr-local", localTitle, localText, { kind: "compose", owner: ownerKey(c.ctOwner), name: c.name, hint });
  } else {
    const hint = `Este contenedor no es de Compose: vuelve a crearlo con «-p ${pub.local}» en vez de «-p ${pub.now}».`;
    local = option("ctr-local", localTitle, localText, { kind: "hint", hint });
  }
  return [local, stop];
}

function serviceOptions(i: CloseInput, o: Extract<PortOpener, { kind: "service" }>): CloseOption[] {
  const scope = { userUnit: o.userUnit, user: o.user, me: i.me };
  const name = o.unit.replace(/\.service$/, "");
  return [
    option("stop", "Parar el servicio", "Deja de escuchar ya, pero vuelve a arrancar al reiniciar el servidor.", run([unitStep(o.unit, "stop", scope)], `Servicio «${name}» parado.`)),
    option(
      "disable",
      "Parar y desactivar el servicio",
      "Deja de escuchar y ya no arranca al reiniciar. Lo que dependa de él deja de funcionar.",
      run([unitStep(o.unit, "disable", scope)], `Servicio «${name}» parado y desactivado.`),
    ),
  ];
}

/** Las formas de cerrar el puerto, la recomendada primero. */
export function closeOptions(i: CloseInput): ClosePlan {
  const explain = explainText(i);
  const o = i.opener;
  if (o.kind === "ssh") return { explain, options: [] };
  const fw = firewallOption(i);
  let rest: CloseOption[] = [];
  if (o.kind === "container") rest = containerOptions(i, o);
  else if (o.kind === "service") rest = serviceOptions(i, o);
  else if (o.kind === "process") {
    const name = o.procs[0].name;
    rest = [
      option(
        "kill",
        "Terminar el programa",
        "Deja de escuchar ya. Si algo lo vuelve a arrancar (o al reiniciar el servidor), el puerto se vuelve a abrir.",
        run([killStep(o.procs.map((p) => p.pid), o.user, i.me)], `Programa «${name}» terminado.`),
      ),
    ];
  }
  const options = bypassesFirewall(o) ? [...rest, fw] : [fw, ...rest];
  const best = options.find((x) => x.action && x.action.kind !== "hint");
  if (best) best.recommended = true;
  return { explain, options };
}

/** «8080/tcp (HTTP alternativo)», para el título. */
export function portTitle(p: Pick<ListenPort, "port" | "proto">): string {
  const known = WELL_KNOWN[p.port];
  return `${p.port}/${p.proto}${known ? ` (${known})` : ""}`;
}
