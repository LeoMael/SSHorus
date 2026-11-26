// Pruebas de los avisos: botón de acción opcional, cerrar y parar la cuenta atrás.
import { toast, useToasts } from "./toasts";

let passed = 0;
function eq<T>(got: T, want: T, what: string) {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: esperaba ${JSON.stringify(want)}, llegó ${JSON.stringify(got)}`);
  passed++;
}

const st = () => useToasts.getState();

const plain = toast.success("Guardado", "perfil.json");
eq(st().toasts.find((t) => t.id === plain)?.action, undefined, "sin botón, como siempre");

let clicked = 0;
const withBtn = toast.info("Tarea terminada", undefined, { action: { label: "Ver", onClick: () => clicked++ } });
const t = st().toasts.find((x) => x.id === withBtn);
eq(t?.action?.label, "Ver", "lleva su botón");
t?.action?.onClick();
eq(clicked, 1, "el botón llama a su función");

const err = toast.error("No se pudo", new Error("sin red"));
eq(st().toasts.find((x) => x.id === err)?.message, "sin red", "el error se convierte en texto");

st().hold(withBtn, true);
st().hold(9999, true);
eq(st().toasts.length, 3, "parar uno que no existe no cambia nada");

for (const id of [plain, withBtn, err]) st().dismiss(id);
eq(st().toasts.length, 0, "cerrar quita el aviso (y su cuenta atrás)");
st().hold(withBtn, false);

console.log(`avisos: ${passed} pruebas correctas`);
