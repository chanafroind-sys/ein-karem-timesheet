import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { START_DAY } from '../../../../lib/config';
import { buildWorkbook, exportFileName } from '../../../../lib/excel';
import { fail, json, safe } from '../../../../lib/http';
import { syncPeriod } from '../../../../lib/ledger';
import { sendReportMail } from '../../../../lib/mail';
import { isClosed, setClosed } from '../../../../lib/periods';
import { endedPeriodKey, periodLabel, todayIL } from '../../../../lib/time';

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: no secret configured, no cron
  const given = req.headers.get('authorization') ?? '';
  const want = `Bearer ${secret}`;
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

/**
 * Runs on the 19th (see vercel.json). Builds the Excel for the period that just ended,
 * emails it, then closes the period so guides can no longer edit it.
 * Idempotent: if the period is already closed it does nothing.
 */
export const GET = safe(async (req: NextRequest) => {
  if (!authorized(req)) return fail('אין הרשאה', 401);

  const key = endedPeriodKey(todayIL(), START_DAY);
  if (await isClosed(key)) return json({ skipped: true, reason: 'already closed', period: key });

  const label = periodLabel(key, START_DAY);
  const sync = await syncPeriod(key); // add this period's hours to the payroll sheet
  const buf = await buildWorkbook(key);
  const sent = await sendReportMail({
    subject: `דוח משכורות ודיווחי שעות – ${label}`,
    text: `מצורף קובץ האקסל המצטבר: כל השורות עד ${label}, כולל ${sync.inserted} שורות חדשות מדיווחי הצוות.\nהתקופה נסגרה לעריכה.`,
    filename: exportFileName(key),
    content: buf,
  });
  if (!sent.ok) {
    // Leave the period open so the next run (or a manual send) can retry.
    console.error('cron export: mail failed', sent.error);
    return fail(sent.error ?? 'שליחת המייל נכשלה', 502);
  }
  await setClosed(key, true);
  return json({ ok: true, period: key });
});
