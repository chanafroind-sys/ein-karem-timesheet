'use client';

import { useCallback, useEffect, useState } from 'react';

type Row = {
  id: number; month: string; center: string; name: string; code: string | null; kind: string;
  work_date: string | null; days: number | null; qty: number | null; rate_ils: number | null;
  rate_usd: number | null; note: string | null; budget: string | null; source: 'seed' | 'manual' | 'auto';
};
type Kat = { kind: string; rate: number | null; budget: string | null };

const EMPTY = { month: '', name: '', code: '', kind: '', days: '', qty: '', rate_ils: '', note: '', budget: '' };
const fmt = (n: number | null) => (n == null ? '' : n.toLocaleString('he-IL', { maximumFractionDigits: 2 }));

async function call(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

export default function LedgerApp() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [kat, setKat] = useState<Kat[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [center, setCenter] = useState('');
  const [current, setCurrent] = useState<{ key: string; label: string } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await call('/api/admin/ledger');
    if (r.status === 401) { location.href = '/admin'; return; }
    setRows(r.data.rows);
    setKat(r.data.kat);
    setMonths(r.data.months);
    setCenter(r.data.center);
    setCurrent(r.data.currentPeriod);
    setForm((f) => (f.month ? f : { ...f, month: r.data.months[0] }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function pickKind(kind: string) {
    const k = kat.find((x) => x.kind === kind);
    // Only the budget category is filled in. Rates are never filled in for you.
    setForm((f) => ({ ...f, kind, budget: k?.budget ?? f.budget }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = { ...form, center };
    const r = editing ? await call(`/api/admin/ledger/${editing}`, 'PUT', body) : await call('/api/admin/ledger', 'POST', body);
    setBusy(false);
    if (!r.ok) return setNotice({ kind: 'err', text: r.data.error || 'השמירה נכשלה' });
    setNotice({ kind: 'ok', text: editing ? 'השורה עודכנה' : 'השורה נוספה לגיליון' });
    setEditing(null);
    setForm({ ...EMPTY, month: form.month });
    load();
  }

  function edit(r: Row) {
    setEditing(r.id);
    setForm({
      month: r.month, name: r.name, code: r.code ?? '', kind: r.kind, days: r.days?.toString() ?? '',
      qty: r.qty?.toString() ?? '', rate_ils: r.rate_ils?.toString() ?? '', note: r.note ?? '', budget: r.budget ?? '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(r: Row) {
    if (!confirm(`למחוק את השורה: ${r.name} · ${r.kind} · ${r.month}?`)) return;
    const res = await call(`/api/admin/ledger/${r.id}`, 'DELETE');
    if (!res.ok) return setNotice({ kind: 'err', text: res.data.error || 'המחיקה נכשלה' });
    setNotice({ kind: 'ok', text: 'השורה נמחקה' });
    load();
  }

  async function syncNow() {
    if (!current) return;
    setBusy(true);
    const r = await call('/api/admin/period', 'POST', { period: current.key, action: 'sync' });
    setBusy(false);
    if (!r.ok) return setNotice({ kind: 'err', text: r.data.error || 'העדכון נכשל' });
    const s = r.data.sync;
    const warn = s.missingRate.length ? `עדיין אין תעריף ל: ${s.missingRate.join(', ')}` : '';
    setNotice({ kind: warn ? 'err' : 'ok', text: `נוספו ${s.inserted} שורות מהשעות של ${current.label}.${warn ? ' ' + warn : ''}` });
    load();
  }

  if (!rows) return <main className="wrap center"><p className="sub">טוען…</p></main>;

  const shown = rows.filter((r) => !filter || [r.name, r.kind, r.month].some((x) => x.includes(filter)));
  const total = rows.reduce((a, r) => a + (r.rate_ils ?? 0) * (r.qty ?? 0), 0);
  const tag = (s: Row['source']) => (s === 'auto' ? 'מהשעות' : s === 'seed' ? 'מהקובץ' : 'ידני');

  return (
    <main className="wrap wide">
      <div className="period-bar">
        <h1 style={{ margin: 0 }}>גיליון משכורות</h1>
        <a className="btn small" href="/admin">חזרה לניהול</a>
      </div>
      <p className="sub">
        כל השורות של השנה במקום אחד. בכל חודש מתווספות שורות חדשות, והאקסל תמיד כולל את כולן.
        סה״כ בגיליון: <b>{fmt(total)} ₪</b> · {rows.length} שורות
      </p>

      {notice && <div className={`alert ${notice.kind}`} role="status" onClick={() => setNotice(null)}>{notice.text}</div>}

      <section className="card">
        <h2>עדכון שעות הנחיה</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          מוסיף לגיליון שורה לכל מנחה/מנחה/אברך לפי השעות שדווחו ב{current?.label}. אפשר ללחוץ שוב אחרי שינויים והשורות מתעדכנות (לא כפילות).
          בסגירת תקופה והבדיקה האוטומטית ב-19 זה קורה לבד.
        </p>
        <button className="primary" disabled={busy} onClick={syncNow}>עדכון מהשעות של {current?.label}</button>
      </section>

      <form className="card" onSubmit={save}>
        <h2>{editing ? 'עריכת שורה' : 'הוספת שורה ידנית (רכז, מזכירה, נסיעות, מרצה…)'}</h2>
        <div className="grid2">
          <div className="field">
            <label htmlFor="m">חודש</label>
            <select id="m" value={form.month} onChange={(e) => set('month', e.target.value)}>
              {months.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="n">שם</label>
            <input id="n" required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="k">סיווג הוצאה</label>
            <input id="k" list="kinds" required value={form.kind} onChange={(e) => pickKind(e.target.value)} />
            <datalist id="kinds">{kat.map((k) => <option key={k.kind} value={k.kind} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="c">קוד עובד</label>
            <input id="c" dir="ltr" value={form.code} onChange={(e) => set('code', e.target.value)} />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="d">ימי עבודה</label>
            <input id="d" type="number" min="0" step="1" value={form.days} onChange={(e) => set('days', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="q">כמות (שעות)</label>
            <input id="q" type="number" min="0" step="0.01" value={form.qty} onChange={(e) => set('qty', e.target.value)} />
          </div>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="r">תעריף בש״ח</label>
            <input id="r" type="number" min="0" step="0.01" value={form.rate_ils} onChange={(e) => set('rate_ils', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="b">קטגוריה תקציבית</label>
            <input id="b" value={form.budget} onChange={(e) => set('budget', e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="o">הערות</label>
          <input id="o" maxLength={300} value={form.note} onChange={(e) => set('note', e.target.value)} />
        </div>
        <div className="row-actions">
          <button className="primary" disabled={busy}>{editing ? 'עדכון' : 'הוספה'}</button>
          {editing && <button type="button" onClick={() => { setEditing(null); setForm({ ...EMPTY, month: form.month }); }}>ביטול</button>}
        </div>
      </form>

      <section className="card">
        <div className="field">
          <label htmlFor="f">חיפוש (שם, סיווג או חודש)</label>
          <input id="f" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {shown.length === 0 && <div className="empty">אין שורות</div>}
        {shown.map((r) => (
          <div className="guide-row" key={r.id}>
            <div className="who">
              <b>{r.name} <span className="tag">{tag(r.source)}</span></b>
              <span>{r.month} · {r.kind}{r.code ? ` · קוד ${r.code}` : ''}</span>
            </div>
            <div>
              <span className="pill">{fmt((r.rate_ils ?? 0) * (r.qty ?? 0))} ₪</span>{' '}
              <span className="sub">{r.qty != null ? `${fmt(r.qty)} × ${fmt(r.rate_ils)}` : ''}</span>
            </div>
            {r.source !== 'auto' && (
              <div className="row-actions">
                <button className="small" onClick={() => edit(r)}>עריכה</button>
                <button className="small danger" onClick={() => remove(r)}>מחיקה</button>
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
