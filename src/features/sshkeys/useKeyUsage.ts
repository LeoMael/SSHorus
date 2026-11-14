// Uso de cada llave (GitHub / servidores) con los datos de la app: servidores guardados y, si la
// cuenta de GitHub ya se sabe conectada, sus llaves públicas (una sola petición por sesión).
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { github } from "../../api/github";
import type { LocalPrivateKey } from "../../api/localkeys";
import { useProfiles } from "../../stores/profiles";
import { useGitHub } from "../github/store";
import { keyUsage, publicKeyId, type KeyUsage } from "./usage";

const NONE: ReadonlySet<string> = new Set();

const useGhKeyIds = create<{ ids: ReadonlySet<string> }>(() => ({ ids: NONE }));
let requested = false;

/** `force`: volver a pedirlas (p. ej. tras subir una llave a GitHub). */
export async function loadGitHubKeyIds(force = false) {
  if (requested && !force) return;
  requested = true;
  try {
    const keys = await github.myKeys();
    useGhKeyIds.setState({ ids: new Set(keys.map((k) => publicKeyId(k.key))) });
  } catch {
    // Sin red o con el token caducado la etiqueta sale solo de ~/.ssh/config y del nombre.
    requested = false;
  }
}

export type WithUsage<T> = T & { usage: KeyUsage };

/** Las llaves con su uso detectado, en el mismo orden. */
export function useKeyUsages(keys: readonly LocalPrivateKey[]): WithUsage<LocalPrivateKey>[] {
  const servers = useProfiles((s) => s.servers);
  const connected = useGitHub((s) => s.connected);
  const ghIds = useGhKeyIds((s) => s.ids);
  useEffect(() => {
    if (connected) void loadGitHubKeyIds();
  }, [connected]);
  const ids = connected ? ghIds : NONE;
  return useMemo(() => keys.map((k) => ({ ...k, usage: keyUsage(k, servers, ids) })), [keys, servers, ids]);
}
