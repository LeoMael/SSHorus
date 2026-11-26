// «Añadir a SSHorus»: lo elegido en cada fila (nombre del servidor y cómo entra), con sus valores por
// defecto (ver `rowAccess`) y lo cambiado a mano.
import { useCallback, useMemo, useState } from "react";
import type { LocalPrivateKey } from "../../../api/localkeys";
import type { ServerProfile } from "../../../api/types";
import {
  authorizedKeys,
  availableMethods,
  defaultKeyPath,
  defaultServerNames,
  installableKeys,
  rowAccess,
  type AccessContext,
  type AccessEdit,
  type AccessMethod,
  type ImportCandidate,
  type RowAccess,
} from "../../../features/admin";
import type { WithUsage } from "../../../features/sshkeys";

type Key = WithUsage<LocalPrivateKey>;

export interface RowChoice {
  name: string;
  access: RowAccess;
  methods: AccessMethod[];
  /** Sus llaves ya autorizadas. */
  authorized: Key[];
}

type Edit = AccessEdit & { name?: string };

export function useImportChoices(
  candidates: readonly ImportCandidate[],
  keys: readonly Key[],
  base: ServerProfile | null,
  servers: readonly ServerProfile[],
  canInstall: boolean,
) {
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const names = useMemo(() => defaultServerNames(candidates.map((c) => c.name), base?.host ?? "", servers), [candidates, base, servers]);
  const installable = useMemo(() => installableKeys(keys), [keys]);
  const fallbackKey = defaultKeyPath(base, keys);

  const choices = useMemo(() => {
    const out = new Map<string, RowChoice>();
    for (const c of candidates) {
      const e = edits[c.name] ?? {};
      const ctx: AccessContext = { authorized: c.authorized, keys, canInstall, fallbackKey };
      out.set(c.name, {
        name: e.name ?? names.get(c.name) ?? c.name,
        access: rowAccess(ctx, e),
        methods: availableMethods(ctx),
        authorized: authorizedKeys(c.authorized, keys),
      });
    }
    return out;
  }, [candidates, edits, keys, canInstall, fallbackKey, names]);

  const edit = useCallback((user: string, e: Edit) => setEdits((x) => ({ ...x, [user]: { ...x[user], ...e } })), []);
  return { choices, installable, edit };
}
