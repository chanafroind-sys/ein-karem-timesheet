// Pure date/time helpers. No imports, so they run in the browser, the server and node:test.

export const HE_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
export const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const pad = (n: number) => String(n).padStart(2, '0');

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isTime(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  return `${h}:${pad(min % 60)}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function weekdayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return HE_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Today's date (YYYY-MM-DD) in Israel, regardless of the server's timezone. */
export function todayIL(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export const isPeriodKey = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function shiftKey(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

/** A period is named by the month it starts in. startDay=1 -> calendar month. */
export function periodKeyOf(date: string, startDay: number): string {
  const key = date.slice(0, 7);
  return Number(date.slice(8, 10)) >= startDay ? key : shiftKey(key, -1);
}

export function periodRange(key: string, startDay: number): { start: string; end: string } {
  const start = `${key}-${pad(startDay)}`;
  const end = addDays(`${shiftKey(key, 1)}-${pad(startDay)}`, -1);
  return { start, end };
}

const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

export function periodLabel(key: string, startDay: number): string {
  if (startDay === 1) return `${HE_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  const { start, end } = periodRange(key, startDay);
  return `${dm(start)} – ${dm(end)}.${end.slice(0, 4)}`;
}

/** The latest period that is over as of `today` (the period ending today counts as over). */
export function endedPeriodKey(today: string, startDay: number): string {
  const cur = periodKeyOf(today, startDay);
  return periodRange(cur, startDay).end === today ? cur : shiftKey(cur, -1);
}
