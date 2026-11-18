// Alias de ~/.ssh/config elegido a mano para el servidor.
import { useEffect, useState } from "react";
import { sshAliases, type SshAliasInfo } from "../../api/profiles";
import { errorMessage } from "../../api/core";

export interface AliasState {
  /** Alias escrito a mano ("" = automático). */
  value: string;
  setValue: (v: string) => void;
  /** Distinto del guardado. */
  changed: boolean;
  info: SshAliasInfo | null;
  error: string | null;
}

/** Alias elegido a mano para el servidor y, con un pequeño retardo, si choca con un `Host` escrito a mano. */
export function useSshAlias(id: string, name: string, host: string): AliasState {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [info, setInfo] = useState<SshAliasInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setSaved("");
      return;
    }
    let alive = true;
    sshAliases
      .list()
      .then((m) => {
        if (!alive) return;
        setSaved(m[id] ?? "");
        setValue((v) => v || (m[id] ?? ""));
      })
      .catch(() => alive && setSaved(""));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const n = name.trim() || host.trim();
    if (!n && !value.trim()) {
      setInfo(null);
      setError(null);
      return;
    }
    let alive = true;
    const t = window.setTimeout(() => {
      sshAliases
        .info(id, n, host.trim(), value.trim() || null)
        .then((i) => {
          if (!alive) return;
          setInfo(i);
          setError(null);
        })
        .catch((e) => {
          if (!alive) return;
          setInfo(null);
          // Alias inválido: se muestra; otros fallos (p. ej. no se puede leer el archivo) no bloquean.
          setError(value.trim() ? errorMessage(e) : null);
        });
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [id, name, host, value]);

  return { value, setValue, changed: saved !== null && value.trim() !== saved, info, error };
}
