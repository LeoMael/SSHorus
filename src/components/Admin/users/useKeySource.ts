// De dónde sale la llave pública del usuario nuevo: pegada, de ~/.ssh de este equipo o generada aquí
// (la privada nunca sale del equipo).
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { errorMessage } from "../../../api/core";
import { localkeys, type LocalPublicKey } from "../../../api/localkeys";
import { suggestKeyName } from "../../../features/admin";
import { validateKeyName } from "../../../features/sshkeys/keys";

export type KeySourceKind = "paste" | "local" | "generate";
type Errors = Dispatch<SetStateAction<Record<string, string>>>;

/** `user` y `host` dan el nombre sugerido del archivo y el comentario de la llave generada. */
export function useKeySource(user: string, host: string, setErrors: Errors) {
  const [source, setSource] = useState<KeySourceKind>("paste");
  const [pasted, setPasted] = useState("");
  const [locals, setLocals] = useState<LocalPublicKey[] | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [genName, setGenName] = useState("");
  const [genPass, setGenPass] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [generated, setGenerated] = useState<{ line: string; privatePath: string; passphrase: string } | null>(null);

  useEffect(() => {
    if (source !== "local" || locals) return;
    localkeys.listPublic().then(
      (l) => {
        setLocals(l);
        if (l[0]) setLocalPath(l[0].path);
      },
      (e) => setErrors((x) => ({ ...x, key: errorMessage(e) })),
    );
  }, [source, locals, setErrors]);

  const suggested = suggestKeyName(user || "usuario", host);

  const generate = async () => {
    const n = genName || suggested;
    const ne = validateKeyName(n);
    if (ne) return setErrors((x) => ({ ...x, gen: ne }));
    setGenBusy(true);
    setErrors((x) => ({ ...x, gen: "", key: "" }));
    try {
      const k = await localkeys.generate(n, `${user || "usuario"}@${host}`, genPass);
      setGenerated({ line: k.publicLine, privatePath: k.privatePath, passphrase: genPass });
      setGenName(n);
    } catch (e) {
      setErrors((x) => ({ ...x, gen: errorMessage(e) }));
    } finally {
      setGenBusy(false);
    }
  };

  /** La llave elegida (y dónde está la privada, si se sabe) o por qué falta. */
  const keyLine = (): { line: string; privatePath: string } | string => {
    if (source === "generate") return generated ? { line: generated.line, privatePath: generated.privatePath } : "Genera la llave primero";
    if (source === "local") {
      const k = locals?.find((l) => l.path === localPath);
      return k ? { line: k.line, privatePath: k.privatePath ?? "" } : "Elige una llave de ~/.ssh";
    }
    return { line: pasted, privatePath: "" };
  };

  return {
    source,
    setSource,
    pasted,
    setPasted,
    locals,
    localPath,
    setLocalPath,
    genName,
    setGenName,
    genPass,
    setGenPass,
    genBusy,
    generated,
    suggested,
    generate,
    keyLine,
  };
}

export type KeySource = ReturnType<typeof useKeySource>;
