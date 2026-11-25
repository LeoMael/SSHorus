// Hallazgos e informes de ejemplo para las pruebas del escáner (fix.test.ts, fixOutcome.test.ts).
import type { Finding, Report, Target } from "../../api/vulnscan";

export function finding(p: Partial<Finding>): Finding {
  const f: Finding = {
    key: "",
    id: "CVE-2026-0001",
    aliases: [],
    advisories: [],
    package: "openssl",
    binaries: ["libssl3", "openssl"],
    installed: "3.0.11-1",
    fixed: "3.0.15-1",
    hasFix: true,
    severity: "high",
    distroSeverity: null,
    cvss: null,
    cvssVector: null,
    unimportant: false,
    status: null,
    summary: null,
    target: "system",
    sources: ["osv"],
    kernel: false,
    ecosystem: null,
    upstream: false,
    ...p,
  };
  return { ...f, key: p.key ?? `${f.id}|${f.package}|${f.target}` };
}

export const targets: Target[] = [
  { key: "system", kind: "system", label: "Sistema", user: null, ecosystem: null, packages: 1, image: null, sources: [], error: null },
  { key: "runtime", kind: "runtime", label: "Programas sueltos", user: null, ecosystem: null, packages: 1, image: null, sources: [], error: null },
  { key: "image:podman::abc", kind: "image", label: "Imagen", user: null, ecosystem: null, packages: 1, image: null, sources: [], error: null },
];

export function report(osId: string, pm: Report["host"]["packageManager"], findings: Finding[], tools: string[] = []): Report {
  return {
    id: "r1",
    serverId: "s1",
    createdAt: "2026-11-16T10:00:00Z",
    durationMs: 1,
    elevated: false,
    host: {
      os: { id: osId, idLike: [], versionId: "", version: "", versionCodename: "", prettyName: "", name: "" },
      kernel: "",
      arch: "x86_64",
      packageManager: pm,
      ecosystem: null,
      inContainer: false,
      tools,
    },
    sources: [],
    targets,
    programs: [],
    findings,
    summary: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0, total: 0, withFix: 0, unimportant: 0 },
    notes: [],
    ai: null,
    osvSample: [],
  };
}
