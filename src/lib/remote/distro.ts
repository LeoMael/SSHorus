// Familia de la distribución del servidor a partir de `ID` / `ID_LIKE` de /etc/os-release. Una sola tabla
// para todos los que eligen comandos según la distro (instalar tmux o un motor de contenedores, el grupo
// de administración, la biblioteca de comandos). Funciones puras.

export type DistroFamily = "rhel" | "debian" | "alpine" | "arch" | "suse" | "freebsd";

/** Formato de paquetes del sistema (para elegir comandos de la biblioteca). */
export type PackageFormat = "rpm" | "deb" | "apk";

interface FamilyRow {
  family: DistroFamily;
  /** Valores de `ID` / `ID_LIKE` que la delatan. */
  ids: string[];
  /** Nombre legible según los ids concretos. */
  label: (has: (...xs: string[]) => boolean) => string;
  packages: PackageFormat | null;
}

// En este orden: la primera familia que encaja gana.
const FAMILIES: FamilyRow[] = [
  {
    family: "rhel",
    ids: ["fedora", "rhel", "centos", "rocky", "almalinux", "ol", "amzn"],
    label: (has) => (has("fedora") && !has("rhel") ? "Fedora" : "RHEL / Rocky / Alma"),
    packages: "rpm",
  },
  {
    family: "debian",
    ids: ["ubuntu", "debian", "linuxmint", "pop", "raspbian", "kali"],
    label: (has) => (has("ubuntu") ? "Ubuntu" : "Debian"),
    packages: "deb",
  },
  { family: "alpine", ids: ["alpine"], label: () => "Alpine", packages: "apk" },
  { family: "arch", ids: ["arch", "manjaro", "endeavouros"], label: () => "Arch Linux", packages: null },
  {
    family: "suse",
    ids: ["opensuse", "opensuse-leap", "opensuse-tumbleweed", "suse", "sles"],
    label: () => "openSUSE",
    packages: "rpm",
  },
  { family: "freebsd", ids: ["freebsd"], label: () => "FreeBSD", packages: null },
];

export interface DistroInfo {
  /** null = no se reconoce. */
  family: DistroFamily | null;
  /** Nombre legible («Ubuntu», «RHEL / Rocky / Alma»…); sin familia, el `ID` o «tu sistema». */
  label: string;
  packages: PackageFormat | null;
}

/** Familia de la distro. `distroLike`: `ID_LIKE` ya separado por espacios. */
export function distroFamily(distroId: string | null, distroLike: string[] = []): DistroInfo {
  const ids = [distroId ?? "", ...distroLike].map((s) => s.toLowerCase());
  const has = (...xs: string[]) => xs.some((x) => ids.includes(x));
  const row = FAMILIES.find((f) => has(...f.ids));
  if (!row) return { family: null, label: distroId ?? "tu sistema", packages: null };
  return { family: row.family, label: row.label(has), packages: row.packages };
}

/** Lo mismo a partir de lo leído por `parseOsRelease`. */
export function distroFromOsRelease(os: Record<string, string>): DistroInfo {
  return distroFamily(os.ID ?? null, (os.ID_LIKE ?? "").split(/\s+/).filter(Boolean));
}
