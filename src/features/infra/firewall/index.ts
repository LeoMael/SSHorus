// Cortafuegos del mapa de infraestructura: leer las reglas (firewalld, ufw, nftables, iptables),
// explicarlas en palabras simples, cruzarlas con los puertos en escucha y cambiarlas sin quedarse fuera.
// Solo lo usa el mapa (por eso vive en features/infra/). La interfaz está en components/InfraMap/Firewall*.
export type * from "./types";
export { canManage } from "./report";
export { MANAGED_TEXT, policyLines, ruleText, statusText, TOOL_LABEL } from "./explain";
export { crossCheck, type FwFinding } from "./crosscheck";
export { planChange, TRIAL_SECS, zoneForChange, type FwChange, type FwPlan, type FwTarget } from "./commands";
export { lockoutProblem, sshPortsToOpen, type SshGuard } from "./lockout";
export { EMPTY_FORM, formTarget, serviceSuggestions, type RuleForm } from "./form";
export { usedZones } from "./firewalld";
export { blockPort, outsideZones, type BlockCheck } from "./block";
export { readFirewall, type FirewallRead } from "./read";
export { expireTrials, finishTrial, FIREWALL_JOB, startFirewallChange, trialActions, useFwTrials, type FwTrial } from "./job";
