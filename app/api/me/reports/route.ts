import type { NextRequest } from 'next/server';
import { getGuide } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { fail, json, readJson, safe, unauthorized } from '../../../../lib/http';
import { checkReport } from '../../../../lib/reports';

export const POST = safe(async (req: NextRequest) => {
  const guide = await getGuide(req);
  if (!guide) return unauthorized();

  const checked = await checkReport(await readJson(req), guide.id);
  if (!checked.ok) return fail(checked.error);
  const v = checked.value;

  const rows = await query(
    `INSERT INTO reports (guide_id, kind, work_date, start_time, end_time, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [guide.id, v.kind, v.work_date, v.start_time, v.end_time, v.note],
  );
  return json({ id: rows[0].id }, 201);
});
