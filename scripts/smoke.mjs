// End-to-end smoke test against a running server (dev, with an empty local DB).
//   Start the dev server on port 3111 with PERIOD_START_DAY=1 and an empty .data folder, then:
//   ADMIN_PASSWORD=... CRON_SECRET=... node scripts/smoke.mjs
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

const BASE = process.env.BASE || 'http://localhost:3111';
const PW = process.env.ADMIN_PASSWORD;
const CRON = process.env.CRON_SECRET;
if (!PW || !CRON) {
  console.error('Set ADMIN_PASSWORD and CRON_SECRET to the values the dev server was started with.');
  process.exit(1);
}

let cookie = '';
const req = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { 'x-guide-token': token } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, res, data: type.includes('json') ? await res.json() : null };
};
const ok = (name) => console.log('  ✓', name);

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
const month = today.slice(0, 7);
const day = (n) => `${month}-${String(n).padStart(2, '0')}`;

// --- admin auth ---
assert.equal((await req('/api/admin/guides')).status, 401);
ok('admin API rejects anonymous');
assert.equal((await req('/api/admin/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
ok('wrong admin password rejected');
assert.equal((await req('/api/admin/login', { method: 'POST', body: { password: PW } })).status, 200);
ok('admin login');

// --- guides ---
const a = (await req('/api/admin/guides', { method: 'POST', body: { name: 'דוד כהן', role: 'מנחים', email: 'david@example.com' } })).data.created[0];
const b = (await req('/api/admin/guides', { method: 'POST', body: { name: 'שרה לוי', role: 'מנחות' } })).data.created[0];
const bulk = await req('/api/admin/guides', { method: 'POST', body: { role: 'אברכים', bulk: 'יוסף ברק, yosef@example.com\nמשה גולד\n' } });
assert.equal(bulk.data.created.length, 2);
const lect = (await req('/api/admin/guides', { method: 'POST', body: { name: 'חיים מרצה', role: 'מרצים', rate: 600 } })).data.created[0];
assert.equal(lect.rate, 600);
assert.equal((await req('/api/admin/guides', { method: 'POST', body: { name: 'x', role: 'לא קיים' } })).status, 400);
ok('create guides (single, bulk, bad group)');
assert.ok(a.token.length >= 30 && a.token !== b.token);

// --- guide auth & isolation ---
assert.equal((await req('/api/me')).status, 401);
assert.equal((await req('/api/me', { token: 'x'.repeat(32) })).status, 401);
ok('guide API rejects missing / bad token');

const post = (token, body) => req('/api/me/reports', { method: 'POST', token, body });
let r = await post(a.token, { work_date: day(2), start_time: '08:00', end_time: '12:30', note: 'בוקר' });
assert.equal(r.status, 201);
const id1 = r.data.id;
assert.equal((await post(a.token, { work_date: day(2), start_time: '16:00', end_time: '18:00' })).status, 201);
ok('create reports');

assert.equal((await post(a.token, { work_date: day(2), start_time: '12:00', end_time: '13:00' })).status, 400);
ok('overlap rejected');
assert.equal((await post(a.token, { work_date: day(2), start_time: '12:30', end_time: '13:00' })).status, 201);
ok('back-to-back (touching) allowed');
assert.equal((await post(a.token, { work_date: day(2), start_time: '10:00', end_time: '09:00' })).status, 400);
assert.equal((await post(a.token, { work_date: day(2), start_time: '25:00', end_time: '26:00' })).status, 400);
assert.equal((await post(a.token, { work_date: '2099-01-01', start_time: '08:00', end_time: '09:00' })).status, 400);
assert.equal((await post(a.token, { work_date: 'garbage', start_time: '08:00', end_time: '09:00' })).status, 400);
ok('bad times / future / garbage date rejected');

let me = (await req('/api/me', { token: a.token })).data;
assert.equal(me.reports.length, 3);
assert.equal(me.totalMinutes, 270 + 120 + 30);
assert.equal(me.days, 1);
ok('totals: 4:30 + 2:00 + 0:30 = 7:00');

// edit: moving a report onto an overlap must fail, a valid edit must work, and editing itself is not "overlap"
assert.equal((await req(`/api/me/reports/${id1}`, { method: 'PUT', token: a.token, body: { work_date: day(2), start_time: '08:00', end_time: '17:00' } })).status, 400);
assert.equal((await req(`/api/me/reports/${id1}`, { method: 'PUT', token: a.token, body: { work_date: day(2), start_time: '07:30', end_time: '12:30', note: 'עודכן' } })).status, 200);
me = (await req('/api/me', { token: a.token })).data;
assert.equal(me.reports.find((x) => x.id === id1).note, 'עודכן');
ok('edit own report (incl. self-overlap check)');

// isolation: B cannot see or touch A's reports
await post(b.token, { work_date: day(1), start_time: '09:00', end_time: '10:00' });
const meB = (await req('/api/me', { token: b.token })).data;
assert.equal(meB.reports.length, 1);
assert.equal(meB.guide.name, 'שרה לוי');
assert.equal((await req(`/api/me/reports/${id1}`, { method: 'PUT', token: b.token, body: { work_date: day(1), start_time: '09:00', end_time: '10:00' } })).status, 404);
assert.equal((await req(`/api/me/reports/${id1}`, { method: 'DELETE', token: b.token })).status, 404);
ok("guide B can't see/edit/delete guide A's reports");

// delete
const del = me.reports.find((x) => x.start_time === '12:30');
assert.equal((await req(`/api/me/reports/${del.id}`, { method: 'DELETE', token: a.token })).status, 200);
assert.equal((await req('/api/me', { token: a.token })).data.reports.length, 2);
ok('delete own report');

// --- Excel export ---
// The hourly rate is personal: David gets 100, Sarah has none so she gets the group default (80).
// --- travel vs regular work, and lecturers reporting for themselves ---
assert.equal((await post(a.token, { kind: 'travel', work_date: day(2), note: 'ירושלים' })).status, 201);
assert.equal((await post(a.token, { kind: 'travel', work_date: day(2) })).status, 201); // two drives the same day
assert.equal((await post(a.token, { kind: 'bogus', work_date: day(2) })).status, 400);
assert.equal((await post(a.token, { kind: 'travel', work_date: 'garbage' })).status, 400);
assert.equal((await post(a.token, { work_date: day(2) })).status, 400); // regular work still needs times
me = (await req('/api/me', { token: a.token })).data;
assert.equal(me.trips, 2);
assert.equal(me.totalMinutes, 420); // drives add no hours
assert.equal(me.days, 1);
assert.equal(me.reports.filter((x) => x.kind === 'travel').length, 2);
assert.equal((await post(lect.token, { work_date: day(1), start_time: '18:00', end_time: '19:00' })).status, 201);
assert.equal((await post(lect.token, { work_date: day(2), start_time: '20:00', end_time: '21:00' })).status, 201);
ok('travel vs work reports (no times for a drive, drives add no hours); lecturer reports');

assert.equal((await req(`/api/admin/guides/${a.id}`, { method: 'PATCH', body: { rate: 100, code: '777', travel_rate: 3.5 } })).status, 200);
assert.equal((await req(`/api/admin/guides/${a.id}`, { method: 'PATCH', body: { rate: -5 } })).status, 400);
ok('per-guide rate and employee code can be set (bad rate rejected)');

const loadXlsx = async (path) => {
  const r = await req(path);
  assert.equal(r.status, 200);
  assert.match(r.res.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.res.arrayBuffer()));
  return wb;
};
const SHEET = 'משכורות, מילגות אברכים והרצאות';
const dataRows = (wb) => {
  const out = [];
  wb.getWorksheet(SHEET).eachRow((row, n) => { if (n >= 4) out.push(row.values.slice(1)); });
  return out;
};

let wb = await loadXlsx(`/api/admin/export?period=${month}`);
assert.deepEqual(wb.worksheets.map((s) => s.name), [SHEET, 'סיכום חודשי', 'פירוט נוכחות']);
const hdr = wb.getWorksheet(SHEET).getRow(3).values.slice(1);
assert.deepEqual(hdr.slice(0, 5), ['חודש', 'מרכז', 'שם ', 'קוד עובד', 'סיווג הוצאה']);
assert.equal(hdr.length, 14);
let rows = dataRows(wb);
assert.equal(rows.length, 23 + 5, '23 office rows + David (work, travel) + Sarah + 2 lectures');
assert.equal(rows[0][2], 'ראש פרויקט לדוגמה'); // first seeded September row
assert.equal(rows[22][2], 'מנחה לדוגמה ב'); // last seeded October row
const david = rows.find((x) => x[2] === 'דוד כהן');
assert.equal(david[4], 'שכר מנחים - שעת הנחיה');
assert.equal(david[3], 777);
assert.equal(david[6], 1); // days
assert.equal(david[7], 7); // 07:30-12:30 (5h) + 16:00-18:00 (2h)
assert.equal(david[8], 100); // personal rate
assert.equal(david[11].result, 700);
assert.match(david[11].formula, /^I\d+\*H\d+$/);
const sarah = rows.find((x) => x[2] === 'שרה לוי');
assert.ok(sarah[8] == null, 'no rate is invented when none was set');
assert.match(sarah[11].formula, /^I\d+\*H\d+$/); // amount stays a live formula (0 until a rate is set)
assert.equal(sarah[0], 'נובמבר');
const trip = rows.find((x) => x[4] === 'נסיעות מנחים');
assert.equal(trip[2], 'דוד כהן');
assert.equal(trip[7], 2); // two trips
assert.equal(trip[8], 3.5);
assert.equal(trip[11].result, 7);
const lectures = rows.filter((x) => x[2] === 'חיים מרצה');
assert.equal(lectures.length, 2); // one row per lecture
assert.ok(lectures.every((x) => x[4] === 'הרצאות כללי (גברים ונשים)' && x[7] === 1 && x[8] === 600 && x[5] instanceof Date));
ok('Excel: office layout, 23 existing rows kept first, guide rows appended with personal/default rates');

// Exporting again must not duplicate the generated rows.
wb = await loadXlsx(`/api/admin/export?period=${month}`);
assert.equal(dataRows(wb).length, 28);
ok('re-export is idempotent (no duplicate rows)');
const summary = wb.getWorksheet('סיכום חודשי');
const sumRows = [];
summary.eachRow((row, n) => { if (n >= 4) sumRows.push(row.values.slice(1)); });
assert.ok(sumRows.some((x) => x[0] === 'נובמבר'));
assert.equal(sumRows.at(-1)[0], 'סה"כ');
ok('Excel: monthly summary sheet');
let detailRows = 0;
wb.getWorksheet('פירוט נוכחות').eachRow(() => detailRows++);
assert.equal(detailRows, 3 + 7); // title + subtitle + header + 7 reports (3 work, 2 drives, 2 lectures)
ok('Excel: attendance detail sheet');

// --- manual ledger rows ---
const mk = (o = {}) => ({ month: 'נובמבר', name: 'רכז לדוגמה', kind: 'שכר רכז', code: '1002', qty: 1, rate_ils: 5000, ...o });
const m1 = await req('/api/admin/ledger', { method: 'POST', body: mk() });
assert.equal(m1.status, 201);
assert.equal((await req('/api/admin/ledger', { method: 'POST', body: mk({ month: 'בלה' }) })).status, 400);
assert.equal((await req('/api/admin/ledger', { method: 'POST', body: mk({ rate_ils: 'abc' }) })).status, 400);
assert.equal((await req(`/api/admin/ledger/${m1.data.id}`, { method: 'PUT', body: mk({ rate_ils: 5500 }) })).status, 200);
let led = (await req('/api/admin/ledger')).data.rows;
assert.equal(led.find((x) => x.id === m1.data.id).rate_ils, 5500);
assert.equal(led.find((x) => x.id === m1.data.id).budget, 'ניהול'); // category filled from the office table
const autoRow = led.find((x) => x.source === 'auto');
assert.equal((await req(`/api/admin/ledger/${autoRow.id}`, { method: 'PUT', body: mk() })).status, 400);
assert.equal((await req(`/api/admin/ledger/${autoRow.id}`, { method: 'DELETE' })).status, 400);
assert.equal((await req(`/api/admin/ledger/${m1.data.id}`, { method: 'DELETE' })).status, 200);
assert.equal((await req('/api/admin/ledger')).data.rows.length, 28);
ok('manual ledger rows: add / edit / delete; generated rows are protected');
assert.equal((await req('/api/admin/ledger')).data.rows.filter((x) => x.source === 'seed').length, 23);

// --- closing a period freezes guides ---
const closedKey = (await req(`/api/admin/guides?period=${month}`)).data.period.key;
assert.equal((await req('/api/admin/period', { method: 'POST', body: { period: closedKey, action: 'close' } })).status, 200);
assert.equal((await post(a.token, { work_date: day(3), start_time: '08:00', end_time: '09:00' })).status, 400);
assert.equal((await req(`/api/me/reports/${id1}`, { method: 'DELETE', token: a.token })).status, 403);
assert.equal((await req('/api/me', { token: a.token })).data.period.closed, true);
ok('closed period: guides cannot add or delete');
assert.equal((await req('/api/admin/period', { method: 'POST', body: { period: closedKey, action: 'open' } })).status, 200);
assert.equal((await post(a.token, { work_date: day(3), start_time: '08:00', end_time: '09:00' })).status, 201);
ok('reopened period: editing works again');

// --- send without mail config fails cleanly ---
const send = await req('/api/admin/period', { method: 'POST', body: { period: closedKey, action: 'send' } });
assert.equal(send.status, 502);
ok('send-now without Resend config returns a clear error');

// --- cron ---
assert.equal((await req('/api/cron/export')).status, 401);
assert.equal((await req('/api/cron/export', { headers: { authorization: 'Bearer nope' } })).status, 401);
const cron = await req('/api/cron/export', { headers: { authorization: `Bearer ${CRON}` } });
assert.equal(cron.status, 502, 'mail not configured -> fails and leaves the period open');
ok('cron: requires secret; without mail config it fails loudly and does not close the period');

// --- link management ---
const regen = (await req(`/api/admin/guides/${b.id}`, { method: 'PATCH', body: { regenerate: true } })).data.guide;
assert.notEqual(regen.token, b.token);
assert.equal((await req('/api/me', { token: b.token })).status, 401);
assert.equal((await req('/api/me', { token: regen.token })).status, 200);
ok('regenerate link: old link dies, new link works');
await req(`/api/admin/guides/${b.id}`, { method: 'PATCH', body: { active: false } });
assert.equal((await req('/api/me', { token: regen.token })).status, 401);
ok('deactivated guide is locked out');

// --- logout ---
await req('/api/admin/login', { method: 'DELETE' });
cookie = '';
assert.equal((await req('/api/admin/guides')).status, 401);
ok('logout');

console.log('\nAll smoke checks passed.');
