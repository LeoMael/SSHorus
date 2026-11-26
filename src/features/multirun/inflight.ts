// Piezas del motor de «Ejecutar en varios servidores» que no dependen de un servidor concreto:
// el límite de servidores a la vez y cómo se detiene un comando que ya está en marcha.

/** Ejecución en curso de un servidor (para poder detenerla al cancelar). */
export interface InFlight {
  execId: string;
  sessionId: string;
  /** La sesión la abrió la ejecución: se cierra cuando el comando se haya detenido. */
  owned: boolean;
  /** Se cumple cuando `exec` termina (bien o mal). */
  settled: Promise<void>;
}

/** Espera máxima a que el servidor detenga el comando antes de cerrar la sesión propia igualmente. */
export const STOP_WAIT_MS = 15_000;
/** Reintentos de `cancelExec` si la ejecución aún no estaba anotada en el motor (llamadas casi a la vez). */
const CANCEL_TRIES = 4;
const CANCEL_RETRY_MS = 250;

export const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** Pide cancelar; si el motor aún no conocía la ejecución, lo vuelve a intentar unas veces. */
export async function requestCancel(ex: InFlight, cancelExec: (execId: string) => Promise<boolean>): Promise<void> {
  let done = false;
  void ex.settled.then(() => {
    done = true;
  });
  for (let i = 0; i < CANCEL_TRIES && !done; i++) {
    if (await cancelExec(ex.execId).catch(() => false)) return;
    await delay(CANCEL_RETRY_MS);
  }
}

/** Cola de turnos: como mucho `limit()` a la vez; el resto espera en orden de llegada. */
export class Slots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: () => number) {}

  acquire(): Promise<void> {
    if (this.active < Math.max(1, this.limit())) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((res) =>
      this.waiting.push(() => {
        this.active++;
        res();
      }),
    );
  }

  release(): void {
    this.active--;
    this.waiting.shift()?.();
  }
}
