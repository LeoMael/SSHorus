// Avisa a un componente cuando termina una tarea que le interesa (p. ej. para recargar un informe),
// aunque la tarea la lanzara un diálogo que ya se cerró.
import { useEffect, useRef } from "react";
import { onJobFinished, type Job } from "../../features/jobs";

export function useJobFinished(match: (job: Job) => boolean, cb: (job: Job) => void): void {
  const ref = useRef({ match, cb });
  useEffect(() => {
    ref.current = { match, cb };
  });
  useEffect(
    () =>
      onJobFinished((job) => {
        if (ref.current.match(job)) ref.current.cb(job);
      }),
    [],
  );
}
