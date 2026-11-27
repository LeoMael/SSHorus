// «Abrir en Administración» desde «Auditar proyecto»: pide a la pestaña de ese servidor que enseñe
// Administración → Auditoría (con su último informe).
import { create } from "zustand";

export interface AuditNavRequest {
  sessionId: string;
  seq: number;
}

let seq = 0;

export const useAuditNav = create<{ request: AuditNavRequest | null }>(() => ({ request: null }));

export function openAuditTab(sessionId: string): void {
  useAuditNav.setState({ request: { sessionId, seq: ++seq } });
}

/** La sub-pestaña ya se abrió. */
export function auditNavDone(s: number): void {
  useAuditNav.setState((st) => (st.request?.seq === s ? { request: null } : st));
}
