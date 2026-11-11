import type { NextRequest } from 'next/server';
import { isAdmin, newToken } from '../../../../../lib/auth';
import { GROUPS } from '../../../../../lib/config';
import { query } from '../../../../../lib/db';
import { fail, json, readJson, safe, unauthorized } from '../../../../../lib/http';

type Ctx = { params: Promise<{ id: string }> };

/** Edit a guide: name, role, email, active, or regenerate:true to replace (revoke) their link. */
export const PATCH = safe(async (req: NextRequest, ctx: Ctx) => {
  if (!isAdmin(req)) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return fail('לא נמצא', 404);
  const b = await readJson(req);

  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  if (typeof b.name === 'string') {
    if (!b.name.trim() || b.name.length > 80) return fail('שם לא תקין');
    add('name', b.name.trim());
  }
  if (typeof b.role === 'string') {
    if (!(GROUPS as readonly string[]).includes(b.role)) return fail('קבוצה לא תקינה');
    add('role', b.role);
  }
  if ('email' in b) add('email', typeof b.email === 'string' && b.email.trim() ? b.email.trim() : null);
  if ('code' in b) {
    const code = typeof b.code === 'string' && b.code.trim() ? b.code.trim() : null;
    if (code && !/^[\w-]{1,20}$/.test(code)) return fail('קוד עובד לא תקין');
    add('code', code);
  }
  for (const col of ['rate', 'travel_rate'] as const) {
    if (!(col in b)) continue;
    const empty = b[col] === null || b[col] === '' || b[col] === undefined;
    const rate = empty ? null : Number(b[col]);
    if (rate !== null && !(Number.isFinite(rate) && rate >= 0 && rate < 10000)) return fail('תעריף לא תקין');
    add(col, rate);
  }
  if (typeof b.active === 'boolean') add('active', b.active);
  if (b.regenerate === true) add('token', newToken());
  if (!sets.length) return fail('אין מה לעדכן');

  vals.push(id);
  const rows = await query(
    `UPDATE guides SET ${sets.join(', ')} WHERE id = $${vals.length}
     RETURNING id, name, role, email, code, rate::float8 AS rate, travel_rate::float8 AS travel_rate, token, active`,
    vals,
  );
  if (!rows.length) return fail('לא נמצא', 404);
  return json({ guide: rows[0] });
});
