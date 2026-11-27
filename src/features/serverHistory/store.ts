// Qué historial está abierto (uno a la vez). Módulo ligero: lo importan la barra lateral y Administración;
// el diálogo se carga al abrirlo (components/ServerHistory/ServerHistoryHost).
import { create } from "zustand";

export const useServerHistoryDialog = create<{ serverId: string | null }>(() => ({ serverId: null }));

export function openServerHistory(serverId: string): void {
  useServerHistoryDialog.setState({ serverId });
}

export function closeServerHistory(): void {
  useServerHistoryDialog.setState({ serverId: null });
}
