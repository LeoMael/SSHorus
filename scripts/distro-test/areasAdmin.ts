// Áreas de la batería por distro para Administración → Servicios, Paquetes y Tareas programadas: los
// mismos scripts y parseadores que la app. Los contenedores no arrancan con systemd ni OpenRC: Servicios
// debe decir «no aplica» y los timers no salir; cron se prueba de verdad donde hay `crontab` (escribir
// una línea para el usuario de prueba, comprobarla y quitarla, sin tocar el resto).
import { innerScript } from "../../src/features/admin/commands";
import { searchScript, simulateRemoveScript, updatesScript, installedScript } from "../../src/features/packages/managers";
import { parseUpdatesOutput } from "../../src/features/packages/parse";
import { markInstalled, parseRemoval, parseSearch, removalBlocked, removalWarning } from "../../src/features/packages/search";
import { cronChange } from "../../src/features/schedule/crontab";
import { parseSchedule, SCHEDULE_SCRIPT } from "../../src/features/schedule/read";
import { parseServices } from "../../src/features/services/parse";
import { SERVICES_SCRIPT } from "../../src/features/services/script";
import { splitSections } from "../../src/lib/remote";
import { finished, must, script, sudo, type Area, type Expect } from "./kit";

const MANAGER: Record<string, string> = { rhel: "dnf", debian: "apt", suse: "zypper", alpine: "apk" };
const LINE = "17 4 * * * /bin/true sshorus-distro-test";

/** Añadir y luego quitar una línea del crontab del usuario de prueba (que empieza sin crontab). */
function cronRuns(e: Expect) {
  const add = cronChange(e.user, [], { kind: "add", line: LINE }, "añadir", "");
  const remove = cronChange(e.user, [LINE], { kind: "remove", index: 0 }, "quitar", "");
  const plan = (steps: string[]) => script(innerScript({ action: "", steps }), sudo(e), 30);
  // Leer, añadir, leer, añadir otra vez con lo leído al principio (debe negarse), quitar y leer.
  return [script(SCHEDULE_SCRIPT, sudo(e), 40), plan(add.steps), script(SCHEDULE_SCRIPT, sudo(e), 40), plan(add.steps), plan(remove.steps), script(SCHEDULE_SCRIPT, sudo(e), 40)];
}

export const ADMIN_AREAS: Area[] = [
  {
    id: "services",
    label: "Servicios",
    runs: (e) => [script(SERVICES_SCRIPT, sudo(e), 40)],
    check: ([r], e) => {
      const s = parseServices(finished(r, "servicios (sudo)"));
      must(s.me === "root", `con sudo, el script corre como «${s.me}»`);
      must(s.humans.some((h) => h.name === e.user), `no sale ${e.user} entre los usuarios (${s.humans.map((h) => h.name).join(", ")})`);
      must(s.init === "none" ? s.services.length === 0 : s.services.length > 0, `init «${s.init}» con ${s.services.length} servicios`);
      return { ok: true, detail: s.init === "none" ? "no aplica (el contenedor no arrancó con systemd ni OpenRC)" : `${s.init}: ${s.services.length} servicios` };
    },
  },
  {
    id: "packages",
    label: "Paquetes",
    runs: (e) => {
      const m = MANAGER[e.family] as "dnf" | "apt" | "zypper" | "apk";
      return [
        script(updatesScript(false), sudo(e), 300),
        script(searchScript(m, "curl"), sudo(e), 120),
        script(installedScript(m, ["sudo", "curl"]) ?? "echo @@inst; echo @@end", sudo(e), 30),
        script(simulateRemoveScript(m, "sudo"), sudo(e), 120),
      ];
    },
    check: ([up, se, inst, sim], e) => {
      const m = MANAGER[e.family] as "dnf" | "apt" | "zypper" | "apk";
      const r = parseUpdatesOutput(finished(up, "actualizaciones (sudo)"));
      must(r.manager === m, `gestor «${r.manager}», se esperaba «${m}»`);
      must(!r.error, `el gestor falló: ${r.error}`);
      must(r.root, "con sudo no corrió como root");
      const found = parseSearch(m, splitSections(finished(se, "buscar")).get("found") ?? []);
      must(found.some((f) => f.name === "curl" || f.name.startsWith("curl") || f.name.startsWith("libcurl")), `buscar «curl» no encontró nada (${found.length} resultados)`);
      const marked = markInstalled([{ name: "sudo", summary: "", installed: m === "zypper" ? true : null }], splitSections(finished(inst, "instalados")).get("inst") ?? []);
      must(marked[0].installed, "sudo no sale como instalado");
      const simLines = splitSections(finished(sim, "simular quitar")).get("sim") ?? [];
      const removed = parseRemoval(m, simLines);
      const blocked = removalBlocked(simLines);
      // dnf protege sudo (protected_packages): ni lo simula. El resto dice qué se quitaría y se avisa.
      must(blocked || removed.includes("sudo"), `quitar sudo (simulado) no dice que se quita (${removed.join(", ") || "nada"}): ${simLines.slice(0, 4).join(" | ")}`);
      must(blocked || removalWarning(removed, r.kernel), "quitar sudo no avisa");
      return {
        ok: true,
        detail: `${m}: ${r.updates.length} actualizaciones${r.securityCount !== null ? ` (${r.securityCount} de seguridad)` : ""}; buscar curl: ${found.length}; ${blocked ? "quitar sudo: protegido" : `quitar sudo se llevaría ${removed.length}`}`,
      };
    },
  },
  {
    id: "schedule",
    label: "Tareas",
    runs: cronRuns,
    check: (rs, e) => {
      const first = parseSchedule(finished(rs[0], "tareas (sudo)"));
      must(first.root, "con sudo no corrió como root");
      must(first.timers === null, "sin systemd no debería haber timers");
      if (!first.hasCrontab) return { ok: true, detail: "no aplica: sin crontab" };
      const roots = first.crontabs.find((t) => t.user === "root");
      must(!first.crontabs.find((t) => t.user === e.user)?.lines, `${e.user} ya tenía crontab`);
      must(rs[1].exitCode === 0, `añadir la línea falló: ${rs[1].stderr.trim()}`);
      const mid = parseSchedule(finished(rs[2], "tareas tras añadir")).crontabs.find((t) => t.user === e.user);
      must(mid?.jobs.length === 1 && mid.jobs[0].text === "Cada día a las 4:17", `tras añadir: ${JSON.stringify(mid)}`);
      must(rs[3].exitCode !== 0 && /cambió desde que se leyó/.test(rs[3].stderr), `escribir con lo leído viejo no se paró: ${rs[3].stderr.trim()}`);
      must(rs[4].exitCode === 0, `quitar la línea falló: ${rs[4].stderr.trim()}`);
      const last = parseSchedule(finished(rs[5], "tareas tras quitar")).crontabs.find((t) => t.user === e.user);
      must(!last?.jobs.length, `tras quitar quedan tareas: ${JSON.stringify(last)}`);
      return { ok: true, detail: `crontab: añadir, leer, quitar y negarse a pisar un cambio; root con ${roots?.jobs.length ?? 0} tareas; ${first.dirs.length} carpetas periódicas` };
    },
  },
];
