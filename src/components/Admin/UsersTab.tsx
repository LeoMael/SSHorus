// Sub-pestaña «Usuarios»: tabla, filtros y acciones (crear, editar, llaves, contenedores, bloquear, eliminar).
import { useCallback, useMemo, useState, type MouseEvent } from "react";
import { Boxes, Eye, Import, KeyRound, KeySquare, Lock, LockOpen, Pencil, Search, Trash2, UserPlus } from "lucide-react";
import { accountState, deleteUserPlan, lockUserPlan, todayDays, userContainers, type AccountState, type UserContainers, type UserRow } from "../../features/admin";
import { protectedReason, useAdmin } from "./context";
import { VirtualTable, type Column } from "./VirtualTable";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { PlanModal } from "./PlanReview";
import { UserDialog } from "./UserDialog";
import { KeysDialog } from "./KeysDialog";
import { KeyUserWizard } from "./KeyUserWizard";
import { ImportUsersDialog } from "./ImportUsersDialog";
import { AccountTag, accountTitle } from "./AccountTag";
import { containerColumn } from "./ContainerTags";
import { ContainerAccessDialog } from "./ContainerAccessDialog";
import { useContainerAccess } from "./useContainerAccess";

type Dialog =
  | { kind: "create" }
  | { kind: "create-key" }
  | { kind: "import" }
  | { kind: "edit"; user: UserRow }
  | { kind: "keys"; user: UserRow }
  | { kind: "containers"; user: UserRow }
  | { kind: "lock"; user: UserRow; lock: boolean }
  | { kind: "delete"; user: UserRow };

