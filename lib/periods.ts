import { START_DAY } from './config';
import { query } from './db';
import {
  isPeriodKey, periodKeyOf, periodLabel, periodRange, shiftKey, todayIL,
} from './time';

export async function isClosed(key: string): Promise<boolean> {
  const rows = await query('SELECT 1 FROM period_closures WHERE period_key = $1', [key]);
  return rows.length > 0;
}

export async function setClosed(key: string, closed: boolean): Promise<void> {
  if (closed) {
    await query('INSERT INTO period_closures (period_key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
  } else {
    await query('DELETE FROM period_closures WHERE period_key = $1', [key]);
  }
}

/** Resolve a requested period key (never in the future); defaults to the current period. */
export function resolvePeriod(requested: string | null) {
  const today = todayIL();
  const current = periodKeyOf(today, START_DAY);
  let key = isPeriodKey(requested) ? requested : current;
  if (key > current) key = current;
  const { start, end } = periodRange(key, START_DAY);
  return {
    key, start, end, today, current,
    label: periodLabel(key, START_DAY),
    prevKey: shiftKey(key, -1),
    nextKey: key < current ? shiftKey(key, 1) : null,
  };
}
