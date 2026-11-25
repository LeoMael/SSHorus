// Vistas fijas del área de trabajo (siempre presentes, sin botón de cerrar), en el orden de la fila.
import type { ReactNode } from "react";
import { Activity, Cable, Container, Database, FolderOpen, ShieldCheck, SquareTerminal } from "lucide-react";

export type FixedTab = "files" | "commands" | "containers" | "databases" | "monitor" | "tunnels" | "admin";

export const FIXED: { id: FixedTab; label: string; title?: string; icon: ReactNode }[] = [
  { id: "files", label: "Archivos", icon: <FolderOpen size={14} /> },
  {
    id: "commands",
    label: "Comandos",
    title: "Biblioteca de comandos",
    icon: <SquareTerminal size={14} />,
  },
  { id: "containers", label: "Contenedores", title: "Contenedores (Podman / Docker)", icon: <Container size={14} /> },
  { id: "databases", label: "Bases de datos", title: "Ver el esquema de las bases de datos (solo lectura)", icon: <Database size={14} /> },
  { id: "monitor", label: "Monitor", title: "Monitoreo en vivo del servidor", icon: <Activity size={14} /> },
  { id: "tunnels", label: "Túneles", title: "Túneles (port forwarding)", icon: <Cable size={14} /> },
  { id: "admin", label: "Administración", title: "Administración del servidor", icon: <ShieldCheck size={14} /> },
];
export const FIXED_IDS = FIXED.map((f) => f.id);
export const fixedLabel = (id: FixedTab) => FIXED.find((f) => f.id === id)?.label ?? "";
