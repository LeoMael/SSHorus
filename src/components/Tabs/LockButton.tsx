// Candado de la barra de pestañas: bloquear, cambiar el PIN o la contraseña, o ir a Ajustes → Seguridad.
// Sin protección: «Proteger con PIN o contraseña».
import { useCallback, useState } from "react";
import { KeyRound, Lock, LockOpen, Settings, ShieldCheck } from "lucide-react";
import { lockNow, openPinDialog, useLock } from "../../features/lock/lockStore";
import { secretWords } from "../../features/lock/secretKind";
import { useShortcutText } from "../../features/shortcuts/shortcuts";
import { openSettingsAt } from "../Settings/settingsNav";
import { PopupMenu } from "../ui/PopupMenu";

export function LockButton() {
  const enabled = useLock((s) => !!s.status?.enabled);
  const words = secretWords(useLock((s) => s.status?.pinKind));
  const title = enabled ? "Bloqueo" : "Proteger con PIN o contraseña";
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const lockKeys = useShortcutText("app.lock");
  const close = useCallback(() => setMenu(null), []);
  const run = (f: () => void) => () => {
    close();
    f();
  };

  return (
    <>
      <button
        className={`icon-btn tabs-side-btn lock-btn${enabled ? " on" : ""}`}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(menu ? null : { x: r.right - 220, y: r.bottom + 4 });
        }}
      >
        {enabled ? <Lock size={16} /> : <LockOpen size={16} />}
      </button>
      {menu && (
        <PopupMenu x={menu.x} y={menu.y} onClose={close} minWidth={220}>
          {enabled ? (
            <>
              <button role="menuitem" onClick={run(() => void lockNow())}>
                <Lock size={14} /> <span className="tabs-menu-name">Bloquear ahora</span>
                <span className="tabs-menu-host">{lockKeys}</span>
              </button>
              <button role="menuitem" onClick={run(() => openPinDialog("change"))}>
                <KeyRound size={14} /> Cambiar {words.noun}
              </button>
            </>
          ) : (
            <button role="menuitem" onClick={run(() => openPinDialog("setup"))}>
              <ShieldCheck size={14} /> Proteger con PIN o contraseña
            </button>
          )}
          <hr />
          <button role="menuitem" onClick={run(() => openSettingsAt("security"))}>
            <Settings size={14} /> Ajustes de seguridad
          </button>
        </PopupMenu>
      )}
    </>
  );
}
