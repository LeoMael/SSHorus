// «Historial» de un servidor: todo lo que se hizo en él desde SSHorus, en una línea de tiempo filtrable.
// Junta Administración, el asistente de IA, la Biblioteca, «Ejecutar en varios servidores», las tareas en
// segundo plano, las auditorías, el escáner y (si se activó) lo escrito en la terminal.
import { useCallback, useMemo, useState } from "react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, History, Trash2 } from "lucide-react";
import { localfs } from "../../api/localfs";
import { serverHistory } from "../../api/serverHistory";
import {
  closeServerHistory,
  countBySource,
  exportFileName,
  filterTimeline,
  historyToJson,
  historyToText,
  logsTerminal,
  setTerminalLogServer,
  useTerminalLogPrefs,
  type TimelineItem,
  type TimelineSource,
} from "../../features/serverHistory";
import { useProfiles } from "../../stores/profiles";
import { openSettingsAt } from "../../stores/settingsNav";
import { toast } from "../../stores/toasts";
import { AdmModal } from "../ui/AdmModal";
import { confirmDialog } from "../ui/dialogs";
import { openServerAudit } from "../ProjectAudit/openServerAudit";
import { HistoryFilters } from "./HistoryFilters";
import { HistoryRow } from "./HistoryRow";
import { useTimeline } from "./useTimeline";
import "./ServerHistory.css";

/** Filas que se pintan de golpe («Ver más» enseña otras tantas). */
const PAGE = 200;

export function ServerHistoryDialog({ serverId }: { serverId: string }) {
  const server = useProfiles((s) => s.servers.find((x) => x.id === serverId));
  const name = server?.name ?? "Servidor";
  const { items, problems, loading, reload } = useTimeline(serverId);
  const [text, setText] = useState("");
  const [sources, setSources] = useState<ReadonlySet<TimelineSource>>(new Set());
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const prefs = useTerminalLogPrefs();

  const visible = useMemo(() => filterTimeline(items, { sources, text, onlyErrors }), [items, sources, text, onlyErrors]);
  const counts = useMemo(() => countBySource(items), [items]);

  const toggle = useCallback((key: string) => {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }, []);

  const toggleSource = (s: TimelineSource | null) => {
    setShown(PAGE);
    if (!s) return setSources(new Set());
    const n = new Set(sources);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    setSources(n);
  };

  const openReport = useCallback(
    (_item: TimelineItem) => {
      if (!server) return;
      closeServerHistory();
      void openServerAudit(server);
    },
    [server],
  );

  const exportAs = async (format: "txt" | "json") => {
    let path: string | null;
    try {
      path = await saveFileDialog({
        title: "Exportar historial",
        defaultPath: exportFileName(name, format),
        filters: [{ name: format === "json" ? "JSON" : "Texto", extensions: [format] }],
      });
    } catch (e) {
      toast.error("No se pudo abrir el diálogo para guardar", e);
      return;
    }
    if (!path) return;
    if (!path.toLowerCase().endsWith(`.${format}`)) path += `.${format}`;
    try {
      await localfs.writeText(path, format === "json" ? historyToJson(visible, name) : historyToText(visible, name));
      toast.success("Historial exportado", path);
    } catch (e) {
      toast.error("No se pudo exportar el historial", e);
    }
  };

  const clearOwn = async () => {
    const ok = await confirmDialog({
      title: "¿Borrar comandos y tareas?",
      message:
        "Se borra lo que guarda este historial de este servidor: lo escrito en la terminal, la Biblioteca, «Ejecutar en varios servidores» y las tareas. Administración, el asistente de IA y las auditorías tienen su propio historial y no se tocan.",
      confirmText: "Borrar",
      danger: true,
    });
    if (!ok) return;
    try {
      await serverHistory.clear(serverId);
      reload();
    } catch (e) {
      toast.error("No se pudo borrar el historial", e);
    }
  };

  const goSettings = () => {
    closeServerHistory();
    openSettingsAt("terminal");
  };

  const termOn = logsTerminal(prefs, serverId);
  return (
    <AdmModal title={`Historial · ${name}`} onClose={closeServerHistory} width="min(940px, 94vw)" className="sh-modal">
      <div className="modal-body sh-wrap">
        <HistoryFilters
          text={text}
          onText={(t) => {
            setText(t);
            setShown(PAGE);
          }}
          sources={sources}
          onToggleSource={toggleSource}
          counts={counts}
          onlyErrors={onlyErrors}
          onOnlyErrors={setOnlyErrors}
          onExport={(f) => void exportAs(f)}
          canExport={visible.length > 0}
          onReload={reload}
        />
        {problems.map((p) => (
          <div key={p} className="sh-problem">
            <AlertTriangle size={13} /> {p}
          </div>
        ))}
        {visible.length === 0 ? (
          <div className="empty-state sh-empty">
            <History size={22} />
            <span>{loading ? "Leyendo el historial…" : items.length ? "Nada coincide con el filtro." : "Todavía no hay nada hecho en este servidor desde SSHorus."}</span>
          </div>
        ) : (
          <ul className="sh-list" aria-label="Historial del servidor">
            {visible.slice(0, shown).map((i) => (
              <HistoryRow key={i.key} item={i} open={open.has(i.key)} onToggle={toggle} onOpenReport={openReport} />
            ))}
            {visible.length > shown && (
              <li className="sh-more">
                <button className="btn btn-sm" onClick={() => setShown((n) => n + PAGE)}>
                  Ver más ({visible.length - shown})
                </button>
              </li>
            )}
          </ul>
        )}
        <div className="sh-foot">
          <label className="sh-check" title={prefs.all ? "Activado para todos los servidores en Ajustes → Terminal" : undefined}>
            <input type="checkbox" checked={termOn} disabled={prefs.all} onChange={(e) => setTerminalLogServer(serverId, e.target.checked)} />
            Guardar los comandos que escribo en la terminal de este servidor
          </label>
          <button className="sh-link" onClick={goSettings}>
            {prefs.all ? "Activado para todos (Ajustes)" : "Para todos…"}
          </button>
          <div className="sh-spacer" />
          <button className="btn btn-sm" onClick={() => void clearOwn()}>
            <Trash2 size={13} /> Borrar comandos y tareas
          </button>
        </div>
        <div className="sh-note faint">
          Se guarda solo en este equipo. Nunca se guarda lo escrito tras un aviso de contraseña, y las contraseñas guardadas y
          las llaves se tapan. El asistente de IA no puede leer este historial.
        </div>
      </div>
    </AdmModal>
  );
}
