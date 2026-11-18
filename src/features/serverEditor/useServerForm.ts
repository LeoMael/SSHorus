// Estado del formulario de servidor: los campos en un solo objeto y los errores de validación.
import { useCallback, useState } from "react";
import type { ServerProfile } from "../../api/types";
import { initialFields, type FormErrors, type ServerFormFields } from "./serverForm";

export type SetFields = (patch: Partial<ServerFormFields>) => void;

export function useServerForm(initial: ServerProfile | null, projectId: string) {
  const [fields, setFields] = useState(() => initialFields(initial, projectId));
  const set = useCallback<SetFields>((patch) => setFields((f) => ({ ...f, ...patch })), []);
  const [errors, setErrors] = useState<FormErrors>({});
  const clearErr = useCallback(
    (k: keyof FormErrors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)),
    [],
  );
  return { fields, set, errors, setErrors, clearErr };
}

export type ClearError = (k: keyof FormErrors) => void;
