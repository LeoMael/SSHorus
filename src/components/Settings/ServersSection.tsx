// Ajustes → Servidores: exportar y mantener sincronizada la configuración de ssh del equipo.
import { useState } from "react";
import { FileOutput } from "lucide-react";
import { SettingGroup, SettingRow as Row, Switch as Toggle } from "../ui/SettingsKit";
import { profiles } from "../../api/profiles";
import { toast } from "../../stores/toasts";
import { SSH_CONFIG_LABEL } from "../../lib/platform";
import { checkSshAliasesBeforeExport } from "../../features/sshAliases";
import { useSetting } from "./useSetting";

export function ServersSection() {
  const [sync, setSync] = useSetting("sshConfigSync");
  const [busy, setBusy] = useState(false);

  const exportNow = async (): Promise<boolean> => {
    if (!(await checkSshAliasesBeforeExport())) return false;
    setBusy(true);
    try {
      const r = await profiles.exportSshConfig();
      toast.success(
        r.count === 1 ? `1 servidor exportado a ${r.path}` : `${r.count} servidores exportados a ${r.path}`,
        "Ya puedes usar «ssh <alias>» desde cualquier terminal.",
      );
      return true;
    } catch (e) {
      toast.error(`No se pudo exportar a ${SSH_CONFIG_LABEL}`, e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (v: boolean) => {
    if (!v) {
      setSync(false);
      return;
    }
    if (await exportNow()) setSync(true);
  };

  return (
    <>
      <SettingGroup>
        <Row label={`Mantener ${SSH_CONFIG_LABEL} sincronizado`} hint="Para usar tus servidores con ssh, scp, VS Code o Claude Code.">
          <Toggle checked={sync} onChange={(v) => void onToggle(v)} label={`Mantener ${SSH_CONFIG_LABEL} sincronizado`} />
        </Row>
        <Row label={`Exportar a ${SSH_CONFIG_LABEL}`} hint="La primera vez guarda una copia de seguridad.">
          <button className="btn" onClick={() => void exportNow()} disabled={busy}>
            {busy ? <span className="spinner" /> : <FileOutput size={14} />} Exportar ahora
          </button>
        </Row>
      </SettingGroup>
    </>
  );
}
