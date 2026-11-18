// Diálogo «Nuevo servidor / Editar servidor»: une las secciones del formulario, la prueba de conexión y el guardado.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { PlugZap } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { sshAliases } from "../../api/profiles";
import type { ServerProfile } from "../../api/types";
import { useProfiles } from "../../stores/profiles";
import { useUi, type ServerEditorOptions } from "../../stores/ui";
import { toast } from "../../stores/toasts";
import { SSH_CONFIG_LABEL } from "../../lib/platform";
import { initialProjectFor, projectChanges } from "../projectServers";
import { findMatches } from "../serverMatches";
import type { TestOutcome } from "../serverTest";
import {
  buildServerProfile,
  connectionChanged,
  connectionErrors,
  hasErrors,
  initialConnKey,
  secretToSave,
  sudoFormState,
  sudoSecretToSave,
  testCredentials,
  testSignature,
  validateServerForm,
} from "./serverForm";
import { useServerForm } from "./useServerForm";
import { useSshAlias } from "./useSshAlias";
import { useSavedSecrets } from "./useSavedSecrets";
import { useConnectionTest, type TestReason } from "./useConnectionTest";
import { ProjectOnTop } from "./ProjectFields";
import { NameFields } from "./NameFields";
import { AddressFields } from "./AddressFields";
import { MatchNote } from "./MatchNote";
import { AuthFields } from "./AuthFields";
import { TestResult } from "./TestResult";
import { SudoField } from "./SudoField";
import { ExtraFields } from "./ExtraFields";

