// Cambios en sshd para usuarios creados por SSHorus: recarga y bloque «solo con llave» (Match User).
// Funciones puras: devuelven pasos de shell ya citados. Ningún paso lee stdin (</dev/null): el stdin del
// plan queda para chpasswd.
import { shQuote } from "./shell";

const q = shQuote;

export const SSHD_CONFIG_D = "/etc/ssh/sshd_config.d";

/** Recarga sshd (systemd: «sshd» o «ssh» en Debian/Ubuntu; OpenRC en Alpine). Las sesiones abiertas siguen. */
export const RELOAD_SSHD_STEP = [
  "if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then systemctl reload sshd </dev/null 2>/dev/null || systemctl reload ssh </dev/null;",
  "elif command -v rc-service >/dev/null 2>&1; then rc-service sshd reload </dev/null;",
  `else echo ${q("No se pudo recargar sshd (ni systemd ni OpenRC): recárgalo a mano")} >&2; exit 1; fi`,
].join("\n");

/**
 * Archivo con el bloque Match. Empieza por «10-» porque en sshd gana el primer Match que coincide: así va
 * antes que otros Match (p. ej. «Match Address … PasswordAuthentication yes») de sshd_config.d y del final
 * de sshd_config.
 */
export function keyOnlyFile(user: string): string {
  return `${SSHD_CONFIG_D}/10-sshorus-solo-llave-${user}.conf`;
}

/**
 * `user` solo puede entrar por SSH con su llave aunque tenga contraseña (que entonces solo sirve para sudo):
 * «Match User … AuthenticationMethods publickey» en un archivo aparte. Se comprueba con `sshd -t`, que sshd
 * lo aplique a ese usuario (`sshd -T -C`) y que no cambie nada para otro usuario (root); si algo falla, se
 * deshace y se para el plan. Sin sshd_config.d solo se sigue si sshd ya no deja entrar con contraseña.
 * Va antes de crear el usuario: si no se puede garantizar, no se crea ni se le pone contraseña.
 */
export function keyOnlySshdSteps(user: string): string[] {
  const file = q(keyOnlyFile(user));
  const lines = [
    `# Añadido por SSHorus: ${user} entra solo con su llave SSH (su contraseña es solo para sudo)`,
    `Match User ${user}`,
    "    PasswordAuthentication no",
    "    AuthenticationMethods publickey",
  ];
  return [
    `# SSH solo con llave para ${user}: se le pone contraseña para sudo, pero no podrá entrar con ella`,
    "PATH=$PATH:/usr/sbin:/sbin",
    `eff() { sshd -T -C "user=$1,host=localhost,addr=127.0.0.1" </dev/null 2>/dev/null; }`,
    `undo() { rm -f ${file}; echo "$1" >&2; exit 1; }`,
    `if [ -d ${q(SSHD_CONFIG_D)} ]; then`,
    `  antes=$(eff root) || antes=`,
    `  printf '%s\\n' ${lines.map(q).join(" ")} > ${file}`,
    `  chmod 600 ${file}`,
    `  sshd -t </dev/null || undo ${q("sshd -t falló: se deshizo el cambio y no se creó el usuario")}`,
    `  eff ${q(user)} | grep -qix 'authenticationmethods publickey' || undo ${q(
      "sshd no aplicó «solo llave» (¿falta «Include /etc/ssh/sshd_config.d/*.conf»?): se deshizo y no se creó el usuario",
    )}`,
    `  [ "$(eff root)" = "$antes" ] || undo ${q("El cambio de sshd afectaba a otros usuarios: se deshizo y no se creó el usuario")}`,
    ...RELOAD_SSHD_STEP.split("\n").map((l) => `  ${l}`),
    `elif eff ${q(user)} | grep -qix 'passwordauthentication no' && ! eff ${q(
      user,
    )} | grep -Eqix '(kbdinteractiveauthentication|challengeresponseauthentication) yes'; then`,
    `  echo ${q(`sshd ya no deja entrar con contraseña: ${user} solo podrá usar su llave`)}`,
    "else",
    `  echo ${q(
      "Sin /etc/ssh/sshd_config.d no se puede garantizar que entre solo con llave: no se creó el usuario (desmarca «Dar sudo» o desactiva PasswordAuthentication)",
    )} >&2`,
    "  exit 1",
    "fi",
  ];
}
