/**
 * A five-field cron parser.
 *
 * There are good libraries for this. There is also a rule in this repo about
 * what a drop is allowed to drag in, and "a scheduler that understands
 * `0 9 * * 1-5`" is ninety lines, not a dependency. Fields are the usual
 * minute, hour, day-of-month, month, day-of-week, with `*`, lists, ranges and
 * steps. Day-of-month and day-of-week are OR'd when both are restricted,
 * which is the behaviour every crontab has and nobody expects.
 */

const RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week, Sunday = 0
];

const NAMES: Record<string, number>[] = [
  {},
  {},
  {},
  { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },
  { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 },
];

export const PRESETS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

function parseField(raw: string, index: number): Set<number> | null {
  const [min, max] = RANGES[index];
  const names = NAMES[index];
  const out = new Set<number>();

  for (const part of raw.split(",")) {
    const piece = part.trim().toLowerCase();
    if (!piece) return null;

    const [spec, stepRaw] = piece.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) return null;

    let lo: number;
    let hi: number;
    if (spec === "*") {
      lo = min;
      hi = max;
    } else if (spec.includes("-")) {
      const [a, b] = spec.split("-");
      lo = resolve(a, names);
      hi = resolve(b, names);
    } else {
      lo = hi = resolve(spec, names);
      if (stepRaw !== undefined) hi = max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    if (lo < min || hi > max || lo > hi) return null;

    for (let v = lo; v <= hi; v += step) out.add(index === 4 && v === 7 ? 0 : v);
  }
  return out.size ? out : null;
}

function resolve(token: string, names: Record<string, number>): number {
  const t = token.trim();
  if (t in names) return names[t];
  // Sunday is 0 and also 7 in every crontab ever written.
  if (t === "7") return 0;
  return Number(t);
}

export type Cron = { fields: Set<number>[]; domRestricted: boolean; dowRestricted: boolean };

export function parseCron(expr: string): Cron | null {
  const normalised = (PRESETS[expr.trim().toLowerCase()] ?? expr).trim().replace(/\s+/g, " ");
  const parts = normalised.split(" ");
  if (parts.length !== 5) return null;

  const fields: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const set = parseField(parts[i], i);
    if (!set) return null;
    fields.push(set);
  }
  return {
    fields,
    domRestricted: parts[2] !== "*",
    dowRestricted: parts[4] !== "*",
  };
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null;
}

export function matches(cron: Cron, d: Date): boolean {
  const [minute, hour, dom, month, dow] = cron.fields;
  if (!minute.has(d.getMinutes())) return false;
  if (!hour.has(d.getHours())) return false;
  if (!month.has(d.getMonth() + 1)) return false;

  const domHit = dom.has(d.getDate());
  const dowHit = dow.has(d.getDay());
  if (cron.domRestricted && cron.dowRestricted) return domHit || dowHit;
  if (cron.domRestricted) return domHit;
  if (cron.dowRestricted) return dowHit;
  return true;
}

/** The next firing time, or null if nothing matches in the next four years. */
export function nextRun(expr: string, from: Date = new Date()): Date | null {
  const cron = parseCron(expr);
  if (!cron) return null;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  // Four years of minutes is enough to catch Feb 29 on a leap-day-only rule.
  for (let i = 0; i < 366 * 4 * 24 * 60; i++) {
    if (matches(cron, d)) return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A short human reading of common expressions; falls back to the raw text. */
export function describeCron(expr: string): string {
  const cron = parseCron(expr);
  if (!cron) return expr;
  const parts = (PRESETS[expr.trim().toLowerCase()] ?? expr).trim().replace(/\s+/g, " ").split(" ");
  const [mn, hr, dom, mon, dow] = parts;

  const at = (h: string, m: string) =>
    `${String(Number(h) % 12 === 0 ? 12 : Number(h) % 12)}:${m.padStart(2, "0")} ${Number(h) < 12 ? "am" : "pm"}`;

  if (mn === "*" && hr === "*") return "every minute";
  if (hr === "*" && /^\*\/\d+$/.test(mn)) return `every ${mn.slice(2)} minutes`;
  if (/^\d+$/.test(mn) && hr === "*") return `hourly at :${mn.padStart(2, "0")}`;
  if (/^\d+$/.test(mn) && /^\d+$/.test(hr) && dom === "*" && mon === "*") {
    if (dow === "*") return `daily at ${at(hr, mn)}`;
    if (dow === "1-5") return `weekdays at ${at(hr, mn)}`;
    if (/^\d$/.test(dow)) return `${DAY_LABELS[Number(dow) % 7]} at ${at(hr, mn)}`;
  }
  if (/^\d+$/.test(mn) && /^\d+$/.test(hr) && /^\d+$/.test(dom) && mon === "*")
    return `day ${dom} of each month at ${at(hr, mn)}`;
  return expr;
}
