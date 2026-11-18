// Campo «Host» con sugerencias de los servidores guardados.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ServerProfile } from "../../api/types";
import { hostSuggestions, serverAddress } from "../serverMatches";

export function HostCombo({
  value,
  servers,
  selfId,
  onChange,
  onPick,
}: {
  value: string;
  servers: readonly ServerProfile[];
  selfId: string;
  onChange: (v: string) => void;
  onPick: (s: ServerProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  /** Al enfocar se ven todos; al escribir, solo los que coinciden. */
  const [filterOn, setFilterOn] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => hostSuggestions(servers, selfId), [servers, selfId]);
  const shown = useMemo(
    () => (filterOn && value.trim() ? hostSuggestions(servers, selfId, value) : all),
    [all, servers, selfId, value, filterOn],
  );
  const show = open && shown.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (hi >= 0) listRef.current?.children[hi]?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const pick = (s: ServerProfile) => {
    onPick(s);
    setOpen(false);
    setHi(-1);
  };

  return (
    <div className="cd-combo" ref={wrapRef}>
      <input
        id="cd-host"
        aria-labelledby="cd-host-label"
        className="input mono"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        placeholder="servidor.com o 192.168.1.10"
        role="combobox"
        aria-expanded={show}
        aria-controls="cd-host-list"
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setFilterOn(true);
          setOpen(true);
          setHi(-1);
        }}
        onFocus={() => {
          setFilterOn(false);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && shown.length) {
            e.preventDefault();
            e.stopPropagation();
            if (!open) {
              setOpen(true);
              setHi(0);
            } else setHi((h) => Math.min(shown.length - 1, h + 1));
          } else if (e.key === "ArrowUp" && show) {
            e.preventDefault();
            e.stopPropagation();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === "Enter" && show && hi >= 0 && shown[hi]) {
            // Elegir la sugerencia, no guardar el formulario.
            e.preventDefault();
            e.stopPropagation();
            pick(shown[hi]);
          } else if (e.key === "Escape" && show) {
            // Cerrar la lista sin cerrar el editor.
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {all.length > 0 && (
        <button
          type="button"
          className="cd-combo-btn"
          tabIndex={-1}
          title="Servidores guardados"
          aria-label="Ver servidores guardados"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setFilterOn(false);
            setOpen((o) => !o);
          }}
        >
          <ChevronDown size={14} />
        </button>
      )}
      {show && (
        <div className="cd-combo-list" id="cd-host-list" ref={listRef} role="listbox" aria-label="Servidores guardados">
          {shown.map((s, i) => {
            const sel = s.host.trim().toLowerCase() === value.trim().toLowerCase();
            return (
              <div
                key={s.id}
                role="option"
                aria-selected={sel}
                className={`cd-combo-item${i === hi ? " hi" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                onMouseEnter={() => setHi(i)}
              >
                <span className="cd-combo-name">{s.name || s.host}</span>
                <span className="mono faint">{serverAddress(s)}</span>
                {sel && <Check size={13} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
