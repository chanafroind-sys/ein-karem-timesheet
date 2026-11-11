// The payroll sheet as data. Every month adds rows here; the Excel export is the whole table.
import { CENTER, GROUPS, KAT, PAY, START_DAY } from './config';
import { MINUTES_SQL, query } from './db';
import { isClosed } from './periods';
import { HE_MONTHS, periodRange } from './time';

/** The office's fiscal year runs September to August. */
export const MONTH_ORDER = ['ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט'];

export const monthIndex = (m: string) => {
  const i = MONTH_ORDER.indexOf(m);
  return i < 0 ? 99 : i;
};

const MONTH_ORDER_SQL = `CASE month ${MONTH_ORDER.map((m, i) => `WHEN '${m}' THEN ${i}`).join(' ')} ELSE 99 END`;
const GROUP_ORDER_SQL = `CASE g.role ${GROUPS.map((r, i) => `WHEN '${r}' THEN ${i}`).join(' ')} ELSE ${GROUPS.length} END`;

export interface LedgerRow {
  id: number;
  month: string;
  center: string;
  name: string;
  code: string | null;
  kind: string;
  work_date: string | null;
  days: number | null;
  qty: number | null;
  rate_ils: number | null;
  rate_usd: number | null;
  note: string | null;
  budget: string | null;
  source: 'seed' | 'manual' | 'auto';
  period_key: string | null;
}

const COLS = `id, month, center, name, code, kind, work_date, days::float8 AS days, qty::float8 AS qty,
  rate_ils::float8 AS rate_ils, rate_usd::float8 AS rate_usd, note, budget, source, period_key`;

export async function listLedger(): Promise<LedgerRow[]> {
  return (await query(`SELECT ${COLS} FROM ledger ORDER BY ${MONTH_ORDER_SQL}, id`)) as LedgerRow[];
}

/** The month name written on a period's rows: its own month, or (for 20th-19th periods) the month it ends in. */
export function reportMonthName(key: string): string {
  const date = START_DAY === 1 ? `${key}-01` : periodRange(key, START_DAY).end;
  return HE_MONTHS[Number(date.slice(5, 7)) - 1];
}

export interface SyncResult {
  inserted: number;
  /** People whose rate is not set yet. Their rows are in the sheet, with an empty rate. */
  missingRate: string[];
}

interface AutoRow {
  guideId: number;
  name: string;
  code: string | null;
  kind: string;
  work_date: string | null;
  days: number | null;
  qty: number;
  rate: number | null;
  budget: string;
}

const LECTURE_ROLES = GROUPS.filter((g) => PAY[g].unit === 'lecture');

/**
 * Rebuild the auto-generated rows of one period from what people reported themselves.
 * Per person: one row for work (hours, or one row per lecture for lecturers) and one row for
 * their trips. Rates are the person's own rates; nothing is assumed when they are not set.
 */
