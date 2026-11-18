// Si el servidor que se edita ya tiene contraseña (o frase) y contraseña de sudo guardadas.
import { useEffect, useState } from "react";
import { profiles as profilesApi } from "../../api/profiles";
import type { ServerProfile } from "../../api/types";

export function useSavedSecrets(isNew: boolean, initial: ServerProfile | null) {
  /** null = desconocido (nuevo o llavero no disponible). */
  const [hasSecret, setHasSecret] = useState<boolean | null>(null);
  const [hasSudoSecret, setHasSudoSecret] = useState<boolean | null>(null);

  useEffect(() => {
    if (isNew || !initial) return;
    let alive = true;
    profilesApi
      .hasSecret(initial.id)
      .then((v) => {
        if (alive) setHasSecret(v);
      })
      .catch(() => alive && setHasSecret(null));
    profilesApi
      .hasSecret(initial.id, "sudo")
      .then((v) => alive && setHasSudoSecret(v))
      .catch(() => alive && setHasSudoSecret(null));
    return () => {
      alive = false;
    };
  }, [isNew, initial]);

  return { hasSecret, hasSudoSecret };
}
