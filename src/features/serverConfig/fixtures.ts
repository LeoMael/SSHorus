// Salidas reales (recortadas) para las pruebas del panel «Configuración». Las de SELinux salen de un
// Fedora 45 (sestatus, getsebool, journalctl -o short-unix) y de ausearch en Rocky 9; las de AppArmor y
// fail2ban, de Debian 12 y Ubuntu 24.04.

export const SESTATUS_ENFORCING = [
  "SELinux status:                 enabled",
  "SELinuxfs mount:                /sys/fs/selinux",
  "SELinux root directory:         /etc/selinux",
  "Loaded policy name:             targeted",
  "Current mode:                   enforcing",
  "Mode from config file:          enforcing",
  "Policy MLS status:              enabled",
  "Policy deny_unknown status:     allowed",
  "Memory protection checking:     actual (secure)",
  "Max kernel policy version:      35",
  "cfg SELINUX=enforcing",
  "cfg SELINUXTYPE=targeted",
  "tool semanage",
  "tool restorecon",
  "tool setsebool",
  "tool ausearch",
];

export const SEBOOL = ["httpd_can_network_connect --> off", "httpd_read_user_content --> off", "container_manage_cgroup --> off", "httpd_can_network_relay --> on"];

/** ausearch -m AVC,USER_AVC -ts yesterday (Rocky 9 con nginx de proxy y un contenedor sin :Z). */
export const AUSEARCH = [
  "@src ausearch",
  'type=AVC msg=audit(1795530540.838:812): avc:  denied  { name_connect } for  pid=1201 comm="nginx" dest=8080 scontext=system_u:system_r:httpd_t:s0 tcontext=system_u:object_r:http_cache_port_t:s0 tclass=tcp_socket permissive=0',
  'type=AVC msg=audit(1795530600.120:813): avc:  denied  { name_connect } for  pid=1201 comm="nginx" dest=8080 scontext=system_u:system_r:httpd_t:s0 tcontext=system_u:object_r:http_cache_port_t:s0 tclass=tcp_socket permissive=0',
  'type=AVC msg=audit(1795530700.000:820): avc:  denied  { read } for  pid=45892 comm="php" name="autoload.php" dev="nvme1n1p3" ino=24641374 scontext=system_u:system_r:container_t:s0:c250,c421 tcontext=unconfined_u:object_r:user_home_t:s0 tclass=file permissive=0',
  'type=AVC msg=audit(1795530800.000:830): avc:  denied  { getattr } for  pid=1202 comm="caddy" path="/srv/sitio/index.html" dev="vda1" ino=55 scontext=system_u:system_r:httpd_t:s0 tcontext=unconfined_u:object_r:default_t:s0 tclass=file permissive=0',
  'type=AVC msg=audit(1795530900.000:840): avc:  denied  { name_bind } for  pid=1203 comm="nginx" src=8443 scontext=system_u:system_r:httpd_t:s0 tcontext=system_u:object_r:unreserved_port_t:s0 tclass=tcp_socket permissive=0',
  'type=AVC msg=audit(1795531000.000:850): avc:  denied  { read } for  pid=1204 comm="nginx" path="/etc/shadow" dev="vda1" ino=9 scontext=system_u:system_r:httpd_t:s0 tcontext=system_u:object_r:shadow_t:s0 tclass=file permissive=0',
];

/** journalctl -o short-unix (Fedora 45, sin sudo y en wheel). */
export const JOURNAL_AVC = [
  "@src journal",
  '1795530473.829000 fedora audit[42173]: AVC avc:  denied  { nnp_transition } for  pid=42173 comm="bash" scontext=unconfined_u:unconfined_r:unconfined_t:s0-s0:c0.c1023 tcontext=unconfined_u:unconfined_r:container_runtime_t:s0-s0:c0.c1023 tclass=process2 permissive=0',
];

export const AA_PROFILES = ["enabled Y", "p /usr/sbin/nginx (enforce)", "p docker-default (enforce)", "p /usr/bin/man (enforce)", "p /usr/sbin/cupsd (complain)", "p firefox (unconfined)"];

