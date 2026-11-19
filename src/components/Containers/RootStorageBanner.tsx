// Aviso «Podman de este usuario usa las carpetas de root» con «Arreglar»: comprueba (solo lectura,
// como ese usuario) si ya tiene storage.conf y qué RunRoot guarda su base de datos, y propone crear
// ~/.config/containers/storage.conf con sus carpetas. Nunca sobrescribe uno que exista.
import { useState } from "react";
import { HardDrive, Wrench } from "lucide-react";
import {
  STORAGE_PROBE_SCRIPT,
  existingConfAdvice,
  ownerKey,
  parseStorageProbe,
  rootStorageOwners,
  storageFix,
  withOwner,
  type CtOwner,
  type EngineRun,
  type EngineStatus,
  type StorageFix,
} from "../../features/containers";
import { confirmDialog } from "../ui/dialogs";
import { toast } from "../../stores/toasts";
import type { ReviewRequest } from "./context";
import type { OwnerScope } from "./useOwnerScope";

interface Props {
  scope: OwnerScope;
  status: EngineStatus;
  ownerErrors: Record<string, string>;
  runRawAs: (owner: string | undefined, script: string, timeoutSecs?: number) => Promise<EngineRun>;
  review: (req: ReviewRequest) => void;
  /** Tras arreglarlo: volver a detectar el motor. */
  detect: () => Promise<void>;
}

function fixRequest(name: string, key: string, fix: StorageFix, after: () => void): ReviewRequest {
  return {
    title: `Arreglar Podman de ${name}`,
    message: (
      <>
        Se creará <code>{fix.file}</code> como <strong>{name}</strong> para que Podman use sus propias carpetas.{" "}
        {fix.runrootSource === "db"
          ? "La carpeta de ejecución (runroot) es la que ya tiene guardada su base de datos."
          : "No se pudo leer su base de datos (o no tiene): se usa la carpeta de ejecución habitual de Podman sin root."}{" "}
        Si el archivo ya existe, no se toca.
      </>
    ),
    details: () => <pre className="ct-review-details">{fix.text}</pre>,
    build: () => [withOwner(fix.cmd, key)],
    runLabel: "Crear storage.conf",
    success: `storage.conf creado para ${name}\nPodman ya usa sus propias carpetas`,
    reload: ["containers"],
    onDone: after,
  };
}

export function RootStorageBanner({ scope, status, ownerErrors, runRawAs, review, detect }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const users = rootStorageOwners({
    engine: scope.engine,
    isRoot: scope.isRoot,
    selfError: status.rawError,
    owners: scope.activeOwners,
    errors: ownerErrors,
  });
  if (users.length === 0) return null;

  const fixOne = async (o: CtOwner) => {
    const key = ownerKey(o);
    const name = scope.label(o);
    setBusy(key);
    const r = await runRawAs(key, STORAGE_PROBE_SCRIPT, 20);
    setBusy(null);
    const probe = r.result ? parseStorageProbe(r.result.stdout) : null;
    if (!probe?.ok) {
      if (!r.needSudo) toast.error(`No se pudo revisar Podman de ${name}`, r.error ?? undefined);
      return;
    }
    if (probe.confExists) {
      const again = await confirmDialog({
        title: `${name} ya tiene storage.conf`,
        message: (
          <>
            <p>
              SSHorus no sobrescribe <code>~/.config/containers/storage.conf</code>. Revísalo (o bórralo para que Podman use sus
              valores por defecto) y vuelve a detectar.
            </p>
            <pre className="ct-review-details">{existingConfAdvice(probe)}</pre>
          </>
        ),
        confirmText: "Volver a detectar",
        cancelText: "Cerrar",
      });
      if (again) void detect();
      return;
    }
    const fix = storageFix(probe);
    if (!fix) {
      toast.error(`No se pudo preparar el arreglo para ${name}`, "Falta su carpeta personal o su número de usuario.");
      return;
    }
    review(fixRequest(name, key, fix, () => void detect()));
  };

  const one = users.length === 1;
  const who = one && users[0].kind === "self" ? "este usuario" : users.map((u) => `«${scope.label(u)}»`).join(", ");
  const selfRaw = users.some((u) => u.kind === "self") ? status.rawError : null;
  return (
    <div className="ct-banner" role="status">
      <HardDrive size={15} />
      <div className="ct-banner-text">
        <strong>Podman de {who} usa las carpetas de root</strong>
        <span>
          Arranca con /var/lib/containers y /run/containers (los de root) en vez de los suyos, y falla sin permiso. Se arregla
          con su propio ~/.config/containers/storage.conf.
        </span>
        {selfRaw && <code className="ct-raw">{selfRaw}</code>}
      </div>
      {users.map((u) => {
        const key = ownerKey(u);
        return (
          <button key={key} className="btn btn-sm" disabled={busy !== null} onClick={() => void fixOne(u)}>
            {busy === key ? <span className="spinner" /> : <Wrench size={13} />} {one ? "Arreglar" : `Arreglar: ${scope.label(u)}`}
          </button>
        );
      })}
    </div>
  );
}
