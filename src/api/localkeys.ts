import { call } from "./core";

/** Llave pública (`.pub`) de este equipo, ya validada por el motor. */
export interface LocalPublicKey {
  path: string;
  /** Privada correspondiente (el .pub sin extensión), si existe. */
  privatePath: string | null;
  /** Línea normalizada `tipo base64 [comentario]`. */
  line: string;
  keyType: string;
  comment: string;
}

export interface GeneratedKey {
  privatePath: string;
  publicPath: string;
  publicLine: string;
}

/** Llave PRIVADA de ~/.ssh (solo su ruta y datos para mostrarla; el secreto no sale del motor). */
export interface LocalPrivateKey {
  path: string;
  /** Nombre del archivo (p. ej. id_ed25519). */
  name: string;
  /** ed25519, rsa, ecdsa, dsa, ed25519-sk… (null = no se sabe). */
  kind: string | null;
  comment: string;
  /** Protegida con frase (null = no se sabe). */
  encrypted: boolean | null;
  /** Línea pública (del .pub o sacada de la privada). */
  publicLine: string | null;
  /** `Host` de ~/.ssh/config que la usan (`IdentityFile`). */
  configHosts: ConfigHost[];
}

/** `Host` de ~/.ssh/config que usa una llave. */
export interface ConfigHost {
  alias: string;
  /** HostName (o el alias si no lo tiene). */
  hostname: string;
}

export interface LocalKeys {
  /** Carpeta donde se buscó (~/.ssh). */
  dir: string;
  /** Primero las llaves por defecto (id_ed25519, id_ecdsa, id_rsa…), luego el resto por nombre. */
  keys: LocalPrivateKey[];
  /** Comentario sugerido para una llave nueva: usuario@equipo. */
  defaultComment: string;
}

/** Llaves SSH LOCALES (~/.ssh). La privada nunca sale del equipo: solo se devuelve su ruta. */
export const localkeys = {
  listPublic: () => call<LocalPublicKey[]>("local_ssh_public_keys"),
  listPrivate: () => call<LocalKeys>("local_ssh_private_keys"),
  /** Crea ~/.ssh/<name> (ed25519, 0600) y <name>.pub. Falla si ya existen. */
  generate: (name: string, comment: string, passphrase: string) =>
    call<GeneratedKey>("local_ssh_generate_key", { name, comment, passphrase: passphrase || null }),
};
