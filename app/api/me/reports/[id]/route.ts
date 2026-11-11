import type { NextRequest } from 'next/server';
import { getGuide } from '../../../../../lib/auth';
import { START_DAY } from '../../../../../lib/config';
import { query } from '../../../../../lib/db';
import { fail, json, readJson, safe, unauthorized } from '../../../../../lib/http';
import { isClosed } from '../../../../../lib/periods';
import { checkReport } from '../../../../../lib/reports';
import { periodKeyOf } from '../../../../../lib/time';

type Ctx = { params: Promise<{ id: string }> };

/** Load one of this guide's own reports, or explain why it can't be touched. */
async function ownReport(req: NextRequest, ctx: Ctx) {
  const guide = await getGuide(req);
  if (!guide) return { error: unauthorized() };
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return { error: fail('דיווח לא נמצא', 404) };
  const rows = await query(
    `SELECT id, to_char(work_date,'YYYY-MM-DD') AS work_date FROM reports WHERE id = $1 AND guide_id = $2`,
    [id, guide.id],
  );
  if (!rows.length) return { error: fail('דיווח לא נמצא', 404) };
  if (await isClosed(periodKeyOf(rows[0].work_date, START_DAY))) {
    return { error: fail('התקופה הזו נסגרה. לשינויים פנו למנהל.', 403) };
  }
  return { guide, id };
}

export const PUT = safe(async (req: NextRequest, ctx: Ctx) => {
  const own = await ownReport(req, ctx);
  if (own.error) return own.error;

  const checked = await checkReport(await readJson(req), own.guide!.id, own.id);
  if (!checked.ok) return fail(checked.error);
  const v = checked.value;

  await query(
    `UPDATE reports SET kind = $1, work_date = $2, start_time = $3, end_time = $4, note = $5, updated_at = now()
      WHERE id = $6 AND guide_id = $7`,
    [v.kind, v.work_date, v.start_time, v.end_time, v.note, own.id, own.guide!.id],
  );
  return json({ ok: true });
});

export const DELETE = safe(async (req: NextRequest, ctx: Ctx) => {
  const own = await ownReport(req, ctx);
  if (own.error) return own.error;
  await query('DELETE FROM reports WHERE id = $1 AND guide_id = $2', [own.id, own.guide!.id]);
  return json({ ok: true });
});
