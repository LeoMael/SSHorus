import { useRef, type ReactNode } from "react";
import { CheckCircle2, Info, XCircle, X } from "lucide-react";
import { useToasts, type ToastAction, type ToastKind } from "../../stores/toasts";

const ICON: Record<ToastKind, typeof Info> = { success: CheckCircle2, error: XCircle, info: Info };

/**
 * Un aviso: icono, título, texto, botón de acción opcional y cerrar. Lo usan los avisos generales y los de
 * las tareas en segundo plano (que tienen su propia lista), para que se vean y se manejen igual.
 */
export function ToastCard(p: {
  kind: ToastKind;
  title: ReactNode;
  message?: string;
  action?: ToastAction;
  onClose: () => void;
  closeLabel?: string;
  className?: string;
  /** Ratón o foco dentro/fuera (para parar la cuenta atrás). */
  onHold?: (on: boolean) => void;
}) {
  const Icon = ICON[p.kind];
  const onHold = p.onHold;
  // Ratón y foco por separado: sacar el ratón con el foco aún dentro (o al revés) no reanuda la cuenta atrás.
  const inside = useRef({ mouse: false, focus: false });
  const hold =
    onHold &&
    ((what: "mouse" | "focus", on: boolean) => {
      inside.current[what] = on;
      onHold(inside.current.mouse || inside.current.focus);
    });
  return (
    <div
      className={`toast toast-${p.kind}${p.className ? ` ${p.className}` : ""}`}
      onMouseEnter={hold && (() => hold("mouse", true))}
      onMouseLeave={hold && (() => hold("mouse", false))}
      onFocus={hold && (() => hold("focus", true))}
      onBlur={
        hold &&
        ((e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold("focus", false);
        })
      }
    >
      <Icon size={18} />
      <div className="toast-text">
        <strong>{p.title}</strong>
        {p.message && <span>{p.message}</span>}
      </div>
      {p.action && (
        <button
          className="btn btn-sm toast-action"
          onClick={() => {
            p.action?.onClick();
            p.onClose();
          }}
        >
          {p.action.label}
        </button>
      )}
      <button className="icon-btn" onClick={p.onClose} aria-label={p.closeLabel ?? "Cerrar"}>
        <X size={14} />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const hold = useToasts((s) => s.hold);
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => (
        <ToastCard
          key={t.id}
          kind={t.kind}
          title={t.title}
          message={t.message}
          action={t.action}
          onClose={() => dismiss(t.id)}
          onHold={(on) => hold(t.id, on)}
        />
      ))}
    </div>
  );
}
