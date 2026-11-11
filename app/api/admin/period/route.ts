import type { NextRequest } from 'next/server';
import { isAdmin } from '../../../../lib/auth';
import { buildWorkbook, exportFileName } from '../../../../lib/excel';
import { fail, json, readJson, safe, unauthorized } from '../../../../lib/http';
import { refreshLedger, syncPeriod } from '../../../../lib/ledger';
import { sendReportMail } from '../../../../lib/mail';
import { resolvePeriod, setClosed } from '../../../../lib/periods';

/** { period, action: 'close' | 'open' | 'send' | 'sync' } */
export const POST = safe(async (req: NextRequest) => {
  if (!isAdmin(req)) return unauthorized();
  const body = await readJson(req);
  const p = resolvePeriod(typeof body.period === 'string' ? body.period : null);

  if (body.action === 'close') {
    // Write the period's hours into the payroll sheet, then freeze it.
    const sync = await syncPeriod(p.key);
    await setClosed(p.key, true);
    return json({ ok: true, closed: true, sync });
  }
  if (body.action === 'open') {
    await setClosed(p.key, false);
    return json({ ok: true, closed: false });
  }
  if (body.action === 'sync') {
    return json({ ok: true, sync: await syncPeriod(p.key) });
  }
  if (body.action === 'send') {
    await refreshLedger(p.key);
    const buf = await buildWorkbook(p.key);
    const r = await sendReportMail({
      subject: `דוח משכורות ודיווחי שעות – ${p.label}`,
      text: `מצורף קובץ האקסל המצטבר (כל השורות עד ${p.label}).`,
      filename: exportFileName(p.key),
      content: buf,
    });
    return r.ok ? json({ ok: true }) : fail(r.error ?? 'שליחה נכשלה', 502);
  }
  return fail('פעולה לא מוכרת');
});