export async function syncPeriod(key: string): Promise<SyncResult> {
  const { start, end } = periodRange(key, START_DAY);
  const people = await query(
    `SELECT g.id, g.name, g.role, g.code, g.rate::float8 AS rate, g.travel_rate::float8 AS travel_rate,
            COUNT(DISTINCT r.work_date) FILTER (WHERE r.kind = 'work')::int AS days,
            COALESCE(SUM(${MINUTES_SQL}) FILTER (WHERE r.kind = 'work'), 0)::int AS minutes,
            COUNT(*) FILTER (WHERE r.kind = 'travel')::int AS trips
       FROM guides g JOIN reports r ON r.guide_id = g.id AND r.work_date BETWEEN $1 AND $2
      GROUP BY g.id
      ORDER BY ${GROUP_ORDER_SQL}, g.name`,
    [start, end],
  );
  const lectureList = LECTURE_ROLES.map((r) => `'${r}'`).join(',');
  const lectures = lectureList
    ? await query(
        `SELECT r.guide_id, to_char(r.work_date,'YYYY-MM-DD') AS work_date
           FROM reports r JOIN guides g ON g.id = r.guide_id
          WHERE g.role IN (${lectureList}) AND r.kind = 'work' AND r.work_date BETWEEN $1 AND $2
          ORDER BY r.work_date, r.start_time`,
        [start, end],
      )
    : [];
  const lecturesOf = new Map<number, string[]>();
  for (const l of lectures) lecturesOf.set(l.guide_id, [...(lecturesOf.get(l.guide_id) ?? []), l.work_date]);

  const rows: AutoRow[] = [];
  const missingRate = new Set<string>();
  for (const p of people) {
    const pay = PAY[p.role as keyof typeof PAY];
    if (!pay) continue;
    const base = { guideId: p.id, name: p.name, code: p.code, budget: pay.budget };
    const add = (row: Omit<AutoRow, keyof typeof base>) => {
      rows.push({ ...base, ...row });
      if (row.rate == null) missingRate.add(p.name);
    };
    if (pay.unit === 'lecture') {
      for (const date of lecturesOf.get(p.id) ?? []) {
        add({ kind: pay.kind, work_date: date, days: null, qty: 1, rate: p.rate });
      }
    } else if (p.minutes > 0) {
      add({ kind: pay.kind, work_date: null, days: p.days, qty: Math.round((p.minutes / 60) * 100) / 100, rate: p.rate });
    }
    if (p.trips > 0) add({ kind: pay.travelKind, work_date: null, days: null, qty: p.trips, rate: p.travel_rate });
  }

  const month = reportMonthName(key);
  const params: unknown[] = [key];
  const tuples = rows.map((r) => {
    const b = params.length;
    params.push(month, CENTER, r.name, r.code, r.kind, r.work_date, r.days, r.qty, r.rate, r.budget, r.guideId);
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},'auto',$1,$${b + 11})`;
  });

  if (!tuples.length) {
    await query(`DELETE FROM ledger WHERE source = 'auto' AND period_key = $1`, [key]);
  } else {
    // One statement, so the old rows are never gone without the new ones being in.
    await query(
      `WITH del AS (DELETE FROM ledger WHERE source = 'auto' AND period_key = $1)
       INSERT INTO ledger (month, center, name, code, kind, work_date, days, qty, rate_ils, budget, source, period_key, guide_id)
       VALUES ${tuples.join(',')}`,
      params,
    );
  }
  return { inserted: tuples.length, missingRate: [...missingRate] };
}

/** Keep an OPEN period's generated rows current. A closed period is frozen, so it is left alone. */
export async function refreshLedger(key: string): Promise<SyncResult | null> {
  if (await isClosed(key)) return null;
  return syncPeriod(key);
}

// ---------- manual rows ----------

export interface LedgerInput {
  month: string;
  center: string;
  name: string;
  code: string | null;
  kind: string;
  work_date: string | null;
  days: number | null;
  qty: number | null;
  rate_ils: number | null;
  rate_usd: number | null;
  note: string | null;
  budget: string | null;
}

const num = (v: unknown): number | null | 'bad' => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : 'bad';
};
const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

export function parseLedgerInput(b: Record<string, unknown>): { ok: true; value: LedgerInput } | { ok: false; error: string } {
  const month = str(b.month, 20);
  if (!month || !MONTH_ORDER.includes(month)) return { ok: false, error: 'חודש לא תקין' };
  const name = str(b.name, 80);
  if (!name) return { ok: false, error: 'חסר שם' };
  const kind = str(b.kind, 80);
  if (!kind) return { ok: false, error: 'חסר סיווג הוצאה' };
  const days = num(b.days), qty = num(b.qty), rate_ils = num(b.rate_ils), rate_usd = num(b.rate_usd);
  if ([days, qty, rate_ils, rate_usd].includes('bad')) return { ok: false, error: 'מספר לא תקין (ימים / כמות / תעריף)' };
  const budget = str(b.budget, 40) ?? KAT.find((k) => k.kind === kind)?.budget ?? null;
  return {
    ok: true,
    value: {
      month, center: str(b.center, 60) ?? CENTER, name, code: str(b.code, 20), kind,
      work_date: str(b.work_date, 20), days: days as number | null, qty: qty as number | null,
      rate_ils: rate_ils as number | null, rate_usd: rate_usd as number | null,
      note: str(b.note, 300), budget,
    },
  };
}

const VALUE_COLS = ['month', 'center', 'name', 'code', 'kind', 'work_date', 'days', 'qty', 'rate_ils', 'rate_usd', 'note', 'budget'] as const;

export async function insertLedger(v: LedgerInput): Promise<number> {
  const rows = await query(
    `INSERT INTO ledger (${VALUE_COLS.join(',')}, source)
     VALUES (${VALUE_COLS.map((_, i) => `$${i + 1}`).join(',')}, 'manual') RETURNING id`,
    VALUE_COLS.map((c) => v[c]),
  );
  return rows[0].id;
}

export async function updateLedger(id: number, v: LedgerInput): Promise<boolean> {
  const rows = await query(
    `UPDATE ledger SET ${VALUE_COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')}
      WHERE id = $${VALUE_COLS.length + 1} AND source <> 'auto' RETURNING id`,
    [...VALUE_COLS.map((c) => v[c]), id],
  );
  return rows.length > 0;
}

export async function deleteLedger(id: number): Promise<boolean> {
  const rows = await query(`DELETE FROM ledger WHERE id = $1 AND source <> 'auto' RETURNING id`, [id]);
  return rows.length > 0;
}
