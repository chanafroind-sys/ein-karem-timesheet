// Builds the Excel file. Sheet 1 is the office's payroll sheet in its exact column layout (A..N,
// headers on row 3), holding EVERY row accumulated so far, so each month's file simply has more rows.
// All styling lives here, so a change of look or layout touches only this file.
import ExcelJS from 'exceljs';
import { CENTER, START_DAY } from './config';
import { MINUTES_SQL, query } from './db';
import { LedgerRow, MONTH_ORDER, listLedger, monthIndex } from './ledger';
import { fmtDuration, periodLabel, periodRange, weekdayName } from './time';

// ---- look ----------------------------------------------------------------------------------
const FONT = 'Arial';
const INK = 'FF1B2A3A';
const MUTED = 'FF8794A3';
const ACCENT = 'FF2B5C8A';
const HEAD_FILL = 'FFEAEFF5';
const HAIR = 'FFE6EAF0';
const MONTH_RULE = 'FFB4C0CF';
const BAND = 'FFF7F9FC';

/** Soft background + matching dark text for each budget category. */
const CHIPS: Record<string, { fill: string; ink: string }> = {
  'חינוך': { fill: 'FFE4EEF9', ink: 'FF1D4E89' },
  'ניהול': { fill: 'FFEEE9F8', ink: 'FF5B3F9A' },
  'תפעול': { fill: 'FFFDF0D9', ink: 'FF8A5A00' },
  'כלכלה ופעילות': { fill: 'FFE3F3E8', ink: 'FF216E3A' },
  'גיוס כספים': { fill: 'FFFBE6EE', ink: 'FF9B2C57' },
};
const chipFor = (b: string | null) => (b ? CHIPS[b] : undefined) ?? { fill: 'FFEFF1F4', ink: 'FF55606D' };

/** Zero reads as a quiet dash instead of a wall of 0.00. */
const MONEY = '#,##0.00;-#,##0.00;"–"';
const MONEY_ILS = '#,##0.00 "₪";-#,##0.00 "₪";"–"';
const HOURS = '#,##0.00;-#,##0.00;"–"';

export const PAYROLL_SHEET = 'משכורות, מילגות אברכים והרצאות';
const FIRST = 4; // first data row, as in the office template
const LAST_FORMULA_ROW = 2000; // totals/summary ranges leave room for rows added later

const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const hair: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: HAIR } };

function headerRow(row: ExcelJS.Row, cols: number) {
  row.height = 30;
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    cell.fill = solid(HEAD_FILL);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: ACCENT } } };
  }
}

type Align = 'center' | 'right';
interface BodyOpts { align?: Align; fill?: string | null; muted?: boolean; bold?: boolean; ruleTop?: boolean }

function bodyCell(cell: ExcelJS.Cell, o: BodyOpts = {}) {
  cell.font = { name: FONT, size: 10, bold: o.bold, color: { argb: o.muted ? MUTED : INK } };
  cell.alignment = { horizontal: o.align ?? 'center', vertical: 'middle', indent: o.align === 'right' ? 1 : 0 };
  cell.border = {
    bottom: hair,
    ...(o.ruleTop ? { top: { style: 'thin', color: { argb: MONTH_RULE } } } : {}),
  };
  if (o.fill) cell.fill = solid(o.fill);
}

/** Category as coloured text with a dot. The dot comes from the number format, so the cell value stays the plain category name. */
function chip(cell: ExcelJS.Cell, label: string | null) {
  const c = chipFor(label);
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: c.ink } };
  cell.numFmt = '"● "@';
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
}

const asCode = (c: string | null) => (c && /^\d+$/.test(c) ? Number(c) : c);

function asDate(s: string | null): Date | string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : s;
}

const amountOf = (r: LedgerRow) => (r.rate_ils ?? 0) * (r.qty ?? 0);

export function exportFileName(key: string) {
  return `timesheet-${key}.xlsx`;
}

