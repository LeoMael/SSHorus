// Etiqueta del estado de una cuenta («Activa», «Solo llave», «Bloqueada»…), con su explicación al pasar el ratón.
import type { AccountKind, AccountState } from "../../../features/admin";

const TAGS: Record<AccountKind, { text: string; cls: string }> = {
  unknown: { text: "—", cls: "faint" },
  active: { text: "Activa", cls: "adm-tag adm-tag-green" },
  change: { text: "Cambiar clave", cls: "adm-tag adm-tag-yellow" },
  empty: { text: "Sin contraseña", cls: "adm-tag adm-tag-yellow" },
  "key-only": { text: "Solo llave", cls: "adm-tag adm-tag-accent" },
  locked: { text: "Bloqueada", cls: "adm-tag adm-tag-red" },
};

/** Explicación completa: el motivo y, si lo hay, el aviso de sudo. */
export function accountTitle(s: AccountState): string {
  return s.sudoWarning ? `${s.title}. Ojo: ${s.sudoWarning}` : s.title;
}

export function AccountTag({ state }: { state: AccountState }) {
  const t = TAGS[state.kind];
  return (
    <span className={t.cls} title={accountTitle(state)}>
      {t.text}
    </span>
  );
}
