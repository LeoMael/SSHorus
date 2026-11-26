// Acciones sobre contenedores (una fila o una selección): iniciar, parar, reiniciar, eliminar, renombrar,
// ver logs y el menú de cada fila. Lleva la cuenta de las filas ocupadas mientras se ejecuta algo.
import { useCallback, useState } from "react";
import { Copy, FileSearch, Pause, Pencil, Play, Power, RotateCw, ScrollText, Square, TerminalSquare, Trash2 } from "lucide-react";
import {
  containerAction,
  execShellCmd,
  logsCmd,
  removeContainers,
  renameContainer,
  stateTone,
  validateObjName,
  withOwner,
  type Container,
  type ContainerAction,
} from "../../features/containers";
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";
import { promptDialog } from "../ui/dialogs";
import type { MenuItem } from "../ui/ContextMenu";
import type { CtContextValue } from "./context";
import { askAutostart, autostartMenuLabel } from "./Autostart";
import { containerRowKey, isContainerUp } from "./ContainersTable";

const ACTION_TEXT: Record<ContainerAction, { done: string; verb: string }> = {
  start: { done: "Contenedor iniciado", verb: "Iniciar" },
  stop: { done: "Contenedor parado", verb: "Parar" },
  restart: { done: "Contenedor reiniciado", verb: "Reiniciar" },
  pause: { done: "Contenedor en pausa", verb: "Pausar" },
  unpause: { done: "Contenedor reanudado", verb: "Reanudar" },
};

export function copy(text: string, what = "Copiado") {
  clipboard.write(text).then(
    () => toast.success(what, text),
    (e) => toast.error("No se pudo copiar", e),
  );
}

