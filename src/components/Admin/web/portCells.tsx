// Celdas de la tabla de «Puertos»: etiqueta de alcance y texto del proceso.
import type { ListenPort } from "../../../features/admin";

export function scopeTag(p: ListenPort) {
  if (p.scope === "public")
    return (
      <span
        className="adm-tag adm-tag-yellow"
        title="Escucha en todas las interfaces: se puede llegar desde fuera si el cortafuegos lo permite"
      >
        Expuesto
      </span>
    );
  if (p.scope === "local")
    return (
      <span className="adm-tag adm-tag-green" title="Solo se puede usar desde el propio servidor">
        Solo local
      </span>
    );
  return (
    <span className="adm-tag adm-tag-accent" title="Escucha solo en esta dirección del servidor">
      Una IP
    </span>
  );
}

/** Nombre del programa: «nginx (1200, 1201)». */
export function procText(p: ListenPort): string {
  if (p.procs.length === 0) return "";
  const names = [...new Set(p.procs.map((x) => x.name))];
  return `${names.join(", ")} (${p.procs.map((x) => x.pid).join(", ")})`;
}
