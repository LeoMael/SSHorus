// Credenciales de las bases de datos de un servidor (motor: src-tauri/src/storage/db_secret.rs). Van a la
// bóveda o al llavero; la contraseña solo se usa para dársela por stdin al comando remoto.
import { call } from "./core";

export interface DbCredential {
  user: string;
  password: string;
}

export const dbCreds = {
  /** Destinos con credencial guardada (sin contraseñas). */
  targets: (profileId: string) => call<string[]>("db_creds_targets", { profileId }),
  get: (profileId: string, target: string) => call<DbCredential | null>("db_creds_get", { profileId, target }),
  /** `null` la olvida. */
  set: (profileId: string, target: string, credential: DbCredential | null) =>
    call<void>("db_creds_set", { profileId, target, credential }),
};
