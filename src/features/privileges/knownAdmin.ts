// Último resultado conocido de «¿esta cuenta administra el servidor?» por servidor guardado. Se apunta
// cada vez que se detectan los privilegios de una conexión y se recuerda entre sesiones (localStorage),
// para marcar la cuenta con sudo en la barra lateral aunque no esté conectada.
import { create } from "zustand";
import { useTabs } from "../../stores/tabs";
import { accountAdmin, type AccountAdmin, type PrivilegeInfo } from "./detect";

const STORAGE_KEY = "sshorus.privileges.knownAdmin";

export interface KnownAdmin {
  level: AccountAdmin;
  /** Usuario remoto con el que se vio (si el servidor se edita con otro usuario, deja de valer). */
  user: string | null;
}

function isKnownAdmin(v: unknown): v is KnownAdmin {
  if (!v || typeof v !== "object") return false;
  const { level, user } = v as Record<string, unknown>;
  return (level === "root" || level === "sudo" || level === "user") && (user === null || typeof user === "string");
}

function readStored(): Record<string, KnownAdmin> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => isKnownAdmin(v))) as Record<string, KnownAdmin>;
  } catch {
    return {};
  }
}

function writeStored(v: Record<string, KnownAdmin>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: solo se pierde el recuerdo */
  }
}

interface KnownAdminState {
  byProfile: Record<string, KnownAdmin>;
  record: (profileId: string, info: PrivilegeInfo) => void;
}

export const useKnownAdmin = create<KnownAdminState>((set) => ({
  byProfile: readStored(),
  record: (profileId, info) =>
    set((s) => {
      const level = accountAdmin(info.level);
      const cur = s.byProfile[profileId];
      // «unknown» (falló la comprobación) no borra lo que ya se sabía; «puede que tenga sudo» sí.
      if (info.level === "unknown") return s;
      if (!level && !cur) return s;
      if (level && cur?.level === level && cur.user === info.user) return s;
      const byProfile = { ...s.byProfile };
      if (level) byProfile[profileId] = { level, user: info.user };
      else delete byProfile[profileId];
      writeStored(byProfile);
      return { byProfile };
    }),
}));

/** Lo que se sabía de una cuenta, si sigue valiendo para su usuario actual. */
export function knownAdminFor(entry: KnownAdmin | undefined, username: string): AccountAdmin | null {
  if (!entry) return null;
  return entry.user === null || entry.user === username.trim() ? entry.level : null;
}

/** Apunta cada resultado nuevo de `bySession` en el servidor de su pestaña. */
export function recordDetected(bySession: Record<string, PrivilegeInfo>, prev: Record<string, PrivilegeInfo>): void {
  const tabs = useTabs.getState().tabs;
  for (const [sessionId, info] of Object.entries(bySession)) {
    if (prev[sessionId] === info) continue;
    const tab = tabs.find((t) => t.sessionId === sessionId);
    if (tab) useKnownAdmin.getState().record(tab.profileId, info);
  }
}
