// Salidas reales (recortadas) de los cortafuegos para las pruebas: Rocky con firewalld, Ubuntu con ufw,
// Debian con nftables (y Docker/Podman) y un servidor viejo con iptables-save.

/** Junta secciones «@@nombre» como las imprime FIREWALL_SCRIPT. */
export function scriptOutput(sections: Record<string, string>): string {
  return [...Object.entries(sections).map(([k, v]) => `@@${k}\n${v}`), "@@end"].join("\n");
}

export const FIREWALLD_ZONES = `block
  target: %%REJECT%%
  icmp-block-inversion: no
  interfaces:
  sources:
  services:
  ports:
  protocols:
  forward: yes
  masquerade: no
  forward-ports:
  source-ports:
  icmp-blocks:
  rich rules:

docker (active)
  target: ACCEPT
  icmp-block-inversion: no
  interfaces: docker0
  sources:
  services:
  ports:
  protocols:
  forward: yes
  masquerade: no
  forward-ports:
  source-ports:
  icmp-blocks:
  rich rules:

public (default, active)
  target: default
  icmp-block-inversion: no
  interfaces: eth0
  sources:
  services: cockpit dhcpv6-client ssh
  ports: 8080/tcp 9000-9010/udp
  protocols:
  forward: yes
  masquerade: yes
  forward-ports:
\tport=8443:proto=tcp:toport=443:toaddr=
  source-ports:
  icmp-blocks:
  rich rules:
\trule family="ipv4" source address="10.0.0.0/8" port port="5432" protocol="tcp" accept
\trule family="ipv4" source address="203.0.113.66" drop

trusted
  target: ACCEPT
  icmp-block-inversion: no
  interfaces:
  sources:
  services:
  ports:
  protocols:
  forward: yes
  masquerade: no
  forward-ports:
  source-ports:
  icmp-blocks:
  rich rules: `;

export const FIREWALLD_SERVICES = `svc cockpit
<port protocol="tcp" port="9090"/>
svc dhcpv6-client
<port protocol="udp" port="546"/>
svc ssh
<port protocol="tcp" port="22"/>`;

export const ROCKY = scriptOutput({
  uid: "0",
  ifaddr: "lo 127.0.0.1\neth0 10.0.0.5\ndocker0 172.17.0.1",
  tools: "firewalld running",
  fwddef: "public",
  fwdzones: FIREWALLD_ZONES,
  fwdsvc: FIREWALLD_SERVICES,
});

export const UFW_VERBOSE = `Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     LIMIT IN    Anywhere
80,443/tcp                 ALLOW IN    Anywhere                   # web
5432/tcp                   ALLOW IN    192.168.1.0/24
Anywhere                   DENY IN     203.0.113.4
Nginx Full                 ALLOW IN    Anywhere
8000:8010/tcp              ALLOW IN    Anywhere
3000 on eth1               ALLOW IN    Anywhere
22/tcp (v6)                LIMIT IN    Anywhere (v6)
80,443/tcp (v6)            ALLOW IN    Anywhere (v6)              # web
Nginx Full (v6)            ALLOW IN    Anywhere (v6)
8000:8010/tcp (v6)         ALLOW IN    Anywhere (v6)
3000 (v6) on eth1          ALLOW IN    Anywhere (v6)`;

