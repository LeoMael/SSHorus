// Columna «Contenedores» de Usuarios: «Podman: sí / limitado» (con linger), «Docker: sí (equivale a root)»
// y «Docker sin root», cada uno con su explicación al pasar el ratón.
import type { UserContainers, UserRow } from "../../../features/admin";
import type { Column } from "../VirtualTable";
import "./ContainerAccess.css";

interface Tag {
  text: string;
  cls: string;
  title: string;
}

const LINGER_TEXT: Record<"on" | "off", string> = {
  on: "Linger activado: sus contenedores siguen encendidos al cerrar sesión y pueden arrancar solos al reiniciar el servidor.",
  off: "Sin linger: sus contenedores se apagan al cerrar sesión y no arrancan solos al reiniciar el servidor.",
};

function containerTags(c: UserContainers): Tag[] {
  const tags: Tag[] = [];
  const linger = c.linger === null ? "" : ` ${LINGER_TEXT[c.linger ? "on" : "off"]}`;
  if (c.podman === "yes") {
    tags.push({
      text: c.linger === false ? "Podman: sí · sin linger" : "Podman: sí",
      cls: "adm-tag adm-tag-green",
      title: `Tiene rangos en /etc/subuid y /etc/subgid: puede usar Podman sin root.${linger}`,
    });
  } else if (c.podman === "limited") {
    tags.push({
      text: "Podman: limitado",
      cls: "adm-tag adm-tag-yellow",
      title:
        "No tiene rangos en /etc/subuid ni /etc/subgid: podman funciona con un solo usuario dentro del contenedor y muchas imágenes fallan.",
    });
  }
  if (c.dockerGroup) {
    tags.push({
      text: "Docker: sí (equivale a root)",
      cls: "adm-tag adm-tag-red",
      title: "Está en el grupo docker: con un contenedor puede leer y cambiar cualquier archivo del servidor, como root.",
    });
  }
  if (c.dockerRootless) {
    tags.push({ text: "Docker sin root", cls: "adm-tag adm-tag-accent", title: "Tiene su propio Docker sin root encendido." });
  }
  return tags;
}

const ROOT_TITLE = "root puede usar Podman y Docker sin permisos extra";

/** Columna para la tabla de Usuarios. */
export function containerColumn(access: ReadonlyMap<string, UserContainers>): Column<UserRow> {
  return {
    key: "containers",
    label: "Contenedores",
    width: "minmax(130px, 1.3fr)",
    render: (u) => {
      const a = access.get(u.name);
      return a ? <ContainerTags access={a} isRoot={u.uid === 0} /> : null;
    },
    title: (u) => {
      const a = access.get(u.name);
      if (!a) return "";
      return u.uid === 0
        ? ROOT_TITLE
        : containerTags(a)
            .map((t) => t.title)
            .join("\n");
    },
  };
}

function ContainerTags({ access, isRoot }: { access: UserContainers; isRoot: boolean }) {
  const tags = containerTags(access);
  if (isRoot) return <span className="faint">root</span>;
  if (!tags.length) return <span className="faint">—</span>;
  return (
    <span className="cta-tags">
      {tags.map((t) => (
        <span key={t.text} className={t.cls}>
          {t.text}
        </span>
      ))}
    </span>
  );
}
