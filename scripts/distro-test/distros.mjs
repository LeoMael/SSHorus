// Distros de la batería (`npm run test:distros`): imagen fija, cómo se prepara (lo mínimo de un servidor
// típico: procps, ss, shadow, sudo, sshd en marcha y un usuario «tester» con contraseña y sudo) y qué se
// espera de cada una. Los contenedores no tienen systemd: lo que dependa de él debe decirlo bien, no romperse.

/** Lo común al final de cada preparación (como root, POSIX sh). `ADMIN` y `SH` los pone cada distro. */
const COMMON = `
id tester >/dev/null 2>&1 || useradd -m -s "$SH" -G "$ADMIN" tester
echo 'tester:test123' | chpasswd
ssh-keygen -A >/dev/null 2>&1
mkdir -p /run/sshd /var/empty
/usr/sbin/sshd
`;

const APT = (extra = "") => `
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends procps iproute2 sudo openssh-server passwd ${extra} >/dev/null
`;

const DNF = `
dnf install -y -q --setopt=install_weak_deps=False procps-ng iproute sudo openssh-server shadow-utils passwd findutils >/dev/null
`;

export const USER = "tester";
export const PASSWORD = "test123";

/**
 * `expect` lo comprueban las áreas de TypeScript (`areas.ts`) y `rust` las del escáner
 * (`vulnscan/tests_distros.rs`): gestor de paquetes, ecosistema de OSV y herramienta de seguridad de la distro.
 */
export const DISTROS = [
  {
    id: "debian",
    image: "docker.io/library/debian:12",
    shell: "/bin/bash",
    setup: `ADMIN=sudo; SH=/bin/bash\n${APT("nginx")}${COMMON}nginx\n`,
    expect: { osId: "debian", family: "debian", adminGroup: "sudo", web: true },
    rust: { pm: "dpkg", ecosystem: "Debian:12", tool: "none" },
  },
  {
    id: "ubuntu",
    image: "docker.io/library/ubuntu:24.04",
    shell: "/bin/bash",
    setup: `ADMIN=sudo; SH=/bin/bash\n${APT()}${COMMON}`,
    expect: { osId: "ubuntu", family: "debian", adminGroup: "sudo", web: false },
    rust: { pm: "dpkg", ecosystem: "Ubuntu:24.04:LTS", tool: "none" },
  },
  {
    id: "alma",
    image: "docker.io/library/almalinux:9",
    shell: "/bin/bash",
    setup: `ADMIN=wheel; SH=/bin/bash\n${DNF}${COMMON}`,
    expect: { osId: "almalinux", family: "rhel", adminGroup: "wheel", web: false },
    rust: { pm: "rpm", ecosystem: "AlmaLinux:9", tool: "dnf4" },
  },
  {
    id: "rocky",
    image: "quay.io/rockylinux/rockylinux:9",
    shell: "/bin/bash",
    setup: `ADMIN=wheel; SH=/bin/bash\n${DNF}${COMMON}`,
    expect: { osId: "rocky", family: "rhel", adminGroup: "wheel", web: false },
    rust: { pm: "rpm", ecosystem: "Rocky Linux:9", tool: "dnf4" },
  },
  {
    id: "fedora",
    image: "registry.fedoraproject.org/fedora:45",
    shell: "/bin/bash",
    setup: `ADMIN=wheel; SH=/bin/bash\n${DNF}${COMMON}`,
    expect: { osId: "fedora", family: "rhel", adminGroup: "wheel", web: false },
    rust: { pm: "rpm", ecosystem: "none", tool: "dnf5" },
  },
  {
    id: "opensuse",
    image: "registry.opensuse.org/opensuse/leap:15.6",
    shell: "/bin/bash",
    // openSUSE trae «Defaults targetpw» (sudo pide la contraseña de root): se hace como un administrador
    // típico, con el grupo wheel y su propia contraseña.
    setup: `ADMIN=wheel; SH=/bin/bash
zypper -n -q install --no-recommends procps iproute2 sudo openssh-server shadow >/dev/null
groupadd -f wheel
printf '%s\\n' 'Defaults:%wheel !targetpw' '%wheel ALL=(ALL:ALL) ALL' > /etc/sudoers.d/wheel
chmod 440 /etc/sudoers.d/wheel
${COMMON}`,
    expect: { osId: "opensuse-leap", family: "suse", adminGroup: "wheel", web: false },
    rust: { pm: "rpm", ecosystem: "openSUSE:Leap 15.6", tool: "zypper" },
  },
  {
    id: "alpine",
    image: "docker.io/library/alpine:3.20",
    // El shell por defecto de Alpine (ash de busybox).
    shell: "/bin/sh",
    setup: `ADMIN=wheel; SH=/bin/sh
apk add -q procps iproute2 sudo shadow openssh-server >/dev/null
printf '%s\\n' '%wheel ALL=(ALL:ALL) ALL' > /etc/sudoers.d/wheel
chmod 440 /etc/sudoers.d/wheel
${COMMON}`,
    expect: { osId: "alpine", family: "alpine", adminGroup: "wheel", web: false },
    rust: { pm: "apk", ecosystem: "Alpine:v3.20", tool: "none" },
  },
];
