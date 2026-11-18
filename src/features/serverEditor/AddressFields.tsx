// Host, puerto y usuario del servidor.
import type { ServerProfile } from "../../api/types";
import { HostCombo } from "./HostCombo";
import type { FormErrors, ServerFormFields } from "./serverForm";
import type { ClearError, SetFields } from "./useServerForm";

export function AddressFields({
  fields,
  set,
  errors,
  clearErr,
  servers,
  selfId,
}: {
  fields: ServerFormFields;
  set: SetFields;
  errors: FormErrors;
  clearErr: ClearError;
  servers: readonly ServerProfile[];
  selfId: string;
}) {
  return (
    <div className="cd-cols cd-cols-host">
      <div className="field-row">
        <div className="field cd-grow">
          <span id="cd-host-label">Host</span>
          <HostCombo
            value={fields.host}
            servers={servers}
            selfId={selfId}
            onChange={(v) => {
              set({ host: v });
              clearErr("host");
            }}
            onPick={(s) => {
              set({ host: s.host.trim(), port: String(s.port || 22) });
              clearErr("host");
              clearErr("port");
            }}
          />
          {errors.host && <div className="cd-err">{errors.host}</div>}
        </div>
        <label className="field cd-port">
          <span>Puerto</span>
          <input
            className="input mono"
            inputMode="numeric"
            value={fields.port}
            onChange={(e) => {
              set({ port: e.target.value.replace(/[^\d]/g, "") });
              clearErr("port");
            }}
          />
          {errors.port && <div className="cd-err">{errors.port}</div>}
        </label>
      </div>

      <label className="field">
        <span>Usuario</span>
        <input
          className="input mono"
          value={fields.username}
          spellCheck={false}
          autoCapitalize="off"
          placeholder="root"
          onChange={(e) => {
            set({ username: e.target.value });
            clearErr("username");
          }}
        />
        {errors.username && <div className="cd-err">{errors.username}</div>}
      </label>
    </div>
  );
}