export async function buildWorkbook(key: string): Promise<Buffer> {
  const ledger = await listLedger();
  const { start, end } = periodRange(key, START_DAY);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Timesheet';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true; // Excel recomputes every formula when the file is opened

  addPayrollSheet(wb, ledger, key);
  addMonthlySummary(wb, ledger);
  await addAttendanceSheet(wb, start, end, key);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- sheet 1: payroll rows

function addPayrollSheet(wb: ExcelJS.Workbook, rows: LedgerRow[], key: string) {
  const ws = wb.addWorksheet(PAYROLL_SHEET, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3, xSplit: 3, showGridLines: false }],
    properties: { tabColor: { argb: ACCENT }, defaultRowHeight: 22 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    headerFooter: { oddFooter: '&C&"Arial,Regular"&9&P / &N' },
  });
  // A month, B center, C name, D code, E kind, F date, G days, H qty, I rate, J rate $, K total $, L total ₪, M notes, N budget
  [10, 10, 25, 11, 31, 13, 13, 12, 13, 12, 12, 15, 28, 17].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Rows 1-2: title on the right, grand total on the left. Kept above the header so rows can keep being appended below.
  ws.mergeCells('A1:H1');
  const title = ws.getCell('A1');
  title.value = 'דוח משכורות, מלגות אברכים והרצאות';
  title.font = { name: FONT, size: 18, bold: true, color: { argb: INK } };
  title.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 34;

  ws.mergeCells('A2:H2');
  const sub = ws.getCell('A2');
  sub.value = `${CENTER}  ·  מעודכן עד ${periodLabel(key, START_DAY)}  ·  ${rows.length} שורות`;
  sub.font = { name: FONT, size: 10, color: { argb: MUTED } };
  sub.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 24;

  const total = rows.reduce((a, r) => a + amountOf(r), 0);
  const lbl = ws.getCell('L1');
  lbl.value = 'סה״כ לתשלום';
  lbl.font = { name: FONT, size: 9, bold: true, color: { argb: MUTED } };
  lbl.alignment = { horizontal: 'center', vertical: 'bottom' };
  const tot = ws.getCell('L2');
  tot.value = { formula: `SUBTOTAL(109,L${FIRST}:L${LAST_FORMULA_ROW})`, result: total };
  tot.numFmt = MONEY_ILS;
  tot.font = { name: FONT, size: 13, bold: true, color: { argb: ACCENT } };
  tot.fill = solid('FFE4EEF9');
  tot.alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 3: the office template's headers, unchanged.
  const hdr = ws.getRow(3);
  [
    'חודש', 'מרכז', 'שם ', 'קוד עובד', 'סיווג הוצאה', 'תאריך ', "מס' ימי עבודה", "מס'- כמות",
    'תעריף בש"ח', 'תעריף ב$', 'סה"כ ב$', 'סה"כ בש"ח', 'הערות', 'קטגוריה תקציבית',
  ].forEach((t, i) => (hdr.getCell(i + 1).value = t));
  headerRow(hdr, 14);

  // Data rows. A thin rule marks where a new month starts; repeated month names fade to grey.
  let prevMonth = '';
  let tint = false;
  rows.forEach((r, i) => {
    const newMonth = r.month !== prevMonth;
    if (newMonth) tint = !tint;
    prevMonth = r.month;
    const fill = tint ? BAND : null;
    const n = FIRST + i;
    const row = ws.getRow(n);
    const qty = r.qty ?? 0;
    const ruleTop = newMonth && i > 0;

    row.getCell(1).value = r.month;
    row.getCell(2).value = r.center;
    row.getCell(3).value = r.name;
    row.getCell(4).value = asCode(r.code);
    row.getCell(5).value = r.kind;
    row.getCell(6).value = asDate(r.work_date);
    row.getCell(7).value = r.days;
    row.getCell(8).value = r.qty;
    row.getCell(9).value = r.rate_ils;
    row.getCell(10).value = r.rate_usd;
    row.getCell(11).value = { formula: `J${n}*H${n}`, result: (r.rate_usd ?? 0) * qty };
    row.getCell(12).value = { formula: `I${n}*H${n}`, result: amountOf(r) };
    row.getCell(13).value = r.note;
    row.getCell(14).value = r.budget;
    row.height = 22;

    for (let c = 1; c <= 14; c++) {
      bodyCell(row.getCell(c), {
        fill, ruleTop,
        align: c === 3 || c === 5 || c === 13 ? 'right' : 'center',
        muted: (c === 1 && !newMonth) || c === 2 || c === 4 || c === 10 || c === 11,
        bold: c === 1 && newMonth,
      });
    }
    row.getCell(6).numFmt = 'dd/mm/yyyy';
    row.getCell(7).numFmt = '0';
    row.getCell(8).numFmt = HOURS;
    for (const c of [9, 10, 11]) row.getCell(c).numFmt = MONEY;
    row.getCell(12).numFmt = MONEY_ILS;
    row.getCell(12).font = { name: FONT, size: 10, bold: true, color: { argb: INK } };
    chip(row.getCell(14), r.budget);
  });

  ws.autoFilter = { from: 'A3', to: `N${Math.max(FIRST, FIRST + rows.length - 1)}` };
  ws.pageSetup.printTitlesRow = '3:3';
}

