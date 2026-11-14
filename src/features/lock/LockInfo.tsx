// Textos fijos del bloqueo: qué se pierde si se olvida y «¿Qué protege?».
import { TriangleAlert } from "lucide-react";

/** Una línea sobre qué se pierde si se olvida el PIN o la contraseña. */
export function ForgetWarning() {
  return (
    <div className="lock-warn" title="Servidores, proyectos y ajustes no se pierden.">
      <TriangleAlert size={16} />
      <span>Si lo olvidas, se pierden las contraseñas guardadas.</span>
    </div>
  );
}

/** «¿Qué protege?» plegable. */
export function WhatItProtects() {
  return (
    <details className="lock-details">
      <summary>¿Qué protege?</summary>
      <ul>
        <li>
          Cifra las contraseñas guardadas (de conexión y de sudo) y el token de GitHub con tu PIN o contraseña y una
          llave de este equipo.
        </li>
        <li>Quien copie el archivo a otro PC no puede abrirlo.</li>
        <li>Tras 5 fallos hay que esperar, cada vez más (hasta 15 min). Nunca se borra nada por fallar.</li>
        <li>Al bloquear se tapan las ventanas; las conexiones siguen abiertas.</li>
        <li>No cifra servidores, ajustes ni tus llaves de ~/.ssh.</li>
      </ul>
    </details>
  );
}