/** `clearSelection`: se llama al terminar una acción en lote revisada (parar, reiniciar, eliminar). */
export function useContainerActions(ct: CtContextValue, clearSelection: () => void) {
  const { engine, autostart: auto } = ct;
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const setBusyIds = (ids: string[], on: boolean) =>
    setBusy((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  const { run, reload, perOwner } = ct;
  const direct = useCallback(
    async (action: ContainerAction, cs: Container[]) => {
      const ids = cs.map(containerRowKey);
      setBusyIds(ids, true);
      const r = await run(perOwner(cs, (g) => containerAction(engine, action, g.map((c) => c.name || c.id))), 120);
      setBusyIds(ids, false);
      if (r.ok)
        toast.success(
          cs.length > 1 ? `${ACTION_TEXT[action].verb}: ${cs.length} contenedores` : ACTION_TEXT[action].done,
          cs.length === 1 ? cs[0].name : undefined,
        );
      else toast.error(`No se pudo ${ACTION_TEXT[action].verb.toLowerCase()}`, r.error ?? undefined);
      await reload("containers");
    },
    [run, reload, perOwner, engine],
  );

  const names = (cs: Container[]) => (
    <ul className="ct-list">
      {cs.slice(0, 12).map((c) => (
        <li key={containerRowKey(c)}>
          <span className={`ct-dot ct-${stateTone(c.state)}`} /> <strong>{c.name}</strong> <span className="faint">{c.image}</span>
          {ct.allOwners && <span className="ct-tag">{ct.ownerLabel(c.owner)}</span>}
        </li>
      ))}
      {cs.length > 12 && <li className="faint">… y {cs.length - 12} más</li>}
    </ul>
  );

  const confirmAction = (action: "stop" | "restart", cs: Container[]) => {
    ct.review({
      title: `${ACTION_TEXT[action].verb} ${cs.length > 1 ? `${cs.length} contenedores` : `«${cs[0].name}»`}`,
      message:
        action === "stop"
          ? "Se enviará la señal de parada; si no termina en 10 segundos se fuerza."
          : "Se parará y se volverá a arrancar. Los servicios dejarán de responder unos segundos.",
      details: () => names(cs),
      build: () => ct.perOwner(cs, (g) => containerAction(engine, action, g.map((c) => c.name || c.id))),
      runLabel: ACTION_TEXT[action].verb,
      success: cs.length > 1 ? `${ACTION_TEXT[action].verb}: ${cs.length} contenedores` : ACTION_TEXT[action].done,
      reload: ["containers"],
      onDone: clearSelection,
    });
  };

  const confirmRemove = (cs: Container[]) => {
    const anyRunning = cs.some((c) => isContainerUp(c) || c.state === "paused");
    ct.review({
      title: cs.length > 1 ? `Eliminar ${cs.length} contenedores` : `Eliminar «${cs[0].name}»`,
      message: "Se borra el contenedor y todo lo que tenga dentro que no esté en un volumen o carpeta montada. No se puede deshacer.",
      details: () => names(cs),
      options: [
        { key: "force", label: "Forzar (parar si está en marcha)", hint: anyRunning ? "Hay contenedores en marcha" : undefined, initial: anyRunning },
        { key: "volumes", label: "Borrar también sus volúmenes anónimos (-v)" },
      ],
      build: (o) => ct.perOwner(cs, (g) => removeContainers(engine, g.map((c) => c.name || c.id), { force: !!o.force, volumes: !!o.volumes })),
      danger: true,
      runLabel: "Eliminar",
      success: cs.length > 1 ? `${cs.length} contenedores eliminados` : `Contenedor «${cs[0].name}» eliminado`,
      reload: ["containers"],
      onDone: clearSelection,
    });
  };

  const rename = async (c: Container) => {
    const name = await promptDialog({
      title: `Renombrar «${c.name}»`,
      label: "Nuevo nombre",
      initial: c.name,
      confirmText: "Renombrar",
      validate: (v) => validateObjName(v.trim()) ?? (v.trim() === c.name ? "Es el mismo nombre" : null),
    });
    if (!name) return;
    setBusyIds([containerRowKey(c)], true);
    const r = await ct.run([withOwner(renameContainer(engine, c.id, name.trim()), c.owner)], 30);
    setBusyIds([containerRowKey(c)], false);
    if (r.ok) toast.success("Contenedor renombrado", `${c.name} → ${name.trim()}`);
    else toast.error("No se pudo renombrar", r.error ?? undefined);
    await ct.reload("containers");
  };

  const openLogs = (c: Container) =>
    ct.openLogs({
      title: ct.allOwners ? `Logs de «${c.name}» (${ct.ownerLabel(c.owner)})` : `Logs de «${c.name}»`,
      build: (tail, ts) => withOwner(logsCmd(engine, c.name || c.id, tail, { timestamps: ts }), c.owner),
      follow: (tail) => withOwner(logsCmd(engine, c.name || c.id, tail, { follow: true }), c.owner),
    });

  const autostartItem = (c: Container): MenuItem => {
    const info = auto.infoOf(c);
    const { on, label } = autostartMenuLabel(info);
    return {
      label,
      icon: <Power size={13} />,
      onSelect: () => askAutostart(ct, auto, on, [c]),
      disabled: !info,
      title: info ? info.why.join("\n") : auto.loading ? "Leyendo si arranca solo…" : "No se pudo saber si arranca solo",
    };
  };

  const rowMenu = (c: Container): MenuItem[] => [
    isContainerUp(c)
      ? { label: "Parar", icon: <Square size={13} />, onSelect: () => confirmAction("stop", [c]) }
      : { label: "Iniciar", icon: <Play size={13} />, onSelect: () => void direct(c.state === "paused" ? "unpause" : "start", [c]) },
    { label: "Reiniciar", icon: <RotateCw size={13} />, onSelect: () => confirmAction("restart", [c]), disabled: !isContainerUp(c) && c.state !== "paused" },
    c.state === "paused"
      ? { label: "Reanudar", icon: <Play size={13} />, onSelect: () => void direct("unpause", [c]) }
      : { label: "Pausar", icon: <Pause size={13} />, onSelect: () => void direct("pause", [c]), disabled: c.state !== "running" },
    { sep: true },
    { label: "Ver logs", icon: <ScrollText size={13} />, onSelect: () => openLogs(c) },
    {
      label: "Terminal dentro",
      icon: <TerminalSquare size={13} />,
      onSelect: () => ct.toTerminal(withOwner(execShellCmd(engine, c.name || c.id), c.owner), true),
      disabled: c.state !== "running",
    },
    { label: "Inspeccionar", icon: <FileSearch size={13} />, onSelect: () => ct.openInspect(c) },
    { label: "Renombrar…", icon: <Pencil size={13} />, onSelect: () => void rename(c) },
    autostartItem(c),
    { sep: true },
    { label: "Copiar nombre", icon: <Copy size={13} />, onSelect: () => copy(c.name, "Nombre copiado") },
    { label: "Copiar ID", icon: <Copy size={13} />, onSelect: () => copy(c.id, "ID copiado") },
    { sep: true },
    { label: "Eliminar…", icon: <Trash2 size={13} />, onSelect: () => confirmRemove([c]), danger: true },
  ];

  return { busy, direct, confirmAction, confirmRemove, openLogs, rowMenu };
}
