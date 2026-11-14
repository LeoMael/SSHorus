// Copiar al portapapeles con aviso.
import { clipboard } from "../../lib/clipboard";
import { toast } from "../../stores/toasts";

export async function copyText(text: string, okMessage: string): Promise<void> {
  try {
    await clipboard.write(text);
    toast.success(okMessage);
  } catch (e) {
    toast.error("No se pudo copiar", e);
  }
}
