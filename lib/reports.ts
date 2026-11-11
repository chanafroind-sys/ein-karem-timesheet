import { START_DAY } from './config';
import { query } from './db';
import { isClosed } from './periods';
import { isDate, isTime, periodKeyOf, toMinutes, todayIL } from './time';

export type ReportKind = 'work' | 'travel';

export interface ReportInput {
  kind: ReportKind;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  note: string;
}

type Checked = { ok: true; value: ReportInput } | { ok: false; error: string };

/** Validate the shape of a report and the business rules that need the DB. */
export async function checkReport(
  body: Record<string, unknown>,
  guideId: number,
  excludeId?: number,
): Promise<Checked> {
  const kind = body.kind === undefined ? 'work' : body.kind;
  if (kind !== 'work' && kind !== 'travel') return { ok: false, error: 'סוג דיווח לא תקין' };
  const { work_date, start_time, end_time } = body;
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!isDate(work_date)) return { ok: false, error: 'תאריך לא תקין' };
  if (note.length > 300) return { ok: false, error: 'ההערה ארוכה מדי (עד 300 תווים)' };
  if (work_date > todayIL()) return { ok: false, error: 'אי אפשר לדווח על תאריך עתידי' };
  if (await isClosed(periodKeyOf(work_date, START_DAY))) {
    return { ok: false, error: 'התקופה הזו נסגרה. לשינויים פנו למנהל.' };
  }

  // A drive needs only the day. Times are not part of it.
  if (kind === 'travel') {
    return { ok: true, value: { kind, work_date, start_time: null, end_time: null, note } };
  }

  if (!isTime(start_time)) return { ok: false, error: 'שעת כניסה לא תקינה' };
  if (!isTime(end_time)) return { ok: false, error: 'שעת יציאה לא תקינה' };
  if (toMinutes(end_time) <= toMinutes(start_time)) {
    return { ok: false, error: 'שעת היציאה חייבת להיות אחרי שעת הכניסה' };
  }

  const clash = await query(
    `SELECT start_time, end_time FROM reports
      WHERE guide_id = $1 AND work_date = $2 AND id <> $3 AND kind = 'work'
        AND start_time < $5 AND end_time > $4
      LIMIT 1`,
    [guideId, work_date, excludeId ?? 0, start_time, end_time],
  );
  if (clash.length) {
    return { ok: false, error: `חופף לדיווח קיים באותו יום (${clash[0].start_time}–${clash[0].end_time})` };
  }
  return { ok: true, value: { kind, work_date, start_time, end_time, note } };
}
