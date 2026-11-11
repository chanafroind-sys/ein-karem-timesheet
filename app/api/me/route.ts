import type { NextRequest } from 'next/server';
import { getGuide } from '../../../lib/auth';
import { MINUTES_SQL, REPORT_COLS, query } from '../../../lib/db';
import { json, safe, unauthorized } from '../../../lib/http';
import { isClosed, resolvePeriod } from '../../../lib/periods';

export const GET = safe(async (req: NextRequest) => {
  const guide = await getGuide(req);
  if (!guide) return unauthorized();

  const p = resolvePeriod(req.nextUrl.searchParams.get('period'));
  const reports = await query(
    `SELECT ${REPORT_COLS}, ${MINUTES_SQL}::int AS minutes
       FROM reports r
      WHERE r.guide_id = $1 AND r.work_date BETWEEN $2 AND $3
      ORDER BY r.work_date, r.start_time NULLS LAST, r.id`,
    [guide.id, p.start, p.end],
  );
  const work = reports.filter((r) => r.kind === 'work');
  return json({
    guide: { name: guide.name, role: guide.role },
    period: { ...p, closed: await isClosed(p.key) },
    reports,
    totalMinutes: work.reduce((a, r) => a + (r.minutes ?? 0), 0),
    days: new Set(work.map((r) => r.work_date)).size,
    trips: reports.length - work.length,
  });
});
