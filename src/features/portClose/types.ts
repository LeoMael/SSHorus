// «Cerrar puerto»: tipos de quién abre el puerto y de las formas de cerrarlo.
import type { PortProc } from "../admin/ports";
import type { Cmd } from "../containers/shell";
import type { Engine } from "../containers/types";
import type { FoundContainer } from "../containers/readAll";
import type { FwPlan } from "../infra/firewall/commands";

/** Quién tiene el puerto abierto (escuchando). */
export type PortOpener =
  /** El servidor SSH: por ahí entra SSHorus. No se cierra nunca desde aquí. */
  | { kind: "ssh" }
  /**
   * Un contenedor. `ctr` es null si no se pudo leer cuál (sin sudo); `rootless` null = no se sabe.
   * Docker y Podman con root publican con sus propias reglas, antes que el cortafuegos.
   */
  | { kind: "container"; name: string | null; engine: Engine | null; rootless: boolean | null; ctr: FoundContainer | null }
  /** Un servicio de systemd (del sistema o de `systemctl --user` de un usuario). */
  | { kind: "service"; unit: string; userUnit: boolean; user: string | null }
  /** Un programa suelto (sin servicio ni contenedor). */
  | { kind: "process"; procs: PortProc[]; user: string | null }
  /** No se ve el programa (sin sudo solo se ven los propios). */
  | { kind: "unknown" };

/** Un comando que se ejecuta para cerrar el puerto. `show` es lo que se enseña antes de confirmar. */
export type CloseStep =
  | { kind: "shell"; show: string; script: string; root: boolean }
  /** Comando del motor de contenedores, como el dueño del contenedor (tú, root u otro usuario). */
  | { kind: "engine"; show: string; cmd: Cmd; ctr: FoundContainer };

export type CloseAction =
  /** Cambio del cortafuegos, a prueba (se deshace solo si no se confirma). */
  | { kind: "firewall"; plan: FwPlan }
  | { kind: "run"; steps: CloseStep[]; success: string }
  /** Hay que editar el compose: se abre Contenedores con ese dueño (clave de `containers/owner.ts`). */
  | { kind: "compose"; owner: string; name: string; hint: string }
  /** Solo se explica cómo hacerlo (SSHorus no puede hacerlo solo). */
  | { kind: "hint"; hint: string };

export type CloseOptionId = "firewall" | "stop" | "disable" | "kill" | "ctr-stop" | "ctr-local";

export interface CloseOption {
  id: CloseOptionId;
  title: string;
  /** Qué pasa, en una frase. */
  text: string;
  /** null si no se puede (ver `blocked`). */
  action: CloseAction | null;
  /** Por qué no se puede (o no sirve), si es el caso. */
  blocked: string | null;
  recommended: boolean;
}

export interface ClosePlan {
  /** Una o dos frases: qué tiene abierto el puerto y qué significa cerrarlo. */
  explain: string;
  options: CloseOption[];
}
