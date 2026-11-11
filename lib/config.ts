import kat from '../data/kat.json';

export const GROUPS = ['מנחים', 'מנחות', 'אברכים', 'מרצים'] as const;
export type Group = (typeof GROUPS)[number];

/** Day of the month a reporting period starts on. 20 = the 20th through the 19th (the office closes its report on the 20th). */
function startDay(): number {
  const n = Number(process.env.PERIOD_START_DAY ?? 20);
  return Number.isInteger(n) && n >= 1 && n <= 28 ? n : 20;
}
export const START_DAY = startDay();

/** The center name written in the "מרכז" column of the payroll sheet. */
export const CENTER = process.env.CENTER_NAME || 'עין כרם';

/** The office's expense-type table (sheet "הגדרות", range Kat): used for the dropdown and budget category. */
export const KAT = kat as { kind: string; rate: number | null; budget: string | null }[];

/**
 * How each group's reports turn into payroll rows. No rates live here: every person's rate
 * (and travel rate) is set by the admin, and stays empty until then.
 *  - 'hours'   : one row per person per period, quantity = hours worked
 *  - 'lecture' : one row per lecture (each work report), quantity = 1, dated
 * Travel reports always become one row per person, quantity = number of trips.
 */
export const PAY: Record<Group, { kind: string; travelKind: string; budget: string; unit: 'hours' | 'lecture' }> = {
  'מנחים': { kind: 'שכר מנחים - שעת הנחיה', travelKind: 'נסיעות מנחים', budget: 'חינוך', unit: 'hours' },
  'מנחות': { kind: 'שכר מנחות - שעת הנחיה', travelKind: 'נסיעות מנחות', budget: 'חינוך', unit: 'hours' },
  'אברכים': { kind: 'מילגות אברכים', travelKind: 'נסיעות אברכים', budget: 'חינוך', unit: 'hours' },
  'מרצים': { kind: 'הרצאות כללי (גברים ונשים)', travelKind: 'נסיעות מרצים', budget: 'חינוך', unit: 'lecture' },
};
