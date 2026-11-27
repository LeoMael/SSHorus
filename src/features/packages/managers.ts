// Paquetes: qué comando usa cada gestor (dnf, yum, apt, zypper, apk) para ver actualizaciones, buscar,
// comprobar lo instalado, simular un «quitar» y cambiar cosas. Una sola tabla; los scripts de lectura se
// arman recorriéndola. Los nombres llegan ya validados (`validPackage`). Funciones puras.
import { shQuote } from "../../lib/remote";
import type { UpgradeFamily } from "../vulnscan";
import type { PkgManager } from "./parse";

type Real = Exclude<PkgManager, "none">;

interface ManagerRow {
  /** Ejecutable que lo delata (el primero que exista gana, en el orden de la tabla). */
  bin: string;
  label: string;
  /** Familia para el comando de actualizar unos paquetes (el mismo que «Arreglar» del escáner). */
  family: UpgradeFamily;
  /** Descarga la lista nueva de paquetes (antes de leer las actualizaciones). */
  refresh: string | null;
  /** Actualizaciones pendientes; `R` = con la lista ya bajada o no. */
  updates: (refresh: boolean) => string;
  /** Avisos de seguridad (dnf: paquetes; zypper: un número de parches). */
  security: string | null;
  search: (term: string) => string;
  /** Imprime, de los nombres dados, los que están instalados (uno por línea). null = la búsqueda ya lo dice. */
  installed: ((names: string) => string) | null;
  simulateRemove: (name: string) => string;
  upgradeAll: string;
  /** Solo las actualizaciones de seguridad (null = la distro no lo distingue: se actualizan los paquetes marcados). */
  upgradeSecurity: string | null;
  install: (name: string) => string;
  remove: (name: string) => string;
}

const APT_ENV = "DEBIAN_FRONTEND=noninteractive";
const APT_KEEP = "-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold";

const dnfLike = (bin: "dnf" | "yum"): ManagerRow => ({
  bin,
  label: bin,
  family: bin === "dnf" ? "rpm-dnf" : "rpm-yum",
  refresh: null,
  updates: (r) => `${bin} -q${r && bin === "dnf" ? " --refresh" : ""} check-update`,
  security: bin === "dnf" ? "dnf -q updateinfo list --security" : "yum -q updateinfo list security",
  search: (t) => `${bin} -q search ${t}`,
  installed: (n) => `rpm -q --qf '%{NAME}\\n' ${n} 2>/dev/null | grep -v ' '`,
  simulateRemove: (n) => `${bin} remove --assumeno ${n}`,
  upgradeAll: bin === "dnf" ? "dnf upgrade -y --refresh" : "yum update -y",
  upgradeSecurity: bin === "dnf" ? "dnf upgrade -y --refresh --security" : "yum update -y --security",
  install: (n) => `${bin} install -y ${n}`,
  remove: (n) => `${bin} remove -y ${n}`,
});

export const MANAGERS: Record<Real, ManagerRow> = {
  dnf: dnfLike("dnf"),
  yum: dnfLike("yum"),
  apt: {
    bin: "apt-get",
    label: "apt",
    family: "apt",
    refresh: "apt-get update -q",
    updates: () => "apt list --upgradable",
    security: null,
    search: (t) => `apt-cache search ${t}`,
    installed: (n) => `dpkg-query -W -f='\${Package} \${db:Status-Abbrev}\\n' ${n} 2>/dev/null | awk '$2 ~ /^[ih]i/ {print $1}'`,
    simulateRemove: (n) => `apt-get -s remove ${n}`,
    upgradeAll: `apt-get update -q && ${APT_ENV} apt-get upgrade -y -q ${APT_KEEP}`,
    upgradeSecurity: null,
    install: (n) => `apt-get update -q && ${APT_ENV} apt-get install -y -q ${APT_KEEP} ${n}`,
    remove: (n) => `${APT_ENV} apt-get remove -y -q ${n}`,
  },
  zypper: {
    bin: "zypper",
    label: "zypper",
    family: "suse",
    refresh: "zypper -n refresh",
    updates: () => "zypper -n --no-refresh --xmlout list-updates",
    security: `zypper -n --no-refresh --xmlout list-patches --category security | grep -c 'status="needed"'`,
    search: (t) => `zypper -n --no-refresh search ${t}`,
    installed: null,
    simulateRemove: (n) => `zypper -n remove --dry-run ${n}`,
    upgradeAll: "zypper -n refresh && zypper -n update",
    upgradeSecurity: "zypper -n refresh && zypper -n patch --category security",
    install: (n) => `zypper -n install ${n}`,
    remove: (n) => `zypper -n remove ${n}`,
  },
  apk: {
    bin: "apk",
    label: "apk",
    family: "apk",
    refresh: "apk update -q",
    updates: () => "{ apk list -u 2>/dev/null || apk version -l '<'; }",
    security: null,
    search: (t) => `apk search -v ${t}`,
    installed: (n) => `apk info -e ${n} 2>/dev/null`,
    simulateRemove: (n) => `apk del -s ${n}`,
    upgradeAll: "apk update && apk upgrade",
    upgradeSecurity: null,
    install: (n) => `apk add ${n}`,
    remove: (n) => `apk del ${n}`,
  },
};

