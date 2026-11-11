'use client';

import { useCallback, useEffect, useState } from 'react';
import { fmtDuration, weekdayName } from '../../../lib/time';

type Kind = 'work' | 'travel';
type Report = {
  id: number; kind: Kind; work_date: string; start_time: string | null; end_time: string | null;
  note: string; minutes: number | null;
};
type Period = {
  key: string; start: string; end: string; today: string; label: string;
  prevKey: string; nextKey: string | null; closed: boolean;
};
type Data = {
  guide: { name: string; role: string };
  period: Period;
  reports: Report[];
  totalMinutes: number;
  days: number;
  trips: number;
};

const nowHM = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date());

const fmtDay = (d: string) => `יום ${weekdayName(d)} · ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

export default function GuideApp({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const [form, setForm] = useState<{ kind: Kind; date: string; start: string; end: string; note: string }>(
    { kind: 'work', date: '', start: '', end: '', note: '' },
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const api = useCallback(
    (path: string, init: RequestInit = {}) =>
      fetch(path, {
        ...init,
        headers: { 'x-guide-token': token, 'Content-Type': 'application/json', ...(init.headers || {}) },
      }),
    [token],
  );

  const load = useCallback(
    async (period?: string) => {
      setLoadErr('');
      try {
        const res = await api(`/api/me${period ? `?period=${period}` : ''}`);
        if (res.status === 401) return setInvalid(true);
        if (!res.ok) throw new Error();
        const d: Data = await res.json();
        setData(d);
        // Keep the date field inside the visible period.
        const max = d.period.end < d.period.today ? d.period.end : d.period.today;
        setForm((f) => (f.date && f.date >= d.period.start && f.date <= max ? f : { ...f, date: max }));
      } catch {
        setLoadErr('לא הצלחנו לטעון את הנתונים. בדקו חיבור לאינטרנט ורעננו את הדף.');
      }
    },
    [api],
  );

  useEffect(() => { load(); }, [load]);

  function resetForm(keepDate: string) {
    setEditing(null);
    setForm((f) => ({ kind: f.kind, date: keepDate, start: '', end: '', note: '' }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      const res = await api(editing ? `/api/me/reports/${editing}` : '/api/me/reports', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          kind: form.kind, work_date: form.date, note: form.note,
          ...(form.kind === 'work' ? { start_time: form.start, end_time: form.end } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'השמירה נכשלה'); return; }
      setMsg(editing ? 'הדיווח עודכן ✓' : 'הדיווח נשמר ✓');
      resetForm(form.date);
      await load(data?.period.key);
    } catch {
      setErr('השמירה נכשלה. בדקו חיבור לאינטרנט ונסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Report) {
    const what = r.kind === 'travel' ? 'נסיעה' : `${r.start_time}–${r.end_time}`;
    if (!confirm(`למחוק את הדיווח מ-${fmtDay(r.work_date)} (${what})?`)) return;
    setErr(''); setMsg('');
    const res = await api(`/api/me/reports/${r.id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || 'המחיקה נכשלה'); return; }
    if (editing === r.id) resetForm(form.date);
    setMsg('הדיווח נמחק');
    await load(data?.period.key);
  }

  function startEdit(r: Report) {
    setEditing(r.id);
    setForm({ kind: r.kind, date: r.work_date, start: r.start_time ?? '', end: r.end_time ?? '', note: r.note });
    setErr(''); setMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (invalid) {
    return (
      <main className="wrap center">
        <h1>הקישור לא תקין</h1>
        <p className="sub">ייתכן שהקישור הוחלף או בוטל. בקשו מהמנהל קישור חדש.</p>
      </main>
    );
  }
  if (loadErr) return <main className="wrap"><div className="alert err">{loadErr}</div></main>;
  if (!data) return <main className="wrap center"><p className="sub">טוען…</p></main>;

  const { period } = data;
  const maxDate = period.end < period.today ? period.end : period.today;
  const workLabel = data.guide.role === 'מרצים' ? 'הרצאה' : 'עבודה';
  const isTravel = form.kind === 'travel';

  return (
    <main className="wrap">
      <h1>שלום, {data.guide.name}</h1>
      <p className="sub">{data.guide.role} · דיווח שעות נוכחות</p>

      <div className="card">
        <div className="period-bar">
          <button className="small" onClick={() => load(period.prevKey)} aria-label="התקופה הקודמת">›</button>
          <div className="label">{period.label}</div>
          <button className="small" disabled={!period.nextKey} onClick={() => period.nextKey && load(period.nextKey)} aria-label="התקופה הבאה">‹</button>
        </div>
        <div className="stats">
          <div className="stat"><b>{fmtDuration(data.totalMinutes)}</b><span>סה״כ שעות</span></div>
          <div className="stat"><b>{data.days}</b><span>ימי נוכחות</span></div>
          <div className="stat"><b>{data.trips}</b><span>נסיעות</span></div>
        </div>
      </div>

      {period.closed ? (
        <div className="alert warn">התקופה הזו נסגרה והועברה לטיפול, ולכן אי אפשר לשנות בה דיווחים. לתיקון פנו למנהל.</div>
      ) : (
        <form className="card" onSubmit={save}>
          <h2>{editing ? 'עריכת דיווח' : 'דיווח חדש'}</h2>
          {err && <div className="alert err" role="alert">{err}</div>}
          {msg && <div className="alert ok" role="status">{msg}</div>}
          <div className="seg" role="group" aria-label="סוג הדיווח">
            <button type="button" aria-pressed={!isTravel} className={!isTravel ? 'on' : ''}
              onClick={() => setForm({ ...form, kind: 'work' })}>{workLabel}</button>
            <button type="button" aria-pressed={isTravel} className={isTravel ? 'on' : ''}
              onClick={() => setForm({ ...form, kind: 'travel' })}>נסיעה</button>
          </div>
          <div className="field">
            <label htmlFor="date">יום</label>
            <input id="date" type="date" required value={form.date} min={period.start} max={maxDate}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          {!isTravel && (
            <div className="grid2">
              <div className="field">
                <label htmlFor="start">כניסה</label>
                <input id="start" type="time" required value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })} />
                <button type="button" className="now" onClick={() => setForm({ ...form, start: nowHM() })}>עכשיו</button>
              </div>
              <div className="field">
                <label htmlFor="end">יציאה</label>
                <input id="end" type="time" required value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })} />
                <button type="button" className="now" onClick={() => setForm({ ...form, end: nowHM() })}>עכשיו</button>
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="note">{isTravel ? 'לאן נסעתם (לא חובה)' : 'הערה (לא חובה)'}</label>
            <input id="note" type="text" maxLength={300} value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div className="row-actions">
            <button className="primary" style={{ flex: 1 }} disabled={busy}>{busy ? 'שומר…' : editing ? 'עדכון' : 'שמירה'}</button>
            {editing && <button type="button" onClick={() => { resetForm(form.date); setErr(''); }}>ביטול</button>}
          </div>
        </form>
      )}

      <div className="card">
        <h2>הדיווחים שלי בתקופה זו</h2>
        {data.reports.length === 0 ? (
          <div className="empty">עדיין אין דיווחים בתקופה הזו</div>
        ) : (
          data.reports.map((r) => (
            <div className="report" key={r.id}>
              <div>
                <div className="when">{fmtDay(r.work_date)}</div>
                {r.kind === 'travel' ? (
                  <div><span className="pill">נסיעה</span></div>
                ) : (
                  <div><span className="times">{r.start_time} – {r.end_time}</span> <span className="pill">{fmtDuration(r.minutes ?? 0)}</span></div>
                )}
                {r.note && <div className="note">{r.note}</div>}
              </div>
              {!period.closed && (
                <div className="row-actions">
                  <button className="small" onClick={() => startEdit(r)}>עריכה</button>
                  <button className="small danger" onClick={() => remove(r)}>מחיקה</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
