// Confirmación de «Reiniciar ahora»: qué servidor, qué se corta y el comando exacto.
import { confirmDialog } from "../../components/ui/dialogs";
import "./Reboot.css";

export function confirmReboot(o: { serverName: string; command: string; tabs: number }): Promise<boolean> {
  return confirmDialog({
    title: `¿Reiniciar «${o.serverName}»?`,
    message: (
      <div className="rb-confirm">
        <p>
          El servidor se apaga y vuelve a arrancar. Mientras tanto <strong>se cortan sus servicios</strong> (webs, bases
          de datos, contenedores…) y <strong>las conexiones de todo el mundo</strong>.
        </p>
        <p>
          SSHorus espera hasta 5 minutos a que vuelva y reconecta {o.tabs > 1 ? `las ${o.tabs} pestañas` : "la pestaña"} de
          este servidor. Lo que corría en sus terminales (también en tmux) se pierde.
        </p>
        <div className="faint">
          Se ejecuta como root (<span className="mono">systemctl reboot</span>; sin systemd,{" "}
          <span className="mono">shutdown -r now</span> o <span className="mono">reboot</span>):
        </div>
        <pre className="rb-cmd">{o.command}</pre>
      </div>
    ),
    confirmText: "Reiniciar ahora",
    danger: true,
  });
}
