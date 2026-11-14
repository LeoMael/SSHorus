// Llaves privadas de ~/.ssh, compartidas por el formulario del servidor, Ajustes y el asistente.
import { useEffect } from "react";
import { create } from "zustand";
import { localkeys, type LocalKeys } from "../../api/localkeys";
import { errorMessage } from "../../api/core";

interface State {
  data: LocalKeys | null;
  error: string | null;
  loading: boolean;
  /** Vuelve a leer ~/.ssh (p. ej. tras crear una llave). */
  reload: () => Promise<LocalKeys | null>;
}

export const useLocalKeys = create<State>((set) => ({
  data: null,
  error: null,
  loading: false,
  reload: async () => {
    set({ loading: true });
    try {
      const data = await localkeys.listPrivate();
      set({ data, error: null, loading: false });
      return data;
    } catch (e) {
      set({ error: errorMessage(e), loading: false });
      return null;
    }
  },
}));

/** Lee ~/.ssh al mostrarse (siempre de nuevo: el usuario pudo crear llaves fuera de SSHorus). */
export function useLocalKeysOnMount(): State {
  const state = useLocalKeys();
  useEffect(() => {
    void useLocalKeys.getState().reload();
  }, []);
  return state;
}
