import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDate, isTime, toMinutes, fmtDuration, addDays, periodKeyOf, periodRange,
  periodLabel, endedPeriodKey, shiftKey, todayIL,
} from '../lib/time.ts';

test('date/time validation', () => {
  assert.ok(isDate('2026-02-28'));
  assert.ok(!isDate('2026-02-30'));
  assert.ok(!isDate('2026-2-3'));
  assert.ok(isTime('00:00') && isTime('23:59'));
  assert.ok(!isTime('24:00') && !isTime('9:30') && !isTime('12:60'));
});

test('durations', () => {
  assert.equal(toMinutes('08:30'), 510);
  assert.equal(fmtDuration(510), '8:30');
  assert.equal(fmtDuration(65), '1:05');
});

test('addDays / shiftKey cross month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftKey('2026-01', -1), '2025-12');
  assert.equal(shiftKey('2026-12', 1), '2027-01');
});

test('calendar-month periods (startDay=1)', () => {
  assert.equal(periodKeyOf('2026-11-04', 1), '2026-11');
  assert.deepEqual(periodRange('2026-11', 1), { start: '2026-11-01', end: '2026-11-30' });
  assert.deepEqual(periodRange('2026-02', 1), { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(periodLabel('2026-11', 1), 'נובמבר 2026');
});

test('20th-to-19th periods (startDay=20)', () => {
  assert.equal(periodKeyOf('2026-11-19', 20), '2026-10');
  assert.equal(periodKeyOf('2026-11-20', 20), '2026-11');
  assert.equal(periodKeyOf('2027-01-05', 20), '2026-12');
  assert.deepEqual(periodRange('2026-10', 20), { start: '2026-10-20', end: '2026-11-19' });
  assert.deepEqual(periodRange('2026-12', 20), { start: '2026-12-20', end: '2027-01-19' });
});

test('endedPeriodKey: the period that ends today counts as ended', () => {
  assert.equal(endedPeriodKey('2026-11-19', 20), '2026-10');
  assert.equal(endedPeriodKey('2026-11-18', 20), '2026-09');
  assert.equal(endedPeriodKey('2026-11-19', 1), '2026-10');
  assert.equal(endedPeriodKey('2026-11-30', 1), '2026-11');
});

test('todayIL uses Israel time, not UTC', () => {
  // 22:30 UTC on Nov 3 is already Nov 4 in Israel (UTC+2 in winter).
  assert.equal(todayIL(new Date('2026-11-03T22:30:00Z')), '2026-11-04');
  assert.equal(todayIL(new Date('2026-11-03T21:30:00Z')), '2026-11-03');
});
