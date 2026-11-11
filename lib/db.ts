// One tiny interface over two Postgres backends:
//  - production: node-postgres against DATABASE_URL (Neon, Supabase, Vercel Postgres...)
//  - local dev (no DATABASE_URL): PGlite, an embedded Postgres stored in ./.data
import seedRows from '../data/seed-ledger.json';

type Row = Record<string, any>;
interface Conn {
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
  exec: (text: string) => Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS guides (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL,
  email      TEXT,
  token      TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reports (
  id         SERIAL PRIMARY KEY,
  guide_id   INT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  work_date  DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_guide_date ON reports (guide_id, work_date);
CREATE TABLE IF NOT EXISTS period_closures (
  period_key TEXT PRIMARY KEY,
  closed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE guides ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE guides ADD COLUMN IF NOT EXISTS rate NUMERIC;        -- personal rate (NIS per hour, or per lecture for lecturers); empty = not set
ALTER TABLE guides ADD COLUMN IF NOT EXISTS travel_rate NUMERIC; -- personal rate per trip (NIS); empty = not set
-- A report is either regular work ('work', has start/end times) or a drive ('travel', times optional).
ALTER TABLE reports ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'work';
ALTER TABLE reports ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE reports ALTER COLUMN end_time DROP NOT NULL;

-- The payroll sheet ("משכורות, מילגות אברכים והרצאות"): one row per line, accumulating all year.
-- source 'seed' = imported from the office file, 'manual' = added by the admin,
-- 'auto' = generated from guides' reported hours (replaced whenever its period is re-synced).
CREATE TABLE IF NOT EXISTS ledger (
  id         SERIAL PRIMARY KEY,
  month      TEXT NOT NULL,
  center     TEXT NOT NULL,
  name       TEXT NOT NULL,
  code       TEXT,
  kind       TEXT NOT NULL,
  work_date  TEXT,
  days       NUMERIC,
  qty        NUMERIC,
  rate_ils   NUMERIC,
  rate_usd   NUMERIC,
  note       TEXT,
  budget     TEXT,
  source     TEXT NOT NULL DEFAULT 'manual',
  period_key TEXT,
  guide_id   INT REFERENCES guides(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_period ON ledger (period_key);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface SeedRow {
  month: string; center: string | null; name: string; code: string | null; kind: string;
  work_date: string | null; days: number | null; qty: number | null; rate_ils: number | null;
  rate_usd: number | null; note: string | null; budget: string | null;
}

/** One-time import of the rows that already existed in the office's yearly file. */
async function seedLedger(conn: Conn) {
  const claimed = await conn.query(
    `INSERT INTO meta (key, value) VALUES ('seed_ledger_v1', now()::text) ON CONFLICT DO NOTHING RETURNING key`,
  );
  if (!claimed.length) return; // already seeded (or another instance is doing it right now)
  try {
    const rows = seedRows as SeedRow[];
    const params: unknown[] = [];
    const tuples = rows.map((r) => {
      const base = params.length;
      params.push(r.month, r.center ?? 'עין כרם', r.name, r.code, r.kind, r.work_date, r.days, r.qty,
        r.rate_ils, r.rate_usd, r.note, r.budget);
      return `(${Array.from({ length: 12 }, (_, i) => `$${base + i + 1}`).join(',')}, 'seed')`;
    });
    if (tuples.length) {
      await conn.query(
        `INSERT INTO ledger (month, center, name, code, kind, work_date, days, qty, rate_ils, rate_usd, note, budget, source)
         VALUES ${tuples.join(',')}`,
        params,
      );
    }
  } catch (e) {
    await conn.query(`DELETE FROM meta WHERE key = 'seed_ledger_v1'`); // let the next start retry
    throw e;
  }
}

const g = globalThis as unknown as { __tsConn?: Promise<Conn> };

async function open(): Promise<Conn> {
  // Vercel's database integrations name the variable DATABASE_URL or POSTGRES_URL; accept either.
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  let conn: Conn;
  if (url) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: url, max: 5 });
    conn = {
      query: async (t, p) => (await pool.query(t, p as any[])).rows,
      exec: async (t) => { await pool.query(t); },
    };
  } else {
    if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is not set');
    const { mkdirSync } = await import('node:fs');
    mkdirSync('./.data', { recursive: true });
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite('./.data/pg');
    conn = {
      query: async (t, p) => (await db.query(t, p as any[])).rows as Row[],
      exec: async (t) => { await db.exec(t); },
    };
  }
  await conn.exec(SCHEMA);
  await seedLedger(conn);
  return conn;
}

export async function query(text: string, params: unknown[] = []): Promise<Row[]> {
  if (!g.__tsConn) {
    // If opening fails, don't cache the rejected promise forever.
    g.__tsConn = open().catch((e) => {
      g.__tsConn = undefined;
      throw e;
    });
  }
  return (await g.__tsConn).query(text, params);
}

/** SQL expression: minutes worked in a reports row aliased `r`. */
export const MINUTES_SQL =
  `(substr(r.end_time,1,2)::int*60 + substr(r.end_time,4,2)::int - substr(r.start_time,1,2)::int*60 - substr(r.start_time,4,2)::int)`;

export const REPORT_COLS = `r.id, r.kind, to_char(r.work_date,'YYYY-MM-DD') AS work_date, r.start_time, r.end_time, r.note`;
