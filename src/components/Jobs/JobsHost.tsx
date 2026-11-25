// Tareas en segundo plano: lo monta App una vez (la esquina y, si está abierta, la vista grande).
import { useJobs } from "../../stores/jobs";
import { JobCenter } from "./JobCenter";
import { JobsCorner } from "./JobsCorner";

export function JobsHost() {
  const center = useJobs((s) => s.center);
  return (
    <>
      <JobsCorner />
      {center && <JobCenter />}
    </>
  );
}
