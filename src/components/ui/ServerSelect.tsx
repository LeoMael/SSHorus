// Selector de un servidor guardado (GitHub, llaves SSH…). value = ServerProfile.id.
import { useEffect } from "react";
import { useProfiles } from "../../stores/profiles";

export function ServerSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const servers = useProfiles((s) => s.servers);
  const load = useProfiles((s) => s.load);
  const loaded = useProfiles((s) => s.loaded);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Elige un servidor…</option>
      {servers.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.username}@{s.host})
        </option>
      ))}
    </select>
  );
}
