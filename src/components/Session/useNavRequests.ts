// Pedidos de otras partes de la app para mostrar algo en esta pestaña de servidor.
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useInfraNav } from "../../features/infra/store";
import { useAuditNav } from "../../features/audit/nav";
import { useVulnNav } from "../../features/vulnscan/nav";
import { useExplorerNav } from "../../features/fileExplorer/nav";
import { useJobNav } from "../../features/jobs/nav";
import { useDetachedEditors } from "../Editor/editorWindows";
import type { FixedTab } from "./fixedViews";

interface NavOpts {
  sessionId: string;
  showFixed: (id: FixedTab) => void;
  showFile: (path: string) => void;
  setFiles: Dispatch<SetStateAction<string[]>>;
}

export function useNavRequests({ sessionId, showFixed, showFile, setFiles }: NavOpts) {
  // «Ver vulnerabilidades» desde Contenedores → Imágenes: ir a Administración.
  const vulnNav = useVulnNav((s) => s.request);
  useEffect(() => {
    if (vulnNav?.sessionId === sessionId) showFixed("admin");
  }, [vulnNav, sessionId, showFixed]);

  // «Ver en…» desde el mapa: Contenedores o Administración (que abre su sub-pestaña).
  const infraNav = useInfraNav((s) => s.request);
  useEffect(() => {
    if (infraNav?.sessionId !== sessionId) return;
    if (infraNav.target.kind === "containers") {
      showFixed("containers");
      useInfraNav.getState().done(infraNav.seq);
    } else showFixed("admin");
  }, [infraNav, sessionId, showFixed]);

  // «Abrir en Administración» desde «Auditar proyecto»: Administración (que abre Auditoría).
  const auditNav = useAuditNav((s) => s.request);
  useEffect(() => {
    if (auditNav?.sessionId === sessionId) showFixed("admin");
  }, [auditNav, sessionId, showFixed]);

  // «Abrir carpeta del proyecto» (Contenedores → Compose): ir a Archivos; el explorador va a la carpeta.
  const explorerNav = useExplorerNav((s) => s.request);
  useEffect(() => {
    if (explorerNav?.sessionId === sessionId) showFixed("files");
  }, [explorerNav, sessionId, showFixed]);

  // «Ir allí» o un botón de una tarea en segundo plano: el panel donde se lanzó.
  const jobNav = useJobNav((s) => s.request);
  useEffect(() => {
    if (jobNav?.sessionId === sessionId) showFixed(jobNav.pane);
  }, [jobNav, sessionId, showFixed]);

  // Un archivo vuelve de su ventana con «Volver a la pestaña principal»: mostrarlo.
  const reveal = useDetachedEditors((s) => s.reveal);
  const revealSeen = useRef(0);
  useEffect(() => {
    if (!reveal || reveal.seq === revealSeen.current) return;
    revealSeen.current = reveal.seq;
    if (reveal.sessionId !== sessionId) return;
    setFiles((f) => (f.includes(reveal.path) ? f : [...f, reveal.path]));
    showFile(reveal.path);
  }, [reveal, sessionId, setFiles, showFile]);
}
