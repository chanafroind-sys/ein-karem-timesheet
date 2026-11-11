import type { NextRequest } from 'next/server';
import { isAdmin, newToken } from '../../../../lib/auth';
import { GROUPS } from '../../../../lib/config';
import { MINUTES_SQL, query } from '../../../../lib/db';
import { fail, json, readJson, safe, unauthorized } from '../../../../lib/http';
import { isClosed, resolvePeriod } from '../../../../lib/periods';

const ORDER_SQL = `CASE g.role ${GROUPS.map((r, i) => `WHEN '${r}' THEN ${i}`).join(' ')} ELSE ${GROUPS.length} END`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[\w-]{1,20}$/;

export const GET = safe(async (req: NextRequest) => {
  if (!isAdmin(req)) return unauthorized();
  const p = resolvePeriod(req.nextUrl.searchParams.get('period'));
  const guides = await query(
    `SELECT g.id, g.name, g.role, g.email, g.code, g.rate::float8 AS rate, g.travel_rate::float8 AS travel_rate,
            g.token, g.active,
            COUNT(DISTINCT r.work_date) FILTER (WHERE r.kind = 'work')::int AS days,
            COALESCE(SUM(${MINUTES_SQL}) FILTER (WHERE r.kind = 'work'), 0)::int AS minutes,
            COUNT(*) FILTER (WHERE r.kind = 'travel')::int AS trips
       FROM guides g
       LEFT JOIN reports r ON r.guide_id = g.id AND r.work_date BETWEEN $1 AND $2
      GROUP BY g.id
      ORDER BY g.active DESC, ${ORDER_SQL}, g.name`,
    [p.start, p.end],
  );
  return json({ guides, period: { ...p, closed: await isClosed(p.key) }, groups: GROUPS });
});

/** Create one guide ({name, role, email?}) or many ({role, bulk: "name[, email]\n..."}). */
export const POST = safe(async (req: NextRequest) => {
  if (!isAdmin(req)) return unauthorized();
  const body = await readJson(req);
  const role = String(body.role ?? '');
  if (!(GROUPS as readonly string[]).includes(role)) return fail('קבוצה לא תקינה');

  const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const entries: { name: string; email: string | null; code: string | null; rate: number | null }[] = [];
  if (typeof body.bulk === 'string') {
    // Each line: name, then optionally an employee code and/or an email, in any order.
    for (const line of body.bulk.split('\n')) {
      const [name, ...rest] = line.split(/[,\t]/).map((s) => s.trim()).filter(Boolean);
      if (!name) continue;
      entries.push({
        name,
        email: rest.find((x) => x.includes('@')) ?? null,
        code: rest.find((x) => !x.includes('@')) ?? null,
        rate: null, // set per person afterwards
      });
    }
  } else if (clean(body.name)) {
    const rate = clean(body.rate) === null && typeof body.rate !== 'number' ? null : Number(body.rate);
    if (rate !== null && !(Number.isFinite(rate) && rate >= 0 && rate < 10000)) return fail('תעריף לא תקין');
    entries.push({ name: clean(body.name)!, email: clean(body.email), code: clean(body.code), rate });
  }
  if (!entries.length) return fail('חסר שם');
  if (entries.length > 200) return fail('יותר מדי שמות בבת אחת (עד 200)');
  for (const e of entries) {
    if (e.name.length > 80) return fail(`שם ארוך מדי: ${e.name.slice(0, 20)}...`);
    if (e.email && !EMAIL_RE.test(e.email)) return fail(`כתובת מייל לא תקינה: ${e.email}`);
    if (e.code && !CODE_RE.test(e.code)) return fail(`קוד עובד לא תקין: ${e.code}`);
  }

  const created = [];
  for (const e of entries) {
    const rows = await query(
      `INSERT INTO guides (name, role, email, code, rate, token) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, role, email, code, rate::float8 AS rate, token, active`,
      [e.name, role, e.email, e.code, e.rate, newToken()],
    );
    created.push(rows[0]);
  }
  return json({ created }, 201);
});
