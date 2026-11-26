// Quién puede usar contenedores en el servidor. Se vuelve a leer con cada recarga de Usuarios
// (`read` cambia) y tras dar o quitar un permiso (el panel recarga solo).
import { useEffect, useState } from "react";
import { CONTAINER_ACCESS_SCRIPT, parseContainerAccess, type ContainerAccessInfo } from "../../../features/admin";
import { useAdmin } from "../context";
import { readElevated } from "../../../features/privileges";

/** null mientras se lee o si falla (la columna simplemente no se muestra). */
export function useContainerAccess(): ContainerAccessInfo | null {
  const { sessionId, elevation, read, disabled } = useAdmin();
  const [info, setInfo] = useState<ContainerAccessInfo | null>(null);
  useEffect(() => {
    if (!read || disabled) return;
    let alive = true;
    readElevated(sessionId, CONTAINER_ACCESS_SCRIPT, elevation, 20)
      .then((r) => alive && setInfo(parseContainerAccess(r.result.stdout)))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [sessionId, elevation, read, disabled]);
  return info;
}