const ORDER: Real[] = ["dnf", "yum", "apt", "zypper", "apk"];

export function managerRow(m: PkgManager): ManagerRow | null {
  return m === "none" ? null : MANAGERS[m];
}

const PRELUDE = "PATH=$PATH:/usr/sbin:/sbin:/usr/local/sbin; export PATH; LC_ALL=C; export LC_ALL";

/** Deja en `$M` el gestor (dnf, yum, apt, zypper, apk o none). */
const DETECT = [
  "M=none",
  ...ORDER.map((m, i) => `${i ? "el" : ""}if command -v ${MANAGERS[m].bin} >/dev/null 2>&1; then M=${m}`),
  "fi",
].join("\n");

/**
 * Actualizaciones pendientes. Secciones: @@mgr · @@root · @@kernel · @@updates · @@rc · @@sec · @@err.
 * Con `refresh` se baja antes la lista nueva (apt update, zypper refresh…; hace falta root).
 */
export function updatesScript(refresh: boolean): string {
  const branch = (m: Real) => {
    const r = MANAGERS[m];
    return [
      `  ${m})`,
      ...(refresh && r.refresh ? [`    ${r.refresh} >/dev/null 2>>"$e"`] : []),
      `    echo @@updates; ${r.updates(refresh)} 2>>"$e"; rc=$?`,
      ...(r.security ? [`    echo @@sec; if [ $rc != 1 ]; then ${r.security} 2>/dev/null; fi`] : []),
      "    ;;",
    ];
  };
  return [
    PRELUDE,
    DETECT,
    "echo @@mgr; echo $M",
    "echo @@root; id -u",
    "echo @@kernel; uname -r",
    "e=$(mktemp 2>/dev/null) || e=/tmp/sshorus-pk-$$",
    "rc=0",
    "case $M in",
    ...ORDER.flatMap(branch),
    "esac",
    "echo @@rc; echo $rc",
    'echo @@err; tail -n 30 "$e" 2>/dev/null; rm -f "$e"',
    "echo @@end",
  ].join("\n");
}

/** Búsqueda (el término ya validado). Secciones: @@found. */
export function searchScript(m: Real, term: string): string {
  return [PRELUDE, "echo @@found", `${MANAGERS[m].search(shQuote(term))} 2>/dev/null | head -n 600`, "echo @@end"].join("\n");
}

/** De esos nombres (validados), cuáles están instalados. Secciones: @@inst. */
export function installedScript(m: Real, names: string[]): string | null {
  const f = MANAGERS[m].installed;
  if (!f || !names.length) return null;
  return [PRELUDE, "echo @@inst", f(names.map(shQuote).join(" ")), "echo @@end"].join("\n");
}

/** Qué se quitaría (sin quitar nada; como root, porque dnf lo exige). Secciones: @@sim. */
export function simulateRemoveScript(m: Real, name: string): string {
  return [PRELUDE, "echo @@sim", `${MANAGERS[m].simulateRemove(shQuote(name))} 2>&1`, "echo @@end"].join("\n");
}
