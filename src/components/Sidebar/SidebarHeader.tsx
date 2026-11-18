// Cabecera de la barra lateral: logo, botón «Nuevo» y accesos (varios servidores, GitHub, ajustes).
import { ChevronDown, GitBranch, Plus, Settings as SettingsIcon, SquareTerminal } from "lucide-react";
import { openMultiRun } from "../../features/multirun/store";
import { SSH_CONFIG_LABEL } from "../../lib/platform";
import { useUi } from "../../stores/ui";
import { openGitHub } from "../GitHub";
import { Logo } from "../ui/Logo";

interface Props {
  onNewMenu: (button: HTMLElement) => void;
  /** Sin servidores guardados: no hay dónde ejecutar comandos. */
  noServers: boolean;
}

export function SidebarHeader({ onNewMenu, noServers }: Props) {
  const openSettings = useUi((s) => s.openSettings);
  return (
    <div className="sb-header">
      <Logo size={20} withName className="sb-title" />
      <div className="sb-header-actions">
        <button
          className="sb-new-btn"
          title={`Nuevo servidor o proyecto, importar o exportar ${SSH_CONFIG_LABEL}`}
          aria-haspopup="menu"
          onClick={(e) => onNewMenu(e.currentTarget)}
        >
          <Plus size={14} /> Nuevo <ChevronDown size={12} />
        </button>
        <button
          className="icon-btn"
          title="Ejecutar un comando en varios servidores a la vez"
          aria-label="Ejecutar en varios servidores"
          disabled={noServers}
          onClick={() => openMultiRun()}
        >
          <SquareTerminal size={15} />
        </button>
        <button
          className="icon-btn"
          title="GitHub: llaves, repositorios, despliegues y sincronizar"
          aria-label="GitHub"
          onClick={() => openGitHub()}
        >
          <GitBranch size={15} />
        </button>
        <button className="icon-btn" title="Ajustes" aria-label="Ajustes" onClick={openSettings}>
          <SettingsIcon size={15} />
        </button>
      </div>
    </div>
  );
}
