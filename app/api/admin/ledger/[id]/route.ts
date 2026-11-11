import type { NextRequest } from 'next/server';
import { isAdmin } from '../../../../../lib/auth';
import { fail, json, readJson, safe, unauthorized } from '../../../../../lib/http';
import { deleteLedger, parseLedgerInput, updateLedger } from '../../../../../lib/ledger';

type Ctx = { params: Promise<{ id: string }> };

const AUTO_MSG = 'שורה אוטומטית נוצרת מדיווחי השעות ואי אפשר לערוך אותה כאן. אפשר להוסיף שורת תיקון ידנית.';

export const PUT = safe(async (req: NextRequest, ctx: Ctx) => {
  if (!isAdmin(req)) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return fail('לא נמצא', 404);
  const parsed = parseLedgerInput(await readJson(req));
  if (!parsed.ok) return fail(parsed.error);
  return (await updateLedger(id, parsed.value)) ? json({ ok: true }) : fail(AUTO_MSG, 400);
});

export const DELETE = safe(async (req: NextRequest, ctx: Ctx) => {
  if (!isAdmin(req)) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return fail('לא נמצא', 404);
  return (await deleteLedger(id)) ? json({ ok: true }) : fail(AUTO_MSG, 400);
});
