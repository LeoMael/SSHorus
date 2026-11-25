// «Por qué sigue apareciendo»: explicación de un hallazgo que no se va (en el detalle de la tabla), con
// lo que el informe sabe: kernel en uso y de arranque, qué traen los repositorios, de dónde viene.
// Funciones puras, sin React ni Tauri.
import type { Finding, Report } from "../../api/vulnscan";
import { distroFamily, packagesOf, targetOf } from "./fixCommand";
import { fromModule, noRepoText, repoFix, repoOffers } from "./repo";

/** Cómo mirar en el servidor qué versión ofrecen sus repositorios. */
function offerCommand(report: Report, f: Finding): string | null {
  const pkgs = packagesOf(f).join(" ");
  if (!pkgs) return null;
  switch (distroFamily(report)) {
    case "rpm-dnf":
      return `sudo dnf --refresh check-update ${pkgs}`;
    case "rpm-yum":
      return `sudo yum check-update ${pkgs}`;
    case "apt":
      return `sudo apt update && apt-cache policy ${pkgs}`;
    default:
      return null;
  }
}

function kernelWhy(report: Report): string[] {
  const h = report.host;
  const k = h.rebootKernel;
  if (h.bootKernel && k && !h.bootKernel.startsWith(k)) {
    return [`Ojo: el servidor arranca por defecto con ${h.bootKernel}, así que reiniciar no basta. Cámbialo: sudo grubby --set-default /boot/vmlinuz-${k}.${h.arch}`];
  }
  const rpm = distroFamily(report).startsWith("rpm");
  return [
    rpm
      ? "Si ya reiniciaste y sigue igual: compara «uname -r» con «rpm -q kernel-core» y mira con qué kernel arranca («sudo grubby --default-kernel»). Algunos VPS arrancan un kernel del proveedor."
      : "Si ya reiniciaste y sigue igual: compara «uname -r» con el kernel instalado más nuevo. Algunos VPS arrancan un kernel del proveedor.",
  ];
}

/** Párrafos cortos que explican por qué el hallazgo sigue en el informe. */
export function whyStill(report: Report, f: Finding): string[] {
  const t = targetOf(report, f);
  if (t?.kind === "image") {
    return ["Está dentro de una imagen de contenedor: actualizar los paquetes del servidor no la cambia. Usa «Actualizar imagen» (o vuelve a construirla) y recrea sus contenedores."];
  }
  if (t?.kind === "runtime" || f.upstream) {
    return [`«${f.package}» no viene de un paquete de la distro: actualizar el sistema no lo toca. Actualízalo desde donde lo instalaste.`];
  }
  if (f.needsReboot) {
    const k = f.fixed ?? report.host.rebootKernel ?? "nuevo";
    return [`El kernel corregido (${k}) ya está instalado, pero el servidor sigue usando el viejo (${report.host.kernel || "uname -r"}). Se va al reiniciar.`, ...kernelWhy(report)];
  }
  if (!f.hasFix) {
    return ["Todavía no hay versión corregida publicada para tu distro: no hay nada que instalar. Se irá cuando salga el arreglo y actualices."];
  }
  const cmd = offerCommand(report, f);
  const check = cmd ? [`Para verlo con los datos recién bajados: ${cmd}`] : [];
  switch (repoFix(report, f)) {
    case "no":
      return [
        `Aún no hay versión corregida en tus repositorios. ${noRepoText(report, f)}`,
        "Pasa cuando tu distro todavía no la publicó (Rocky y AlmaLinux suelen ir unos días detrás de Red Hat) o cuando la trae un repositorio que no tienes activado. Vuelve a comprobar en unos días.",
        ...(fromModule(f) ? ["El paquete es de un módulo de dnf: el arreglo puede estar en otro stream («dnf module list»)."] : []),
        ...check,
        "Si los repositorios sí la tienen y no se instala: revisa «exclude=» en /etc/dnf/dnf.conf y «dnf versionlock list».",
      ];
    case "yes":
      return [
        `Tus repositorios ya traen la versión corregida (${repoOffers(report, f).join(", ") || f.fixed}): pulsa «Arreglar».`,
        "Si ya la instalaste y sigue aquí, el informe es de antes: pulsa «Volver a comprobar».",
      ];
    default:
      return [
        `Instalada ${f.installed || "?"}; corregida en ${f.fixed ?? "una versión más nueva"}: hay que subir el paquete a esa versión o más.`,
        "Si «Arreglar» terminó sin cambiar la versión, tus repositorios aún no la tienen (dnf dice «Nothing to do»; apt, que ya está en su versión más reciente).",
        ...check,
        "Si ya la instalaste, pulsa «Volver a comprobar»: el informe es de antes.",
        ...(f.kernel ? kernelWhy(report) : []),
      ];
  }
}
