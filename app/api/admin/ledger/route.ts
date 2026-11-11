import type { NextRequest } from 'next/server';
import { isAdmin } from '../../../../lib/auth';
import { CENTER, KAT } from '../../../../lib/config';
import { fail, json, readJson, safe, unauthorized } from '../../../../lib/http';
import { MONTH_ORDER, insertLedger, listLedger, parseLedgerInput } from '../../../../lib/ledger';
import { resolvePeriod } from '../../../../lib/periods';

export const GET = safe(async (req: NextRequest) => {
  if (!isAdmin(req)) return unauthorized();
  const p = resolvePeriod(null);
  return json({ rows: await listLedger(), kat: KAT, months: MONTH_ORDER, center: CENTER, currentPeriod: { key: p.key, label: p.label } });
});

export const POST = safe(async (req: NextRequest) => {
  if (!isAdmin(req)) return unauthorized();
  const parsed = parseLedgerInput(await readJson(req));
  if (!parsed.ok) return fail(parsed.error);
  return json({ id: await insertLedger(parsed.value) }, 201);
});
