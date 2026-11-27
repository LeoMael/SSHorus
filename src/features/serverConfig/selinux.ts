// SELinux: modo (sestatus / getenforce / /etc/selinux/config), booleans útiles para la web y los
// contenedores, y los cambios de modo. Funciones puras.
import { change, type ConfigChange } from "./model";

export type SeMode = "enforcing" | "permissive" | "disabled";

export interface SelinuxState {
  /** El sistema tiene SELinux (aunque esté desactivado). */
  present: boolean;
  /** Modo ahora (null = no se supo). */
  mode: SeMode | null;
  /** Modo al arrancar (/etc/selinux/config). */
  configMode: SeMode | null;
  policy: string | null;
  tools: Set<string>;
}

function asMode(s: string | undefined): SeMode | null {
  const v = (s ?? "").trim().toLowerCase();
  return v === "enforcing" || v === "permissive" || v === "disabled" ? v : null;
}

export function parseSelinux(ls: string[]): SelinuxState {
  const st: SelinuxState = { present: false, mode: null, configMode: null, policy: null, tools: new Set() };
  for (const l of ls) {
    const kv = /^([^:]+):\s*(.*)$/.exec(l);
    if (l.startsWith("tool ")) st.tools.add(l.slice(5).trim());
    else if (l.startsWith("cfg ")) {
      const m = /^cfg\s+SELINUX(TYPE)?=\s*"?([^"\s]*)/.exec(l);
      if (!m) continue;
      st.present = true;
      if (m[1]) st.policy ??= m[2];
      else st.configMode = asMode(m[2]);
    } else if (l.startsWith("enforce ")) {
      st.present = true;
      st.mode = l.slice(8).trim() === "1" ? "enforcing" : "permissive";
    } else if (kv) {
      const k = kv[1].trim().toLowerCase();
      const v = kv[2].trim();
      if (k === "selinux status") {
        st.present = true;
        if (v.toLowerCase() === "disabled") st.mode = "disabled";
      } else if (k === "current mode") {
        st.present = true;
        st.mode = asMode(v);
      } else if (k === "mode from config file") st.configMode = asMode(v) ?? st.configMode;
      else if (k === "loaded policy name") st.policy = v;
    }
  }
  // getenforce dice «Disabled» también donde no hay SELinux: solo cuenta si hay algo más.
  if (st.mode === "disabled" && st.configMode === null && !st.policy && st.tools.size === 0) st.present = false;
  return st;
}

export const MODE_TEXT: Record<SeMode, string> = { enforcing: "Enforcing (bloquea)", permissive: "Permissive (solo avisa)", disabled: "Desactivado" };

// ───────── Booleans ─────────

export interface SeBoolean {
  name: string;
  /** Qué permite cuando está activado. */
  what: string;
}

/** Los que suelen hacer falta con nginx, Caddy, Apache y contenedores. */
export const SE_BOOLEANS: SeBoolean[] = [
  { name: "httpd_can_network_connect", what: "nginx, Caddy o Apache pueden conectarse a otros puertos (proxy inverso hacia una app o un contenedor)" },
  { name: "httpd_can_network_relay", what: "La web puede reenviar peticiones a otros servidores (proxy o caché)" },
  { name: "httpd_can_network_connect_db", what: "La web puede conectarse a bases de datos por red (PostgreSQL, MySQL…)" },
  { name: "httpd_read_user_content", what: "La web puede leer archivos de las carpetas de los usuarios" },
  { name: "httpd_enable_homedirs", what: "Sitios dentro de la carpeta de cada usuario (~/public_html)" },
  { name: "container_manage_cgroup", what: "Los contenedores pueden gestionar cgroups (systemd dentro de un contenedor)" },
  { name: "container_use_devices", what: "Los contenedores pueden usar dispositivos del servidor (GPU, USB…)" },
  { name: "container_connect_any", what: "Los contenedores pueden conectarse a cualquier puerto del servidor" },
];

/** «nombre --> on» → nombre: activado. Solo los de la tabla. */
export function parseBooleans(ls: string[]): Map<string, boolean> {
  const known = new Set(SE_BOOLEANS.map((b) => b.name));
  const out = new Map<string, boolean>();
  for (const l of ls) {
    const m = /^([a-z0-9_]+)\s+-->\s+(on|off)\b/.exec(l.trim());
    if (m && known.has(m[1])) out.set(m[1], m[2] === "on");
  }
  return out;
}

/** setsebool -P (persistente). `name` sale siempre de la tabla: no hace falta citarlo. */
export function booleanChange(name: string, on: boolean): ConfigChange {
  const b = SE_BOOLEANS.find((x) => x.name === name);
  return change({
    id: `sebool:${name}:${on ? 1 : 0}`,
    label: on ? "Activar" : "Desactivar",
    title: `SELinux: ${on ? "activar" : "desactivar"} ${name}`,
    explain: on ? (b?.what ?? name) : `Deja de permitir: ${(b?.what ?? name).toLowerCase()}`,
    steps: [`setsebool -P ${name} ${on ? 1 : 0}`],
    note: on ? "Solo actívalo si de verdad lo necesitas: da más permisos a esos servicios" : null,
    timeoutSecs: 300,
  });
}

// ───────── Modo ─────────

const SET_CONFIG = (m: SeMode) => `sed -i -E 's/^[[:space:]]*SELINUX=.*/SELINUX=${m}/' /etc/selinux/config`;

/** Cambios de modo que tienen sentido ahora (nunca desactivar del todo: obliga a reetiquetar al volver). */
export function modeChanges(st: SelinuxState, recentDenials: number): ConfigChange[] {
  const out: ConfigChange[] = [];
  if (st.mode === "permissive") {
    out.push(
      change({
        id: "selinux.enforce",
        label: "Pasar a Enforcing",
        title: "SELinux: pasar a Enforcing",
        explain: "SELinux pasa a bloquear lo que no está permitido, ahora y en cada arranque.",
        steps: ["setenforce 1", SET_CONFIG("enforcing")],
        danger: true,
        note:
          recentDenials > 0
            ? `Hay ${recentDenials} denegaciones recientes: lo que ahora solo avisa dejará de funcionar. Arréglalas antes.`
            : "Lo que ahora solo se avisa empezará a bloquearse",
      }),
    );
  }
  if (st.mode === "enforcing") {
    out.push(
      change({
        id: "selinux.permissive",
        label: "Permissive hasta reiniciar",
        title: "SELinux: pasar a Permissive (hasta reiniciar)",
        explain: "Para diagnosticar: SELinux deja de bloquear y solo avisa. Al reiniciar vuelve a Enforcing.",
        steps: ["setenforce 0"],
        danger: true,
        note: "Baja la protección del servidor: vuelve a Enforcing en cuanto termines",
      }),
    );
  }
  if (st.mode && st.mode !== "disabled" && st.configMode && st.configMode !== st.mode) {
    out.push(
      change({
        id: "selinux.persist",
        label: `Dejar ${st.mode === "enforcing" ? "Enforcing" : "Permissive"} al arrancar`,
        title: "SELinux: guardar el modo actual",
        explain: `Al arrancar se pone en ${st.configMode}; así quedará en ${st.mode} también tras reiniciar.`,
        steps: [SET_CONFIG(st.mode)],
      }),
    );
  }
  return out;
}

/** Activar SELinux desactivado no se hace desde aquí: reetiqueta todo el disco al reiniciar. */
export const ENABLE_SELINUX_ADVICE =
  "Para activarlo: pon SELINUX=permissive en /etc/selinux/config, crea /.autorelabel y reinicia (tarda un rato); revisa las denegaciones y luego pasa a Enforcing.";