// ---------------------------------------------------------------- sheet 2: monthly totals

function addMonthlySummary(wb: ExcelJS.Workbook, rows: LedgerRow[]) {
  const ws = wb.addWorksheet('סיכום חודשי', {
    views: [{ rightToLeft: true, showGridLines: false }],
    properties: { tabColor: { argb: 'FF7FA6CC' }, defaultRowHeight: 22 },
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const months = [...new Set(rows.map((r) => r.month))].sort((a, b) => monthIndex(a) - monthIndex(b));
  const budgets = [...new Set(rows.map((r) => r.budget || 'ללא קטגוריה'))].sort();
  const cols = ['חודש', ...budgets, 'סה"כ'];
  cols.forEach((_, i) => (ws.getColumn(i + 1).width = i === 0 ? 14 : 17));

  ws.mergeCells(1, 1, 1, cols.length);
  const t = ws.getCell(1, 1);
  t.value = 'סיכום תשלומים לפי חודש';
  t.font = { name: FONT, size: 18, bold: true, color: { argb: INK } };
  t.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 34;
  ws.mergeCells(2, 1, 2, cols.length);
  const s = ws.getCell(2, 1);
  s.value = 'בשקלים, לפי הקטגוריה התקציבית של כל שורה';
  s.font = { name: FONT, size: 10, color: { argb: MUTED } };
  s.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };

  const hdr = ws.getRow(3);
  cols.forEach((c, i) => (hdr.getCell(i + 1).value = c));
  headerRow(hdr, cols.length);

  const P = `'${PAYROLL_SHEET}'`;
  const amount = (m: string | null, b: string | null) =>
    rows.filter((r) => (m === null || r.month === m) && (b === null || (r.budget || 'ללא קטגוריה') === b))
      .reduce((a, r) => a + amountOf(r), 0);

  months.forEach((m, i) => {
    const n = 4 + i;
    const row = ws.getRow(n);
    row.height = 24;
    row.getCell(1).value = m;
    budgets.forEach((b, j) => {
      const colLetter = ws.getColumn(2 + j).letter;
      const critBudget = b === 'ללא קטגוריה' ? '""' : `${colLetter}$3`;
      row.getCell(2 + j).value = {
        formula: `SUMIFS(${P}!$L$${FIRST}:$L$${LAST_FORMULA_ROW},${P}!$A$${FIRST}:$A$${LAST_FORMULA_ROW},$A${n},${P}!$N$${FIRST}:$N$${LAST_FORMULA_ROW},${critBudget})`,
        result: amount(m, b),
      };
    });
    const first = ws.getColumn(2).letter;
    const last = ws.getColumn(1 + budgets.length).letter;
    row.getCell(cols.length).value = { formula: `SUM(${first}${n}:${last}${n})`, result: amount(m, null) };
    for (let c = 1; c <= cols.length; c++) {
      bodyCell(row.getCell(c), { fill: i % 2 === 0 ? BAND : null, bold: c === 1 || c === cols.length });
      if (c > 1) row.getCell(c).numFmt = MONEY_ILS;
    }
  });

  const tn = 4 + months.length;
  const trow = ws.getRow(tn);
  trow.height = 28;
  trow.getCell(1).value = 'סה"כ';
  for (let c = 2; c <= cols.length; c++) {
    const L = ws.getColumn(c).letter;
    const result = c === cols.length ? amount(null, null) : amount(null, budgets[c - 2]);
    trow.getCell(c).value = { formula: `SUM(${L}4:${L}${tn - 1})`, result };
    trow.getCell(c).numFmt = MONEY_ILS;
  }
  for (let c = 1; c <= cols.length; c++) {
    const cell = trow.getCell(c);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: INK } };
    cell.fill = solid(HEAD_FILL);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { top: { style: 'medium', color: { argb: ACCENT } } };
  }
  if (!months.length) ws.getCell(4, 1).value = `אין עדיין נתונים (${MONTH_ORDER[0]} ואילך)`;
}