export function ServerEditor({
  initial,
  fromProjectId,
  onSaved,
  onClose,
}: {
  initial: ServerProfile | null;
  /** Abierto desde un proyecto (p. ej. «Añadir servidor nuevo…» en la barra lateral). */
  fromProjectId: string | null;
  onSaved?: ServerEditorOptions["onSaved"];
  onClose: () => void;
}) {
  const isNew = !initial || initial.id === "";
  const selfId = initial?.id ?? "";
  const projects = useProfiles((s) => s.projects);
  const servers = useProfiles((s) => s.servers);
  const saveServer = useProfiles((s) => s.saveServer);
  const saveProject = useProfiles((s) => s.saveProject);

  // Proyecto en el que empieza el selector y proyecto en el que está de verdad el servidor
  // (un servidor nuevo aún no está en ninguno).
  const [initialProjectId] = useState(() => initialProjectFor(projects, selfId, fromProjectId));
  const memberProjectId = isNew ? "" : initialProjectId;
  /** Con un proyecto de origen, el selector va arriba y se explica dónde quedará el servidor. */
  const showProjectOnTop = isNew && initialProjectId !== "";

  const { fields, set, errors, setErrors, clearErr } = useServerForm(initial, initialProjectId);
  const { host, port, username, auth, projectId } = fields;
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const alias = useSshAlias(selfId, fields.name, host);
  useEffect(() => firstRef.current?.focus(), [isNew, initial]);
  const { hasSecret, hasSudoSecret } = useSavedSecrets(isNew, initial);
  const sudoForm = sudoFormState(fields, isNew, hasSudoSecret);
  const savedState = { isNew, savedAuth: initial?.auth, hasSecret };
  const matches = useMemo(() => findMatches(servers, selfId, host, port, username), [servers, selfId, host, port, username]);

  const [savedConnKey] = useState(() => initialConnKey(initial));
  const connChanged = connectionChanged(fields, isNew, savedConnKey);
  const { testing, current, failedNow, testBoxRef, cancelTest, startTest } = useConnectionTest(testSignature(fields));

  const validate = () => validateServerForm(fields, alias.error);
  const buildServer = () => buildServerProfile(selfId, fields, sudoForm);

  /** Prueba la conexión con lo escrito (nada se guarda). null = datos incompletos o cancelada. */
  const runTest = async (why: TestReason): Promise<TestOutcome | null> => {
    const connErrors = connectionErrors(validate());
    if (hasErrors(connErrors)) {
      setErrors((old) => ({ ...old, ...connErrors }));
      return null;
    }
    return startTest(why, buildServer(), testCredentials(fields, savedState));
  };

  /** Guarda. Si cambiaron los datos de conexión, antes prueba la conexión (salvo `force`). */
  const save = async (force = false) => {
    if (testing) return;
    const e = validate();
    setErrors(e);
    if (hasErrors(e)) return;

    if (!force && connChanged) {
      // Si ya se probó con estos mismos datos no se repite; si no (o se canceló), se prueba ahora.
      const outcome = current && current.status !== "canceled" ? current : await runTest("save");
      // Fallo: el resultado queda a la vista con «Guardar de todos modos».
      if (!outcome || outcome.status !== "ok") return;
    }

    const server = buildServer();
    const newSecret = secretToSave(fields, savedState);
    const newSudoSecret = sudoSecretToSave(server.sudoMode, fields.sudoSecret, hasSudoSecret);

    setSaving(true);
    const saved = await saveServer(server, newSecret, newSudoSecret);
    if (!saved) {
      setSaving(false);
      return;
    }
    if (alias.changed) {
      try {
        await sshAliases.set({ [saved.id]: alias.value.trim() || null });
      } catch (err) {
        toast.error(`No se pudo guardar el alias de ${SSH_CONFIG_LABEL}`, err);
      }
    }
    for (const p of projectChanges(useProfiles.getState().projects, saved.id, memberProjectId, projectId)) {
      await saveProject(p);
    }
    setSaving(false);
    onClose();
    onSaved?.(saved, projectId);
  };

  const onEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      void save(failedNow);
    }
  };

  /** Escape / cerrar con una prueba en marcha: primero se cancela la prueba. */
  const close = () => {
    if (!cancelTest()) onClose();
  };

  /** Abre el servidor ya guardado que coincide (descarta lo escrito aquí). */
  const openExisting = (s: ServerProfile) => {
    cancelTest();
    useUi.getState().openServerEditor(s, { projectId: fromProjectId, onSaved });
  };
  /** Abierto desde un proyecto: añade a él el servidor ya guardado en vez de crear otro igual. */
  const addExistingToProject = async (s: ServerProfile, projectToAdd: string) => {
    const proj = useProfiles.getState().projects.find((x) => x.id === projectToAdd);
    if (!proj || proj.serverIds.includes(s.id)) return;
    cancelTest();
    await saveProject({ ...proj, serverIds: [...proj.serverIds, s.id] });
    onClose();
    onSaved?.(s, proj.id);
  };

  return (
    <Modal
      open
      title={isNew ? "Nuevo servidor" : "Editar servidor"}
      onClose={close}
      // Ancho para dos columnas; en ventanas pequeñas, como mucho el 94 % (y una sola columna).
      width="min(720px, 94vw)"
      footer={
        <>
          {testing ? (
            <button className="btn cd-footer-left" onClick={() => cancelTest()}>
              Cancelar prueba
            </button>
          ) : (
            <button
              className="btn cd-footer-left"
              onClick={() => void runTest("manual")}
              disabled={saving}
              title="Conecta con estos datos, sin guardar nada, y desconecta (máx. 10 s)"
            >
              <PlugZap size={14} /> Probar conexión
            </button>
          )}
          <button className="btn" onClick={close}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={() => void save(failedNow)} disabled={saving || testing !== null}>
            {saving || testing === "save" ? <span className="spinner cd-btn-spinner" /> : null}
            {testing === "save" ? "Probando conexión…" : failedNow ? "Guardar de todos modos" : "Guardar"}
          </button>
        </>
      }
    >
      <div className="cd-form" onKeyDown={onEnter}>
        {showProjectOnTop && <ProjectOnTop projects={projects} value={projectId} onChange={(id) => set({ projectId: id })} />}

        <NameFields
          name={fields.name}
          host={host}
          onName={(v) => set({ name: v })}
          alias={alias}
          onAliasEdit={() => clearErr("alias")}
          inputRef={firstRef}
        />

        <AddressFields fields={fields} set={set} errors={errors} clearErr={clearErr} servers={servers} selfId={selfId} />

        <MatchNote
          matches={matches}
          onOpen={openExisting}
          addTo={isNew && projectId ? projects.find((p) => p.id === projectId) ?? null : null}
          onAdd={(s, pid) => void addExistingToProject(s, pid)}
        />

        <AuthFields
          fields={fields}
          set={set}
          errors={errors}
          clearErr={clearErr}
          profileId={selfId}
          isNew={isNew}
          hasSecret={hasSecret}
        />

        <div ref={testBoxRef}>
          <TestResult testing={testing} outcome={current} auth={auth} onSaveAnyway={() => void save(true)} />
        </div>

        <SudoField fields={fields} set={set} sudoForm={sudoForm} profileId={selfId} hasSudoSecret={hasSudoSecret} />

        <ExtraFields fields={fields} set={set} projects={projects} showProject={!showProjectOnTop} />
      </div>
    </Modal>
  );
}
