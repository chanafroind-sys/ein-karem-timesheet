import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { query } from './db';

export const ADMIN_COOKIE = 'ts_admin';
const SESSION_MS = 7 * 24 * 3600 * 1000;

const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function adminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

export function checkAdminPassword(pw: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  return !!real && safeEqual(pw, real);
}

export function makeAdminCookie(): { value: string; maxAge: number } {
  const exp = String(Date.now() + SESSION_MS);
  return { value: `${exp}.${sign(exp)}`, maxAge: SESSION_MS / 1000 };
}

export function isAdmin(req: NextRequest): boolean {
  if (!adminConfigured()) return false;
  const raw = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, sign(exp));
}

export const newToken = () => randomBytes(24).toString('base64url');

export interface Guide {
  id: number;
  name: string;
  role: string;
  email: string | null;
  active: boolean;
}

/** Guides authenticate with the secret token from their personal link, sent in a header. */
export async function getGuide(req: NextRequest): Promise<Guide | null> {
  const token = req.headers.get('x-guide-token');
  if (!token || token.length < 20 || token.length > 100) return null;
  const rows = await query(
    'SELECT id, name, role, email, active FROM guides WHERE token = $1 AND active = TRUE',
    [token],
  );
  return (rows[0] as Guide | undefined) ?? null;
}