export const UFW_NUMBERED = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     LIMIT IN    Anywhere
[ 2] 80,443/tcp                 ALLOW IN    Anywhere                   # web
[ 3] 2001:db8::/32 22/tcp       ALLOW IN    Anywhere
[ 4] 22/tcp (v6)                LIMIT IN    Anywhere (v6)`;

export const UBUNTU = scriptOutput({
  uid: "0",
  ifaddr: "lo 127.0.0.1\neth0 192.168.1.10",
  tools: "ufw active\nnftables json",
  ufw: UFW_VERBOSE,
  ufwadd: "Added user rules (see 'ufw status' for running firewall):\nufw limit 22/tcp\nufw allow 80,443/tcp comment 'web'",
  nftj: '{"nftables":[{"metainfo":{"version":"1.0.9"}}]}',
});

export const UBUNTU_OFF = scriptOutput({
  uid: "0",
  ifaddr: "eth0 192.168.1.10",
  tools: "ufw inactive",
  ufw: "Status: inactive",
  ufwadd: "Added user rules (see 'ufw status' for running firewall):\nufw allow 80/tcp\nufw allow from 10.0.0.0/8 to any port 5432 proto tcp",
});

const NFT_ITEMS = [
  { metainfo: { version: "1.0.6", release_name: "Lester Gooch #5", json_schema_version: 1 } },
  { table: { family: "inet", name: "filter", handle: 1 } },
  { chain: { family: "inet", table: "filter", name: "input", handle: 1, type: "filter", hook: "input", prio: 0, policy: "drop" } },
  { chain: { family: "inet", table: "filter", name: "forward", handle: 2, type: "filter", hook: "forward", prio: 0, policy: "drop" } },
  { chain: { family: "inet", table: "filter", name: "output", handle: 3, type: "filter", hook: "output", prio: 0, policy: "accept" } },
  { chain: { family: "inet", table: "filter", name: "web", handle: 10 } },
  { rule: { family: "inet", table: "filter", chain: "input", handle: 4, expr: [{ match: { op: "in", left: { ct: { key: "state" } }, right: { set: ["established", "related"] } } }, { accept: null }] } },
  { rule: { family: "inet", table: "filter", chain: "input", handle: 5, expr: [{ match: { op: "==", left: { meta: { key: "iifname" } }, right: "lo" } }, { accept: null }] } },
  {
    rule: {
      family: "inet",
      table: "filter",
      chain: "input",
      handle: 6,
      expr: [{ match: { op: "==", left: { payload: { protocol: "tcp", field: "dport" } }, right: 22 } }, { counter: { packets: 10, bytes: 600 } }, { accept: null }],
    },
  },
  {
    rule: {
      family: "inet",
      table: "filter",
      chain: "input",
      handle: 7,
      comment: "postgres interno",
      expr: [
        { match: { op: "==", left: { payload: { protocol: "ip", field: "saddr" } }, right: { prefix: { addr: "10.0.0.0", len: 8 } } } },
        { match: { op: "==", left: { payload: { protocol: "tcp", field: "dport" } }, right: 5432 } },
        { accept: null },
      ],
    },
  },
  {
    rule: {
      family: "inet",
      table: "filter",
      chain: "input",
      handle: 11,
      expr: [{ match: { op: "==", left: { payload: { protocol: "tcp", field: "dport" } }, right: { set: [80, 443] } } }, { jump: { target: "web" } }],
    },
  },
  { rule: { family: "inet", table: "filter", chain: "input", handle: 8, expr: [{ match: { op: "==", left: { meta: { key: "l4proto" } }, right: "icmp" } }, { accept: null }] } },
  { rule: { family: "inet", table: "filter", chain: "web", handle: 12, expr: [{ accept: null }] } },
  { table: { family: "ip", name: "filter", handle: 3 } },
  { chain: { family: "ip", table: "filter", name: "FORWARD", handle: 1, type: "filter", hook: "forward", prio: 0, policy: "drop" } },
  { chain: { family: "ip", table: "filter", name: "DOCKER", handle: 2 } },
  { chain: { family: "ip", table: "filter", name: "DOCKER-USER", handle: 3 } },
  { rule: { family: "ip", table: "filter", chain: "FORWARD", handle: 5, expr: [{ counter: { packets: 0, bytes: 0 } }, { jump: { target: "DOCKER-USER" } }] } },
  {
    rule: {
      family: "ip",
      table: "filter",
      chain: "DOCKER",
      handle: 9,
      expr: [
        { match: { op: "==", left: { payload: { protocol: "ip", field: "daddr" } }, right: "172.17.0.2" } },
        { match: { op: "!=", left: { meta: { key: "iifname" } }, right: "docker0" } },
        { match: { op: "==", left: { meta: { key: "oifname" } }, right: "docker0" } },
        { match: { op: "==", left: { payload: { protocol: "tcp", field: "dport" } }, right: 80 } },
        { counter: { packets: 0, bytes: 0 } },
        { accept: null },
      ],
    },
  },
  { table: { family: "inet", name: "netavark", handle: 4 } },
  { chain: { family: "inet", table: "netavark", name: "FORWARD", handle: 1, type: "filter", hook: "forward", prio: 0, policy: "accept" } },
  { rule: { family: "inet", table: "netavark", chain: "FORWARD", handle: 2, expr: [{ match: { op: "in", left: { ct: { key: "state" } }, right: ["established", "related"] } }, { accept: null }] } },
];

export const NFT_JSON = JSON.stringify({ nftables: NFT_ITEMS });

export const NFT_TEXT = `table inet filter { # handle 1
\tchain input { # handle 1
\t\ttype filter hook input priority filter; policy drop;
\t\tct state { established, related } accept # handle 4
\t\tiifname "lo" accept # handle 5
\t\ttcp dport 22 counter packets 10 bytes 600 accept # handle 6
\t\tip saddr 10.0.0.0/8 tcp dport 5432 accept comment "postgres interno" # handle 7
\t\ttcp dport { 80, 443 } jump web # handle 11
\t\tmeta l4proto icmp accept # handle 8
\t}
\tchain web { # handle 10
\t\taccept # handle 12
\t}
}
table ip filter { # handle 3
\tchain DOCKER { # handle 2
\t\tip daddr 172.17.0.2 iifname != "docker0" oifname "docker0" tcp dport 80 counter packets 0 bytes 0 accept # handle 9
\t}
}`;

export const DEBIAN = scriptOutput({
  uid: "0",
  ifaddr: "lo 127.0.0.1\nens3 192.0.2.20",
  tools: "nftables json",
  nftj: NFT_JSON,
  nftt: NFT_TEXT,
});

export const IPTABLES_SAVE = `# Generated by iptables-save v1.8.4 on Tue Nov 25 10:00:00 2026
*nat
:PREROUTING ACCEPT [0:0]
:INPUT ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:POSTROUTING ACCEPT [0:0]
:DOCKER - [0:0]
-A PREROUTING -m addrtype --dst-type LOCAL -j DOCKER
-A POSTROUTING -s 172.17.0.0/16 ! -o docker0 -j MASQUERADE
-A DOCKER -i docker0 -j RETURN
-A DOCKER ! -i docker0 -p tcp -m tcp --dport 8080 -j DNAT --to-destination 172.17.0.2:80
COMMIT
*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]
:DOCKER - [0:0]
:DOCKER-USER - [0:0]
-A INPUT -i lo -j ACCEPT
-A INPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
-A INPUT -p tcp -m tcp --dport 2222 -j ACCEPT
-A INPUT -s 192.168.0.0/16 -p tcp -m multiport --dports 80,443 -m comment --comment "web interna" -j ACCEPT
-A INPUT -p tcp -m tcp --dport 23 -j REJECT --reject-with icmp-port-unreachable
-A FORWARD -j DOCKER-USER
-A FORWARD -o docker0 -j DOCKER
-A DOCKER -d 172.17.0.2/32 ! -i docker0 -o docker0 -p tcp -m tcp --dport 80 -j ACCEPT
-A DOCKER-USER -j RETURN
COMMIT`;

export const OLD_SERVER = scriptOutput({ uid: "0", ifaddr: "eth0 198.51.100.9", tools: "", ipt: IPTABLES_SAVE });

/** Sin sudo: ufw no dice nada y no se leen reglas. */
export const NO_SUDO = scriptOutput({ uid: "1000", ifaddr: "eth0 192.168.1.10", tools: "ufw ?" });
