// Aviso antes de cerrar una conexión (lógica pura, sin React ni stores):
// archivos con cambios sin guardar y transferencias sin terminar.

export interface CloseWarning {
  title: string;
  message: string;
  confirmText: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function dirtyText(names: string[]): string {
  if (names.length === 1) return `«${names[0]}» tiene cambios sin guardar`;
  const list = `${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}`;
  return `${names.length} archivos tienen cambios sin guardar (${list})`;
}

function transfersText(n: number): string {
  return `${plural(n, "hay una transferencia", `hay ${n} transferencias`)} sin terminar`;
}

/** Qué preguntar al cerrar la conexión `title`; null si se puede cerrar sin preguntar. */
export function closeWarning(title: string, dirtyNames: string[], pendingTransfers: number): CloseWarning | null {
  const dirty = dirtyNames.length > 0;
  const busy = pendingTransfers > 0;
  if (!dirty && !busy) return null;
  if (dirty && !busy) {
    return {
      title: "Cambios sin guardar",
      message: `${dirtyText(dirtyNames)} en «${title}». ¿Cerrar la conexión y descartarlos?`,
      confirmText: "Cerrar y descartar",
    };
  }
  const t = transfersText(pendingTransfers);
  if (!dirty) {
    return {
      title: "Transferencias en curso",
      message: `En «${title}» ${t}. Si cierras la conexión, se cortan. ¿Cerrarla igualmente?`,
      confirmText: "Cerrar y cortar",
    };
  }
  return {
    title: "¿Cerrar la conexión?",
    message: `En «${title}» ${dirtyText(dirtyNames)} y ${t}. Al cerrar se pierden los cambios y se cortan las transferencias.`,
    confirmText: "Cerrar igualmente",
  };
}
