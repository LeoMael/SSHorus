// Formulario «Nuevo contenedor» desde `inspect`, script de reemplazo seguro y mensajes tras reanalizar.
import type { Engine } from "../../api/vulnscan";
import { emptyRunForm, runCmd, type RestartPolicy, type RunForm } from "../containers/commands";
import { engineCmd, q, renderCmd } from "../containers/shell";
import type { ContainerDetail, ImageConfig } from "./imageUpdateRead";

const DEFAULT_NETS = new Set(["", "default", "bridge", "podman", "slirp4netns", "pasta", "private"]);
const AUTO_ENV = new Set(["HOSTNAME", "container"]);
const IGNORED_LABEL = /^(io\.(podman|containers|buildah|k8s)|org\.opencontainers|com\.docker\.compose|PODMAN_SYSTEMD_UNIT|maintainer$|description$|summary$|vendor$|version$|release$|name$|architecture$|build-date$|vcs-|url$|license$|distribution-scope$|com\.redhat|io\.openshift)/;

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function restartOf(name: string): RestartPolicy {
  return name === "always" || name === "unless-stopped" || name === "on-failure" ? name : "no";
}

/** Rellena el formulario con lo que tenía el contenedor y avisa de lo que no se copia. */
export function runFormFrom(c: ContainerDetail, image: ImageConfig | null, ref: string, engine: Engine): { form: RunForm; warnings: string[] } {
  const warnings: string[] = [];
  const form = emptyRunForm();
  form.image = ref;
  form.name = c.name;

  for (const p of c.ports) {
    const [port, proto] = p.container.split("/");
    const ip = p.hostIp;
    const localOnly = ip === "127.0.0.1" || ip === "::1";
    if (ip && !localOnly && ip !== "0.0.0.0" && ip !== "::") warnings.push(`El puerto ${p.hostPort || port} solo escuchaba en ${ip}: ahora escuchará en todas las direcciones`);
    form.ports.push({ host: p.hostPort, container: port, protocol: proto === "udp" ? "udp" : "tcp", localOnly });
  }
  const seenPort = new Set<string>();
  form.ports = form.ports.filter((p) => {
    const k = `${p.host}|${p.container}|${p.protocol}|${p.localOnly}`;
    if (seenPort.has(k)) return false;
    seenPort.add(k);
    return true;
  });

  for (const m of c.mounts) {
    if (m.type === "bind") form.volumes.push({ source: m.source, target: m.destination, readOnly: !m.rw });
    else if (m.type === "volume" && m.name) form.volumes.push({ source: m.name, target: m.destination, readOnly: !m.rw });
    else warnings.push(`El montaje «${m.destination}» (${m.type || "desconocido"}) no se copia`);
  }
  if (engine === "podman" && c.binds.some((b) => /[:,][zZ](,|$)/.test(b))) form.selinuxLabel = true;
  if (c.binds.some((b) => /[:,]z(,|$)/.test(b))) warnings.push("Alguna carpeta usaba «:z» (compartida): se pondrá «:Z» (solo para este contenedor)");

  const imgEnv = new Set(image?.env ?? []);
  const imgKeys = new Set((image?.env ?? []).map((e) => e.split("=")[0]));
  for (const e of c.env) {
    if (imgEnv.has(e)) continue;
    const i = e.indexOf("=");
    const key = i < 0 ? e : e.slice(0, i);
    const value = i < 0 ? "" : e.slice(i + 1);
    if (AUTO_ENV.has(key)) continue;
    if (!imgKeys.has(key) && ((key === "HOME" && value === "/root") || (key === "TERM" && value === "xterm"))) continue;
    form.env.push({ key, value });
  }

  form.restart = restartOf(c.restart);
  if (c.restart === "on-failure" && c.restartRetries > 0) warnings.push(`Reinicio «solo si falla» tenía un máximo de ${c.restartRetries} intentos: ahora sin máximo`);

  const mode = c.networkMode;
  if (mode.startsWith("container:") || mode.startsWith("ns:") || mode.startsWith("service:")) {
    warnings.push(`Usaba la red de otro contenedor («${mode}»): no se copia`);
  } else if (mode === "host" || mode === "none") {
    form.network = mode;
  } else if (!DEFAULT_NETS.has(mode)) {
    form.network = mode;
  } else {
    const custom = c.networks.filter((n) => !DEFAULT_NETS.has(n));
    if (custom.length) form.network = custom[0];
  }
  const extraNets = c.networks.filter((n) => !DEFAULT_NETS.has(n) && n !== form.network);
  if (extraNets.length) warnings.push(`También estaba en ${extraNets.join(", ")}: solo se copia una red`);

  if (image && !sameList(c.cmd, image.cmd)) form.command = c.cmd.map(q).join(" ");
  if (image && !sameList(c.entrypoint, image.entrypoint)) warnings.push("Usaba otro punto de entrada (--entrypoint): no se copia");
  if (!image && c.cmd.length) warnings.push("No se pudo leer la imagen: el comando se deja el de la imagen");
  if (image && c.user && c.user !== image.user) warnings.push(`Se ejecutaba como «${c.user}» (--user): no se copia`);
  if (image && c.workdir && c.workdir !== image.workdir) warnings.push(`Carpeta de trabajo «${c.workdir}» (--workdir): no se copia`);
  if (c.privileged) warnings.push("Era privilegiado (--privileged): no se copia");
  if (c.capAdd.length) warnings.push(`Permisos extra (--cap-add ${c.capAdd.join(", ")}): no se copian`);
  if (c.devices) warnings.push("Tenía dispositivos (--device): no se copian");
  if (c.memory || c.cpus) warnings.push("Tenía límites de memoria o CPU: no se copian");
  if (c.extraHosts.length || c.dns.length) warnings.push("Tenía hosts o DNS propios (--add-host, --dns): no se copian");
  const labels = Object.keys(c.labels).filter((k) => !IGNORED_LABEL.test(k) && !(image && k in image.labels));
  if (labels.length) warnings.push(`Etiquetas propias (${labels.slice(0, 4).join(", ")}${labels.length > 4 ? "…" : ""}): no se copian`);
  if (c.autoRemove) warnings.push("Se creó con --rm: al pararlo se borra, así que si el nuevo falla no se podrá volver al viejo");
  return { form, warnings };
}

