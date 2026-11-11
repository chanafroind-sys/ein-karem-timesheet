import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, adminConfigured, checkAdminPassword, isAdmin, makeAdminCookie } from '../../../../lib/auth';
import { fail, readJson, safe } from '../../../../lib/http';

// Tiny in-memory brake on password guessing (per server instance; fine for one admin).
const attempts = new Map<string, { n: number; until: number }>();

export const GET = safe(async (req: NextRequest) => {
  return NextResponse.json({ authed: isAdmin(req), configured: adminConfigured() });
});

export const POST = safe(async (req: NextRequest) => {
  if (!adminConfigured()) return fail('ADMIN_PASSWORD לא מוגדר בשרת', 500);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const rec = attempts.get(ip);
  if (rec && rec.n >= 8 && rec.until > Date.now()) return fail('יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.', 429);

  const body = await readJson(req);
  if (typeof body.password !== 'string' || !checkAdminPassword(body.password)) {
    const n = (rec && rec.until > Date.now() ? rec.n : 0) + 1;
    attempts.set(ip, { n, until: Date.now() + 10 * 60 * 1000 });
    await new Promise((r) => setTimeout(r, 600));
    return fail('סיסמה שגויה', 401);
  }
  attempts.delete(ip);

  const { value, maxAge } = makeAdminCookie();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, value, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge,
  });
  return res;
});

export const DELETE = safe(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
});
