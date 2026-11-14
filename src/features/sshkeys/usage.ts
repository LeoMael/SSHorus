// Para qué se usa cada llave (GitHub, servidores…), sin leer secretos: ~/.ssh/config, los servidores
// guardados, el nombre del archivo y las llaves de la cuenta de GitHub conectada.
import type { ConfigHost, LocalPrivateKey } from "../../api/localkeys";
import type { ServerProfile } from "../../api/types";
import { keyLabel, samePath } from "./keys";

const GITHUB_HOSTS = ["github.com", "ssh.github.com"];
/** «github» o «gh» como palabra suelta en el nombre (id_gh, gh_trabajo; no «ghost»). */
const GITHUB_NAME = /github|(^|[^a-z])gh([^a-z]|$)/i;
/** Servidores nombrados en «Usada en: …» antes de resumir con «y N más». */
const MAX_NAMES = 3;

export type KeyGroup = "servers" | "github" | "other";

export interface KeyUsage {
  github: boolean;
  /** Servidores de SSHorus y `Host` de ~/.ssh/config (no de GitHub) que la usan. */
  servers: string[];
  group: KeyGroup;
}

export const GROUP_TITLES: Record<KeyGroup, string> = {
  servers: "Para servidores",
  github: "Para GitHub",
  other: "Otras",
};
const GROUP_ORDER: KeyGroup[] = ["servers", "github", "other"];

/** «ssh-ed25519 AAAA… comentario» → «ssh-ed25519 AAAA…» (el comentario no cuenta para comparar). */
export function publicKeyId(line: string): string {
  return line.trim().split(/\s+/).slice(0, 2).join(" ");
}

const isGitHubHost = (h: ConfigHost) => [h.hostname, h.alias].some((n) => GITHUB_HOSTS.includes(n.toLowerCase()));

export function keyUsage(
  k: LocalPrivateKey,
  servers: readonly ServerProfile[],
  githubKeyIds: ReadonlySet<string>,
): KeyUsage {
  const hosts = k.configHosts;
  const github =
    hosts.some(isGitHubHost) ||
    GITHUB_NAME.test(k.name) ||
    (!!k.publicLine && githubKeyIds.has(publicKeyId(k.publicLine)));
  const saved = servers.filter((s) => s.auth === "key" && !!s.keyPath && samePath(s.keyPath, k.path)).map((s) => s.name);
  const fromConfig = hosts.filter((h) => !isGitHubHost(h)).map((h) => h.alias);
  const used = [...new Set([...saved, ...fromConfig])];
  const group: KeyGroup = used.length ? "servers" : github ? "github" : "other";
  return { github, servers: used, group };
}

const TAGS: { label: string; on: (u: KeyUsage) => boolean }[] = [
  { label: "Servidores", on: (u) => u.servers.length > 0 },
  { label: "GitHub", on: (u) => u.github },
];

/** Etiquetas cortas junto al nombre: «Servidores», «GitHub». */
export function usageTags(u: KeyUsage): string[] {
  return TAGS.filter((t) => t.on(u)).map((t) => t.label);
}

/** «GitHub · Usada en: TESIS, web y 2 más» ("" si no se sabe). */
export function usageText(u: KeyUsage): string {
  const parts: string[] = [];
  if (u.github) parts.push("GitHub");
  if (u.servers.length) {
    const shown = u.servers.slice(0, MAX_NAMES).join(", ");
    const rest = u.servers.length - MAX_NAMES;
    parts.push(`Usada en: ${shown}${rest > 0 ? ` y ${rest} más` : ""}`);
  }
  return parts.join(" · ");
}

/** Opción del desplegable: «trabajo (ed25519 · ana@pc) — GitHub · Usada en: TESIS». */
export function keyOptionLabel(k: LocalPrivateKey, u: KeyUsage): string {
  const t = usageText(u);
  return t ? `${keyLabel(k)} — ${t}` : keyLabel(k);
}

export interface KeyGroupItems<T> {
  group: KeyGroup;
  title: string;
  items: T[];
}

/** Grupos no vacíos en orden (servidores, GitHub, otras), conservando el orden de cada lista. */
export function groupByUsage<T extends { usage: KeyUsage }>(items: readonly T[]): KeyGroupItems<T>[] {
  return GROUP_ORDER.map((group) => ({ group, title: GROUP_TITLES[group], items: items.filter((i) => i.usage.group === group) })).filter(
    (g) => g.items.length > 0,
  );
}
