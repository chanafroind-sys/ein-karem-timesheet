import type { NextRequest } from 'next/server';
import { isAdmin } from '../../../../lib/auth';
import { buildWorkbook, exportFileName } from '../../../../lib/excel';
import { safe, unauthorized } from '../../../../lib/http';
import { refreshLedger } from '../../../../lib/ledger';
import { resolvePeriod } from '../../../../lib/periods';

export const GET = safe(async (req: NextRequest) => {
  if (!isAdmin(req)) return unauthorized();
  const { key } = resolvePeriod(req.nextUrl.searchParams.get('period'));
  await refreshLedger(key);
  const buf = await buildWorkbook(key);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${exportFileName(key)}"`,
    },
  });
});