export const AA_DENIED = [
  '1795530473.829000 deb kernel: audit: type=1400 audit(1795530473.829:45): apparmor="DENIED" operation="open" class="file" profile="/usr/sbin/nginx" name="/srv/www/index.html" pid=900 comm="nginx" requested_mask="r" denied_mask="r" fsuid=33 ouid=0',
  '1795530483.829000 deb kernel: audit: type=1400 audit(1795530483.829:46): apparmor="DENIED" operation="open" class="file" profile="/usr/sbin/nginx" name="/srv/www/index.html" pid=900 comm="nginx" requested_mask="r" denied_mask="r" fsuid=33 ouid=0',
];

export const F2B = [
  "Status",
  "|- Number of jail:\t2",
  "`- Jail list:\tnginx-http-auth, sshd",
  "@jail nginx-http-auth",
  "Status for the jail: nginx-http-auth",
  "|- Filter",
  "|  |- Currently failed:\t0",
  "|  |- Total failed:\t0",
  "|  `- File list:\t/var/log/nginx/error.log",
  "`- Actions",
  "   |- Currently banned:\t0",
  "   |- Total banned:\t0",
  "   `- Banned IP list:\t",
  "@jail sshd",
  "Status for the jail: sshd",
  "|- Filter",
  "|  |- Currently failed:\t3",
  "|  |- Total failed:\t412",
  "|  `- Journal matches:\t_SYSTEMD_UNIT=sshd.service + _COMM=sshd",
  "`- Actions",
  "   |- Currently banned:\t2",
  "   |- Total banned:\t57",
  "   `- Banned IP list:\t203.0.113.7 198.51.100.23",
];

export const AUTOUPD_ROCKY = [
  "pm dnf",
  "systemd yes",
  "podman yes",
  "pkg dnf-automatic 4.14.0",
  "conf upgrade_type = security",
  "conf download_updates = yes",
  "conf apply_updates = yes",
  "timer dnf-automatic.timer enabled active",
];

export const AUTOUPD_DEBIAN_OFF = ["pm apt-get", "systemd yes", "timer apt-daily-upgrade.timer enabled active"];

export const SYSCTL_ROCKY = [
  "net.ipv4.ip_forward=1",
  "net.ipv4.tcp_syncookies=1",
  "net.ipv4.conf.all.rp_filter=1",
  "net.ipv4.conf.all.accept_redirects=1",
  "net.ipv4.conf.default.accept_redirects=1",
  "net.ipv6.conf.all.accept_redirects=1",
  "net.ipv4.conf.all.send_redirects=1",
  "net.ipv4.conf.all.accept_source_route=0",
  "net.ipv4.icmp_echo_ignore_broadcasts=1",
  "net.ipv4.conf.all.log_martians=0",
  "kernel.dmesg_restrict=0",
  "kernel.kptr_restrict=0",
];

/** Salida completa de CONFIG_SCRIPT con sudo en un Rocky 9 (secciones de la Auditoría + propias). */
export function rockyOutput(): string {
  return [
    "@@id",
    "0 root",
    "root",
    "@@os",
    "rocky|rhel centos fedora|Rocky Linux 9.4 (Blue Onyx)",
    "@@sshd",
    "port 2222",
    "permitrootlogin yes",
    "pubkeyauthentication yes",
    "passwordauthentication yes",
    "kbdinteractiveauthentication no",
    "permitemptypasswords no",
    "@@sshdsrc",
    "T",
    "@@sshdcfg",
    "@@sshinc",
    "1",
    "@@passwd",
    "root:0:/root:/bin/bash",
    "leo:1000:/home/leo:/bin/bash",
    "@@keys",
    "leo|1|600|/home/leo/.ssh/authorized_keys",
    "@@sudoers",
    "%wheel\tALL=(ALL)\tALL",
    "deploy ALL=(ALL) NOPASSWD: ALL",
    "@@groups",
    "wheel:x:10:leo",
    "@@fw",
    "firewalld running",
    "@@auth",
    "journal 412",
    "f2b active",
    "@@proc",
    "proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0",
    "@@selinux",
    ...SESTATUS_ENFORCING,
    "@@sebool",
    ...SEBOOL,
    "@@avc",
    ...AUSEARCH,
    "@@apparmor",
    "@@aadeny",
    "@@autoupd",
    ...AUTOUPD_ROCKY,
    "@@fban",
    ...F2B,
    "@@sysctl",
    ...SYSCTL_ROCKY,
    "@@sysfile",
    "/etc/sysctl.d/99-podman.conf:net.ipv4.ip_forward = 1",
    "@@fstab",
    "@@end",
    "",
  ].join("\n");
}