export function UsersTab({ onOpenVisibility }: { onOpenVisibility?: () => void }) {
  const { users, readOnly, me, env } = useAdmin();
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; user: UserRow } | null>(null);
  const ctInfo = useContainerAccess();
  // null = no se sabe aún o no hay ni Podman ni Docker: sin columna.
  const ctAccess = useMemo(
    () => (ctInfo && (ctInfo.podman || ctInfo.docker) ? new Map<string, UserContainers>(users.map((u) => [u.name, userContainers(ctInfo, u)])) : null),
    [ctInfo, users],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => showSystem || !u.isSystem)
      .filter(
        (u) =>
          !q ||
          u.name.toLowerCase().includes(q) ||
          u.fullName.toLowerCase().includes(q) ||
          String(u.uid) === q ||
          u.groups.some((g) => g.toLowerCase().includes(q)),
      )
      .sort((a, b) => (a.uid === 0 ? -1 : b.uid === 0 ? 1 : a.uid - b.uid));
  }, [users, query, showSystem]);

  const states = useMemo(() => {
    const today = todayDays();
    return new Map<string, AccountState>(users.map((u) => [u.name, accountState(u, today)]));
  }, [users]);
  const sel = rows.find((u) => u.name === selected) ?? null;
  const selWarning = sel ? states.get(sel.name)?.sudoWarning : null;
  const hiddenSystem = users.filter((u) => u.isSystem).length;

  const columns: Column<UserRow>[] = useMemo(
    () => [
      {
        key: "name",
        label: "Usuario",
        width: "minmax(110px, 1.1fr)",
        render: (u) => (
          <span className="adm-name">
            {u.name}
            {u.name === me && <span className="adm-you">tú</span>}
          </span>
        ),
        title: (u) => u.name,
      },
      { key: "full", label: "Nombre completo", width: "minmax(110px, 1.2fr)", render: (u) => u.fullName || <span className="faint">—</span>, title: (u) => u.gecos },
      { key: "uid", label: "UID", width: "58px", align: "right", render: (u) => <span className="mono">{u.uid}</span> },
      { key: "groups", label: "Grupos", width: "minmax(120px, 1.4fr)", render: (u) => u.groups.join(", "), title: (u) => u.groups.join(", ") },
      { key: "shell", label: "Shell", width: "minmax(80px, 0.8fr)", render: (u) => <span className="mono">{u.shell}</span>, title: (u) => u.shell },
      { key: "home", label: "Carpeta", width: "minmax(100px, 1fr)", render: (u) => <span className="mono">{u.home}</span>, title: (u) => u.home },
      {
        key: "last",
        label: "Último acceso",
        width: "136px",
        render: (u) => u.lastLogin ?? <span className="faint">—</span>,
      },
      {
        key: "state",
        label: "Estado",
        width: "104px",
        render: (u) => {
          const st = states.get(u.name);
          return st ? <AccountTag state={st} /> : null;
        },
        title: (u) => {
          const st = states.get(u.name);
          return st ? accountTitle(st) : "";
        },
      },
      {
        key: "sudo",
        label: "Admin",
        width: "64px",
        render: (u) => (u.isAdmin ? <span className="adm-tag adm-tag-accent">Sí</span> : <span className="faint">No</span>),
        title: (u) => (u.isAdmin ? (u.uid === 0 ? "root" : "Está en wheel/sudo/admin") : ""),
      },
      ...(ctAccess ? [containerColumn(ctAccess)] : []),
    ],
    [me, states, ctAccess],
  );

  const actions = useCallback(
    (u: UserRow): (MenuItem | "sep")[] => {
      const prot = protectedReason(u.name, me);
      const roTitle = readOnly ? "Necesitas root o sudo" : undefined;
      return [
        { label: "Editar…", icon: <Pencil size={14} />, onClick: () => setDialog({ kind: "edit", user: u }), disabled: readOnly, title: roTitle },
        { label: "Llaves SSH…", icon: <KeySquare size={14} />, onClick: () => setDialog({ kind: "keys", user: u }), disabled: readOnly && u.name !== me },
        ...(ctAccess
          ? [{ label: "Contenedores…", icon: <Boxes size={14} />, onClick: () => setDialog({ kind: "containers", user: u }), disabled: readOnly, title: roTitle }]
          : []),
        "sep",
        u.locked
          ? { label: "Desbloquear", icon: <LockOpen size={14} />, onClick: () => setDialog({ kind: "lock", user: u, lock: false }), disabled: readOnly, title: roTitle }
          : {
              label: "Bloquear",
              icon: <Lock size={14} />,
              onClick: () => setDialog({ kind: "lock", user: u, lock: true }),
              disabled: readOnly || !!prot,
              title: prot ?? roTitle,
            },
        {
          label: "Eliminar…",
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => setDialog({ kind: "delete", user: u }),
          disabled: readOnly || !!prot,
          title: prot ?? roTitle,
        },
      ];
    },
    [me, readOnly, ctAccess],
  );

  const onContext = useCallback((e: MouseEvent, u: UserRow) => setMenu({ x: e.clientX, y: e.clientY, user: u }), []);
  const selProt = sel ? protectedReason(sel.name, me) : null;
  const ctDialog = dialog?.kind === "containers" ? ctAccess?.get(dialog.user.name) : undefined;

  return (
    <div className="adm-pane">
      <div className="adm-toolbar">
        <div className="adm-search">
          <Search size={13} />
          <input
            className="input"
            placeholder="Buscar usuario, nombre, grupo o UID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar usuarios"
          />
        </div>
        <label className="checkbox adm-check">
          <input type="checkbox" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
          Mostrar cuentas del sistema
          {!showSystem && hiddenSystem > 0 && <span className="faint">({hiddenSystem})</span>}
        </label>
        <div className="adm-spacer" />
        <div className="adm-actions" aria-label="Acciones del usuario seleccionado">
          <button className="btn btn-sm" disabled={!sel || readOnly} onClick={() => sel && setDialog({ kind: "edit", user: sel })}>
            <Pencil size={13} /> Editar
          </button>
          <button
            className="btn btn-sm"
            disabled={!sel || (readOnly && sel.name !== me)}
            onClick={() => sel && setDialog({ kind: "keys", user: sel })}
          >
            <KeySquare size={13} /> Llaves SSH
          </button>
          {ctAccess && (
            <button
              className="btn btn-sm"
              disabled={!sel || readOnly}
              title={readOnly ? "Necesitas root o sudo" : "Ver y dar o quitar permiso para usar contenedores (Podman, Docker)"}
              onClick={() => sel && setDialog({ kind: "containers", user: sel })}
            >
              <Boxes size={13} /> Contenedores
            </button>
          )}
          <button
            className="btn btn-sm"
            disabled={!sel || readOnly || (!sel.locked && !!selProt)}
            title={sel && !sel.locked ? (selProt ?? undefined) : undefined}
            onClick={() => sel && setDialog({ kind: "lock", user: sel, lock: !sel.locked })}
          >
            {sel?.locked ? <LockOpen size={13} /> : <Lock size={13} />}
            {sel?.locked ? "Desbloquear" : "Bloquear"}
          </button>
          <button
            className="btn btn-sm adm-btn-danger-soft"
            disabled={!sel || readOnly || !!selProt}
            title={selProt ?? undefined}
            onClick={() => sel && setDialog({ kind: "delete", user: sel })}
          >
            <Trash2 size={13} /> Eliminar
          </button>
        </div>
        {onOpenVisibility && (
          <button
            className="btn btn-sm"
            title="Ver qué pueden ver o alcanzar tus usuarios sin sudo (túneles, 127.0.0.1, procesos, carpetas y Docker)"
            onClick={onOpenVisibility}
          >
            <Eye size={13} /> Qué pueden ver
          </button>
        )}
        <button
          className="btn btn-sm"
          disabled={readOnly}
          title={readOnly ? "Necesitas root o sudo" : "Guardar usuarios de este servidor como servidores en SSHorus"}
          onClick={() => setDialog({ kind: "import" })}
        >
          <Import size={13} /> Añadir a SSHorus…
        </button>
        <button
          className="btn btn-sm"
          disabled={readOnly || !env}
          title="Usuario sin contraseña que solo entra con su llave SSH"
          onClick={() => setDialog({ kind: "create-key" })}
        >
          <KeyRound size={13} /> Nuevo usuario con clave…
        </button>
        <button className="btn btn-sm btn-primary" disabled={readOnly || !env} onClick={() => setDialog({ kind: "create" })}>
          <UserPlus size={13} /> Crear usuario
        </button>
      </div>

      {sel && selWarning && (
        <div className="adm-note adm-note-warn">
          «{sel.name}» entra solo con llave: {selWarning}.
        </div>
      )}
      <VirtualTable
        label="Usuarios"
        columns={columns}
        rows={rows}
        rowKey={(u) => u.name}
        selected={selected}
        onSelect={setSelected}
        onActivate={(u) => !readOnly && setDialog({ kind: "edit", user: u })}
        onContextMenu={onContext}
        onKey={(e, u) => {
          if (e.key === "Delete" && !readOnly && !protectedReason(u.name, me)) {
            e.preventDefault();
            setDialog({ kind: "delete", user: u });
          }
        }}
        rowClass={(u) => (states.get(u.name)?.kind === "locked" ? "adm-row-muted" : "")}
        placeholder={<span>{query ? "Ningún usuario coincide con la búsqueda" : "No hay usuarios que mostrar"}</span>}
      />
      <div className="adm-statusbar">
        {rows.length} {rows.length === 1 ? "usuario" : "usuarios"}
        {env && (
          <span className="faint">
            · comandos {env.toolset === "shadow" ? "shadow-utils (useradd, usermod…)" : "busybox (adduser, deluser…)"} · grupo de administración «
            {env.adminGroup}»
          </span>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={actions(menu.user)} onClose={() => setMenu(null)} />}

      {dialog?.kind === "create" && <UserDialog mode="create" onClose={() => setDialog(null)} onCreated={(n) => setSelected(n)} />}
      {dialog?.kind === "import" && <ImportUsersDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "create-key" && <KeyUserWizard onClose={() => setDialog(null)} onCreated={(n) => setSelected(n)} />}
      {dialog?.kind === "edit" && <UserDialog mode="edit" user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === "keys" && <KeysDialog user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === "containers" && ctInfo && ctDialog && (
        <ContainerAccessDialog user={dialog.user} info={ctInfo} access={ctDialog} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "lock" && env && (
        <PlanModal
          title={dialog.lock ? `Bloquear a ${dialog.user.name}` : `Desbloquear a ${dialog.user.name}`}
          plan={lockUserPlan(env, dialog.user.name, dialog.lock)}
          onCancel={() => setDialog(null)}
          onDone={() => setDialog(null)}
          runLabel={dialog.lock ? "Bloquear" : "Desbloquear"}
        >
          <p className="dialog-message">
            {dialog.lock
              ? "La contraseña de la cuenta quedará desactivada (no podrá entrar con contraseña). Las llaves SSH pueden seguir funcionando según la configuración del servidor."
              : "La cuenta podrá volver a entrar con su contraseña."}
          </p>
        </PlanModal>
      )}
      {dialog?.kind === "delete" && env && <DeleteUserDialog user={dialog.user} onClose={() => setDialog(null)} />}
    </div>
  );
}

function DeleteUserDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { env } = useAdmin();
  const [removeHome, setRemoveHome] = useState(false);
  if (!env) return null;
  return (
    <PlanModal
      title={`Eliminar a ${user.name}`}
      plan={deleteUserPlan(env, user.name, removeHome)}
      confirmWord={user.name}
      onCancel={onClose}
      onDone={onClose}
      runLabel="Eliminar"
    >
      <p className="dialog-message">
        Se eliminará la cuenta <strong>{user.name}</strong>
        {user.fullName ? ` (${user.fullName})` : ""}. Esta acción no se puede deshacer.
      </p>
      <label className="checkbox adm-check adm-mb">
        <input type="checkbox" checked={removeHome} onChange={(e) => setRemoveHome(e.target.checked)} />
        Borrar también su carpeta personal (<span className="mono">{user.home}</span>) y su correo
      </label>
    </PlanModal>
  );
}
