// Tipos de una muestra del servidor tal como sale de parseSample (sample.ts).

export interface CpuTicks {
  /** Suma de todos los campos de la línea "cpu" de /proc/stat. */
  total: number;
  /** idle + iowait. */
  idle: number;
  iowait: number;
  steal: number;
}

export interface MemInfo {
  totalKb: number;
  availableKb: number;
  freeKb: number;
  buffersKb: number;
  /** Cached + SReclaimable. */
  cachedKb: number;
  swapTotalKb: number;
  swapFreeKb: number;
}

export interface NetCounter {
  iface: string;
  rx: number;
  tx: number;
}

export interface DiskUsage {
  fs: string;
  mount: string;
  sizeKb: number;
  usedKb: number;
  availKb: number;
  /** Porcentaje usado (como lo muestra df: usado / (usado + disponible)). */
  pct: number;
}

export interface ProcStat {
  pid: number;
  ppid: number;
  comm: string;
  state: string;
  /** utime + stime, en ticks de reloj. */
  ticks: number;
  /** Arranque, en ticks desde el inicio del sistema. */
  start: number;
  /** Páginas residentes (null si no se pudo leer). */
  rssPages: number | null;
}

export interface SampleInfo {
  nproc: number | null;
  user: string | null;
  uid: number | null;
  pageSize: number | null;
  hz: number | null;
  docker: boolean;
  podman: boolean;
  /** /proc montado con hidepid: sin root, cada usuario solo ve sus propios procesos. */
  hidepid: boolean;
}

export interface RawSample {
  /** Hora local de la muestra (ms). */
  at: number;
  /** Segundos desde el arranque del servidor (/proc/uptime): reloj del servidor para las diferencias. */
  uptime: number | null;
  cpu: CpuTicks | null;
  mem: MemInfo | null;
  load: [number, number, number] | null;
  /** "en ejecución/total" de /proc/loadavg. */
  tasks: { running: number; total: number } | null;
  net: NetCounter[];
  disks: DiskUsage[];
  procs: ProcStat[];
  /** uid de cada pid pedido en esta muestra. */
  uids: Map<number, number>;
  /** uid → nombre (de /etc/passwd), solo en muestras completas. */
  users: Map<number, string>;
  /** Solo en muestras completas (la primera y cada cierto tiempo). */
  info: SampleInfo | null;
  /** La salida llegó entera (marca final presente). */
  complete: boolean;
  /** El servidor no tiene /proc (no es Linux). */
  noProc: boolean;
  /** pid del shell del muestreo. */
  selfPid: number | null;
  /** Todas las secciones, para quien añade las suyas (`extra`; p. ej. contenedores de cada proceso). */
  sections: Map<string, string[]>;
}