// ---------------------------------------------------------------- sheet 3: attendance detail

async function addAttendanceSheet(wb: ExcelJS.Workbook, start: string, end: string, key: string) {
  const detail = await query(
    `SELECT g.name, g.role, r.kind, to_char(r.work_date,'YYYY-MM-DD') AS work_date,
            r.start_time, r.end_time, r.note, ${MINUTES_SQL}::int AS minutes
       FROM reports r JOIN guides g ON g.id = r.guide_id
      WHERE r.work_date BETWEEN $1 AND $2
      ORDER BY g.role, g.name, r.work_date, r.start_time NULLS LAST, r.id`,
    [start, end],
  );
  const ws = wb.addWorksheet('פירוט נוכחות', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 3, showGridLines: false }],
    properties: { tabColor: { argb: 'FFB4C6DA' }, defaultRowHeight: 22 },
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  [14, 26, 13, 10, 10, 9, 9, 9, 11, 36].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('A1:J1');
  const t = ws.getCell('A1');
  t.value = 'פירוט נוכחות';
  t.font = { name: FONT, size: 18, bold: true, color: { argb: INK } };
  t.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 34;
  ws.mergeCells('A2:J2');
  const s = ws.getCell('A2');
  s.value = `${periodLabel(key, START_DAY)}  ·  ${detail.length} דיווחים`;
  s.font = { name: FONT, size: 10, color: { argb: MUTED } };
  s.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };

  const hdr = ws.getRow(3);
  ['קבוצה', 'שם', 'תאריך', 'יום', 'סוג', 'כניסה', 'יציאה', 'שעות', 'שעות:דקות', 'הערה'].forEach((h, i) => (hdr.getCell(i + 1).value = h));
  headerRow(hdr, 10);

  let prev = '';
  let tint = false;
  detail.forEach((r, i) => {
    const newPerson = r.name !== prev;
    if (newPerson) { tint = !tint; prev = r.name; }
    const [y, m, d] = (r.work_date as string).split('-').map(Number);
    const travel = r.kind === 'travel';
    const row = ws.getRow(4 + i);
    row.height = 22;
    [r.role, r.name, new Date(Date.UTC(y, m - 1, d)), weekdayName(r.work_date), travel ? 'נסיעה' : 'עבודה',
      r.start_time, r.end_time, travel ? null : r.minutes / 60, travel ? null : fmtDuration(r.minutes), r.note]
      .forEach((v, c) => (row.getCell(c + 1).value = v as ExcelJS.CellValue));
    for (let c = 1; c <= 10; c++) {
      bodyCell(row.getCell(c), {
        fill: tint ? BAND : null,
        align: c === 2 || c === 10 ? 'right' : 'center',
        ruleTop: newPerson && i > 0,
        muted: c === 1 || c === 4,
        bold: c === 2 && newPerson,
      });
    }
    row.getCell(3).numFmt = 'dd/mm/yyyy';
    row.getCell(8).numFmt = HOURS;
    const kindCell = row.getCell(5);
    kindCell.font = { name: FONT, size: 9, bold: true, color: { argb: travel ? 'FF8A5A00' : 'FF1D4E89' } };
    kindCell.fill = solid(travel ? 'FFFDF0D9' : 'FFE4EEF9');
  });
  ws.autoFilter = { from: 'A3', to: `J${Math.max(4, 3 + detail.length)}` };
}
