// Horario de una línea de cron («0 3 * * *», «@daily»…): validarlo campo a campo y decirlo en palabras
// («Cada día a las 3:00»). Funciones puras, sin React ni Tauri.

interface FieldSpec {
  label: string;
  min: number;
  max: number;
  names?: string[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const FIELDS: FieldSpec[] = [
  { label: "minuto", min: 0, max: 59 },
  { label: "hora", min: 0, max: 23 },
  { label: "día del mes", min: 1, max: 31 },
  { label: "mes", min: 1, max: 12, names: MONTHS },
  { label: "día de la semana", min: 0, max: 7, names: DAYS },
];

const MONTH_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DAY_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const DAY_PL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados", "domingos"];

/** Atajos de cron y lo que significan. */
export const CRON_SPECIALS: Record<string, string> = {
  "@reboot": "Al encender el servidor",
  "@yearly": "Cada año, el 1 de enero a las 0:00",
  "@annually": "Cada año, el 1 de enero a las 0:00",
  "@monthly": "Cada mes, el día 1 a las 0:00",
  "@weekly": "Cada semana, el domingo a las 0:00",
  "@daily": "Cada día a las 0:00",
  "@midnight": "Cada día a las 0:00",
  "@hourly": "Cada hora, en punto",
};

type Item = { kind: "all"; step: number } | { kind: "range"; a: number; b: number; step: number };

function num(tok: string, f: FieldSpec): number | null {
  const lower = tok.toLowerCase();
  const byName = f.names?.indexOf(lower) ?? -1;
  if (byName >= 0) return byName + f.min;
  if (!/^\d{1,2}$/.test(tok)) return null;
  const n = Number(tok);
  return n >= f.min && n <= f.max ? n : null;
}

// Un campo: lista de «*», «*/n», «a», «a-b» o «a-b/n». Devuelve el error en palabras o los elementos.
function parseField(text: string, f: FieldSpec): Item[] | string {
  const out: Item[] = [];
  for (const part of text.split(",")) {
    const m = /^([^/]+)(?:\/(\d{1,2}))?$/.exec(part);
    if (!m) return `El ${f.label} «${part}» no se entiende`;
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1 || step > f.max) return `El salto «/${m[2]}» del ${f.label} no vale`;
    if (m[1] === "*") {
      out.push({ kind: "all", step });
      continue;
    }
    const [as, bs, extra] = m[1].split("-");
    if (extra !== undefined) return `El ${f.label} «${part}» no se entiende`;
    const a = num(as, f);
    const b = bs === undefined ? (m[2] === undefined ? a : f.max) : num(bs, f);
    if (a === null || b === null) return `El ${f.label} «${part}» está fuera de ${f.min}–${f.max}`;
    if (b < a) return `En el ${f.label} «${part}», el primero es mayor que el segundo`;
    out.push({ kind: "range", a, b, step });
  }
  return out;
}

export type CronCheck = { ok: true; text: string } | { ok: false; error: string };

/** Valida el horario (5 campos o un atajo «@…») y lo explica. */
export function describeSchedule(schedule: string): CronCheck {
  const s = schedule.trim();
  if (s.startsWith("@")) {
    const t = CRON_SPECIALS[s.toLowerCase()];
    return t ? { ok: true, text: t } : { ok: false, error: `«${s}» no es un atajo de cron (usa @reboot, @hourly, @daily, @weekly, @monthly o @yearly)` };
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) return { ok: false, error: `Hacen falta 5 campos (minuto hora día mes día-semana) y hay ${parts.length}` };
  const items: Item[][] = [];
  for (let i = 0; i < 5; i++) {
    const r = parseField(parts[i], FIELDS[i]);
    if (typeof r === "string") return { ok: false, error: r };
    items.push(r);
  }
  return { ok: true, text: sentence(items) };
}

const isAll = (it: Item[]) => it.length === 1 && it[0].kind === "all" && it[0].step === 1;
const singles = (it: Item[]): number[] | null =>
  it.every((x) => x.kind === "range" && x.a === x.b) ? it.map((x) => (x as { a: number }).a) : null;
const everyN = (it: Item[]): number | null => (it.length === 1 && it[0].kind === "all" && it[0].step > 1 ? it[0].step : null);

function list(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} y ${words[words.length - 1]}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Parte de la hora: «cada 5 minutos», «a las 3:00», «cada hora en el minuto 15»… */
function timePart(min: Item[], hour: Item[]): string {
  const ms = singles(min);
  const hs = singles(hour);
  const mStep = everyN(min);
  const hStep = everyN(hour);
  if (isAll(min) && isAll(hour)) return "cada minuto";
  if (mStep && isAll(hour)) return `cada ${mStep} minutos`;
  if (ms && isAll(hour)) return ms.length === 1 && ms[0] === 0 ? "cada hora, en punto" : `cada hora, en el minuto ${list(ms.map(String))}`;
  if (ms && hs && ms.length * hs.length <= 6) return `a las ${list(hs.flatMap((h) => ms.map((m) => `${h}:${pad(m)}`)))}`;
  if (ms && ms.length === 1 && hStep) return `cada ${hStep} horas, ${ms[0] === 0 ? "en punto" : `en el minuto ${ms[0]}`}`;
  if (ms && ms.length === 1 && hour.length === 1 && hour[0].kind === "range" && hour[0].step === 1)
    return `cada hora de ${hour[0].a}:${pad(ms[0])} a ${hour[0].b}:${pad(ms[0])}`;
  if (mStep && hour.length === 1 && hour[0].kind === "range" && hour[0].step === 1 && hour[0].a !== hour[0].b)
    return `cada ${mStep} minutos, de ${hour[0].a}:00 a ${hour[0].b}:59`;
  return `en el minuto ${fieldText(min)} de la hora ${fieldText(hour)}`;
}

function fieldText(it: Item[], names?: string[], off = 0): string {
  const one = (n: number) => (names ? names[n - off] : String(n));
  return list(
    it.map((x) =>
      x.kind === "all" ? (x.step > 1 ? `cada ${x.step}` : "cualquiera") : x.a === x.b ? one(x.a) : `de ${one(x.a)} a ${one(x.b)}${x.step > 1 ? ` cada ${x.step}` : ""}`,
    ),
  );
}

/** Parte del día: «cada día», «de lunes a viernes», «el día 1 de cada mes»… */
function dayPart(dom: Item[], month: Item[], dow: Item[]): string {
  let day: string;
  const ds = singles(dow);
  if (isAll(dom) && isAll(dow)) day = "cada día";
  else if (isAll(dom)) {
    const r = dow.length === 1 && dow[0].kind === "range" && dow[0].a !== dow[0].b && dow[0].step === 1 ? dow[0] : null;
    day = r ? `de ${DAY_ES[r.a]} a ${DAY_ES[r.b]}` : ds ? `los ${list([...new Set(ds.map((d) => DAY_PL[d]))])}` : `los días de la semana ${fieldText(dow, DAY_ES)}`;
  } else {
    const dd = singles(dom);
    const days = dd ? (dd.length === 1 ? `el día ${dd[0]}` : `los días ${list(dd.map(String))}`) : `los días ${fieldText(dom)}`;
    // Con los dos campos puestos, cron lo lanza si se cumple CUALQUIERA de los dos.
    day = isAll(dow) ? days : `${days} y también los ${ds ? list(ds.map((d) => DAY_PL[d])) : fieldText(dow, DAY_ES)}`;
    if (isAll(month) && isAll(dow)) day += " de cada mes";
    else if (isAll(dow) && singles(month)) return `${day} de ${fieldText(month, MONTH_ES, 1)}`;
  }
  if (!isAll(month)) {
    const m = fieldText(month, MONTH_ES, 1);
    day += m.startsWith("de ") ? `, ${m}` : `, en ${m}`;
  }
  return day;
}

function sentence(items: Item[][]): string {
  const [min, hour, dom, month, dow] = items;
  const time = timePart(min, hour);
  const day = dayPart(dom, month, dow);
  const text = time.startsWith("cada") ? (day === "cada día" ? time : `${time}, ${day}`) : `${day} ${time}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Atajos para elegir el horario sin escribirlo. */
export const SCHEDULE_PRESETS: { value: string; label: string }[] = [
  { value: "*/5 * * * *", label: "Cada 5 minutos" },
  { value: "0 * * * *", label: "Cada hora" },
  { value: "0 3 * * *", label: "Cada día a las 3:00" },
  { value: "0 3 * * 1", label: "Los lunes a las 3:00" },
  { value: "0 8 * * 1-5", label: "De lunes a viernes a las 8:00" },
  { value: "0 0 1 * *", label: "El día 1 de cada mes" },
  { value: "@reboot", label: "Al encender el servidor" },
];
