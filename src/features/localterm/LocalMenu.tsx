// Menú «Este equipo»: terminal local y los asistentes de IA (tabla ASSISTANTS) en la carpeta elegida.
import { useEffect, useState } from "react";
import { Bot, FolderOpen, Settings, SquareTerminal } from "lucide-react";
import { localTerm, type AiTool, type AiToolInfo } from "../../api/localterm";
import { PopupMenu } from "../../components/ui/PopupMenu";
import { useSettings } from "../../stores/settings";
import { chooseFolder, launchAssistant, openLocalAiSettings, openLocalTerminal } from "./launch";
import { ASSISTANTS } from "./logic";
import "./LocalTerm.css";

export function LocalMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const cwd = useSettings((s) => s.settings.localAi.lastCwd);
  const [info, setInfo] = useState<AiToolInfo[] | null>(null);

  useEffect(() => {
    let alive = true;
    localTerm
      .detect()
      .then((r) => alive && setInfo(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const hint = (tool: AiTool) => {
    const i = info?.find((x) => x.tool === tool);
    if (!i) return null;
    return i.installed ? null : <span className="lt-menu-hint">instalar…</span>;
  };

  return (
    <PopupMenu x={x} y={y} onClose={onClose} minWidth={250}>
      <div className="lt-menu-head">
        <span>Este equipo · carpeta de trabajo</span>
        <span className="lt-menu-cwd mono" title={cwd ?? "Carpeta personal"}>
          {cwd ?? "Carpeta personal"}
        </span>
      </div>
      <button role="menuitem" onClick={run(() => openLocalTerminal())}>
        <SquareTerminal size={14} /> Terminal local
      </button>
      {ASSISTANTS.map((a) => (
        <button
          key={a.tool}
          role="menuitem"
          onClick={run(() => void launchAssistant(a.tool))}
          title={`Abre ${a.label} con el contexto de SSHorus.${a.limits ? ` ${a.limits}` : ""}`}
        >
          <Bot size={14} /> {a.label} {hint(a.tool) ?? (a.limitsTag && <span className="lt-menu-hint">{a.limitsTag}</span>)}
        </button>
      ))}
      <hr />
      <button role="menuitem" onClick={run(() => void chooseFolder())}>
        <FolderOpen size={14} /> Cambiar carpeta…
      </button>
      <button role="menuitem" onClick={run(openLocalAiSettings)}>
        <Settings size={14} /> Qué contexto recibe la IA…
      </button>
    </PopupMenu>
  );
}