/** Nombre temporal del contenedor viejo mientras se prueba el nuevo. */
export function oldNameOf(name: string): string {
  return `${name}-viejo`;
}

/**
 * Reemplaza un contenedor por otro creado con `form` (mismo nombre):
 * renombra el viejo a <nombre>-viejo y lo para; crea el nuevo; si arranca bien (y sigue en marcha a los
 * 5 s sin reiniciarse, si el viejo estaba en marcha) borra el viejo; si no, borra el nuevo, devuelve el nombre al viejo y
 * lo arranca. Sale con 0 solo si quedó el nuevo.
 */
export function replaceScript(engine: Engine, name: string, wasRunning: boolean, form: RunForm): string {
  const old = oldNameOf(name);
  const e = (...a: string[]) => renderCmd(engineCmd(engine, ...a));
  const run = renderCmd(runCmd(engine, { ...form, name }));
  const lines = [
    `if ${e("inspect", "--type", "container", old)} >/dev/null 2>&1; then`,
    `  echo ${q(`Ya existe un contenedor «${old}»: bórralo o cámbiale el nombre y vuelve a intentarlo`)} >&2`,
    "  exit 1",
    "fi",
    `${e("rename", name, old)} || exit 1`,
    `if ! ${e("stop", old)} >/dev/null; then`,
    `  ${e("rename", old, name)}`,
    `  echo ${q("No se pudo parar el contenedor viejo: no se cambió nada")} >&2`,
    "  exit 1",
    "fi",
    "ok=0",
    `if ${run}; then`,
    "  ok=1",
  ];
  if (wasRunning) {
    lines.push(
      "  sleep 5",
      `  if [ "$(${e("inspect", "--format", "{{.State.Running}} {{.RestartCount}}", name)} 2>/dev/null)" != "true 0" ]; then`,
      "    ok=0",
      `    echo ${q("El contenedor nuevo se paró al arrancar. Sus últimos mensajes:")} >&2`,
      `    ${e("logs", "--tail", "30", name)} >&2 2>&1`,
      "  fi",
    );
  }
  lines.push(
    "fi",
    'if [ "$ok" = 1 ]; then',
    `  ${e("rm", old)} >/dev/null || echo ${q(`No se pudo borrar «${old}»: bórralo a mano`)} >&2`,
    `  echo ${q(`Listo: «${name}» ya usa la imagen nueva.`)}`,
    "  exit 0",
    "fi",
    `echo ${q("No salió bien: se vuelve al contenedor viejo.")} >&2`,
    `${e("rm", "-f", name)} >/dev/null 2>&1`,
    `${e("rename", old, name)}`,
  );
  if (wasRunning) lines.push(`${e("start", name)} >/dev/null`);
  lines.push("exit 1");
  return lines.join("\n");
}

/** Clave del informe para la imagen nueva (como la pone el motor). */
export function imageKey(engine: Engine, user: string | null, id: string): string {
  return `image:${engine}:${user ?? ""}:${id.replace(/^sha256:/, "").slice(0, 12)}`;
}

/** Mensaje tras volver a analizar. `n` = vulnerabilidades (sin las «sin importancia») de la imagen nueva. */
export function rescanMessage(n: number): string {
  if (n === 0) return "La imagen nueva no tiene vulnerabilidades conocidas.";
  return `La imagen nueva todavía tiene ${n} ${n === 1 ? "vulnerabilidad" : "vulnerabilidades"}: el autor aún no la ha actualizado o la etiqueta es vieja (prueba una más nueva).`;
}
