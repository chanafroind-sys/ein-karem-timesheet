'use client';

import { useCallback, useEffect, useState } from 'react';
import { fmtDuration } from '../../lib/time';

type Guide = {
  id: number; name: string; role: string; email: string | null; code: string | null; rate: number | null;
  travel_rate: number | null; token: string; active: boolean; days: number; minutes: number; trips: number;
};
type Period = { key: string; label: string; prevKey: string; nextKey: string | null; closed: boolean };

async function call(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: j };
}

export default function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');

  const [guides, setGuides] = useState<Guide[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [newRole, setNewRole] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newRate, setNewRate] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);

  const ok = (text: string) => setNotice({ kind: 'ok', text });
  const bad = (text: string) => setNotice({ kind: 'err', text });

  const load = useCallback(async (periodKey?: string) => {
    const r = await call(`/api/admin/guides${periodKey ? `?period=${periodKey}` : ''}`);
    if (r.status === 401) { setAuthed(false); return; }
    if (!r.ok) { bad(r.data.error || 'שגיאה בטעינה'); return; }
    setAuthed(true);
    setGuides(r.data.guides);
    setGroups(r.data.groups);
    setPeriod(r.data.period);
    setNewRole((cur) => cur || r.data.groups[0]);
  }, []);

  useEffect(() => {
    call('/api/admin/login').then((r) => {
      setConfigured(r.data.configured !== false);
      if (r.data.authed) load(); else setAuthed(false);
    });
  }, [load]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr('');
    const r = await call('/api/admin/login', 'POST', { password });
    if (!r.ok) { setLoginErr(r.data.error || 'שגיאה'); return; }
    setPassword('');
    load();
  }

  async function logout() {
    await call('/api/admin/login', 'DELETE');
    setAuthed(false);
  }

  const linkOf = (g: Guide) => `${location.origin}/g/${g.token}`;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      ok(`${what} הועתק`);
    } catch {
      window.prompt('העתיקו ידנית:', text);
    }
  }

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call('/api/admin/guides', 'POST', { name: newName, role: newRole, email: newEmail, code: newCode, rate: newRate });
    setBusy(false);
    if (!r.ok) return bad(r.data.error || 'ההוספה נכשלה');
    setNewName(''); setNewEmail(''); setNewCode(''); setNewRate('');
    ok(`${r.data.created[0].name} נוסף/ה. הקישור האישי מופיע ברשימה.`);
    load(period?.key);
  }

  async function addBulk(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await call('/api/admin/guides', 'POST', { bulk, role: newRole });
    setBusy(false);
    if (!r.ok) return bad(r.data.error || 'ההוספה נכשלה');
    setBulk(''); setBulkOpen(false);
    ok(`נוספו ${r.data.created.length} אנשים לקבוצה ${newRole}`);
    load(period?.key);
  }

  async function patch(g: Guide, body: Record<string, unknown>, done: string) {
    const r = await call(`/api/admin/guides/${g.id}`, 'PATCH', body);
    if (!r.ok) return bad(r.data.error || 'העדכון נכשל');
    ok(done);
    load(period?.key);
  }

  async function rename(g: Guide) {
    const name = window.prompt('שם חדש:', g.name);
    if (name && name.trim() && name !== g.name) patch(g, { name }, 'השם עודכן');
  }

  async function setCode(g: Guide) {
    const code = window.prompt(`קוד עובד של ${g.name} (כפי שמופיע בגיליון המשרד):`, g.code ?? '');
    if (code !== null) patch(g, { code }, 'קוד העובד עודכן');
  }

  async function setRate(g: Guide) {
    const unit = g.role === 'מרצים' ? 'להרצאה' : 'לשעה';
    const rate = window.prompt(`תעריף בש״ח ${unit} של ${g.name} (ריק = לא מוגדר):`, g.rate?.toString() ?? '');
    if (rate !== null) patch(g, { rate }, rate.trim() ? 'התעריף עודכן' : 'התעריף נמחק');
  }

  async function setTravelRate(g: Guide) {
    const rate = window.prompt(`תעריף בש״ח לנסיעה אחת של ${g.name} (ריק = לא מוגדר):`, g.travel_rate?.toString() ?? '');
    if (rate !== null) patch(g, { travel_rate: rate }, rate.trim() ? 'תעריף הנסיעה עודכן' : 'תעריף הנסיעה נמחק');
  }

  async function regenerate(g: Guide) {
    if (!confirm(`להחליף את הקישור של ${g.name}? הקישור הישן יפסיק לעבוד מיד.`)) return;
    patch(g, { regenerate: true }, 'נוצר קישור חדש. הקישור הישן בוטל.');
  }

  async function periodAction(action: 'close' | 'open' | 'send') {
    if (!period) return;
    if (action === 'close' && !confirm('לסגור את התקופה? מנחים לא יוכלו יותר לערוך בה דיווחים.')) return;
    setBusy(true);
    const r = await call('/api/admin/period', 'POST', { period: period.key, action });
    setBusy(false);
    if (!r.ok) return bad(r.data.error || 'הפעולה נכשלה');
    ok(action === 'send' ? 'האקסל נשלח למייל' : action === 'close' ? 'התקופה נסגרה' : 'התקופה נפתחה לעריכה');
    load(period.key);
  }

  if (authed === null) return <main className="wrap center"><p className="sub">טוען…</p></main>;

  if (!authed) {
    return (
      <main className="wrap">
        <h1>כניסת מנהל</h1>
        <p className="sub">דיווח שעות · ניהול</p>
        {!configured && <div className="alert err">ADMIN_PASSWORD לא מוגדר בשרת.</div>}
        <form className="card" onSubmit={login}>
          {loginErr && <div className="alert err" role="alert">{loginErr}</div>}
          <div className="field">
            <label htmlFor="pw">סיסמה</label>
            <input id="pw" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="primary full">כניסה</button>
        </form>
      </main>
    );
  }

  const missing = guides.filter((g) => g.active && g.minutes === 0).length;

  return (
    <main className="wrap wide">
      <div className="period-bar">
        <h1 style={{ margin: 0 }}>ניהול דיווחי שעות</h1>
        <button className="small" onClick={logout}>יציאה</button>
      </div>

      {notice && <div className={`alert ${notice.kind}`} role="status" onClick={() => setNotice(null)}>{notice.text}</div>}

      <section className="card">
        <div className="period-bar">
          <button className="small" onClick={() => period && load(period.prevKey)} aria-label="התקופה הקודמת">›</button>
          <div className="label">
            {period?.label} {period?.closed && <span className="tag">נסגרה</span>}
          </div>
          <button className="small" disabled={!period?.nextKey} onClick={() => period?.nextKey && load(period.nextKey)} aria-label="התקופה הבאה">‹</button>
        </div>
        <div className="toolbar">
          <a className="btn primary" href={`/api/admin/export?period=${period?.key}`}>הורדת אקסל</a>
          <a className="btn" href="/admin/ledger">גיליון משכורות</a>
          <button disabled={busy} onClick={() => periodAction('send')}>שליחת האקסל למייל</button>
          {period?.closed
            ? <button disabled={busy} onClick={() => periodAction('open')}>פתיחה מחדש לעריכה</button>
            : <button disabled={busy} onClick={() => periodAction('close')}>סגירת התקופה</button>}
        </div>
        {missing > 0 && <p className="sub mt" style={{ marginBottom: 0 }}>{missing} אנשים פעילים עדיין לא דיווחו שעות בתקופה הזו.</p>}
      </section>

      <section className="card">
        <h2>אנשי הצוות ({guides.length})</h2>
        {guides.length === 0 && <div className="empty">עדיין אין אף אחד. הוסיפו מנחה למטה.</div>}
        {groups.map((grp) => {
          const list = guides.filter((g) => g.role === grp);
          if (!list.length) return null;
          return (
            <div key={grp}>
              <h2 className="mt" style={{ color: 'var(--muted)' }}>{grp}</h2>
              {list.map((g) => (
                <div className={`guide-row${g.active ? '' : ' off'}`} key={g.id}>
                  <div className="who">
                    <b>{g.name} {!g.active && <span className="tag">לא פעיל</span>}</b>
                    <span>
                      {g.email || 'ללא מייל'} · {g.rate != null ? `${g.rate} ₪ ${g.role === 'מרצים' ? 'להרצאה' : 'לשעה'}` : 'ללא תעריף'}
                      {g.trips > 0 || g.travel_rate != null ? ` · נסיעה: ${g.travel_rate != null ? `${g.travel_rate} ₪` : 'ללא תעריף'}` : ''}
                      {g.code ? ` · קוד ${g.code}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="pill">{fmtDuration(g.minutes)}</span>{' '}
                    <span className="sub">
                      {g.days === 1 ? 'יום אחד' : `${g.days} ימים`}{g.trips > 0 ? ` · ${g.trips} נסיעות` : ''}
                    </span>
                  </div>
                  <div className="row-actions">
                    <button className="small primary" onClick={() => copy(linkOf(g), 'הקישור')}>העתקת קישור</button>
                    <a className="btn small" target="_blank" rel="noreferrer"
                      href={`https://wa.me/?text=${encodeURIComponent(`שלום ${g.name}, זה הקישור האישי שלך לדיווח שעות (אל תעבירו אותו לאחרים):\n${linkOf(g)}`)}`}>וואטסאפ</a>
                    <button className="small" onClick={() => setRate(g)}>תעריף</button>
                    <button className="small" onClick={() => setTravelRate(g)}>תעריף נסיעה</button>
                    <button className="small" onClick={() => rename(g)}>שינוי שם</button>
                    <button className="small" onClick={() => regenerate(g)}>קישור חדש</button>
                    <button className="small" onClick={() => patch(g, { active: !g.active }, g.active ? 'הועבר ללא פעיל' : 'הופעל')}>
                      {g.active ? 'השבתה' : 'הפעלה'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>הוספת אדם</h2>
        <form onSubmit={addOne}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="n">שם מלא</label>
              <input id="n" value={newName} onChange={(e) => setNewName(e.target.value)} required maxLength={80} />
            </div>
            <div className="field">
              <label htmlFor="r">קבוצה</label>
              <select id="r" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {groups.map((g) => <option key={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="rt">תעריף בש״ח לשעה (למרצים: להרצאה). לא חובה, אפשר להגדיר אחר כך</label>
              <input id="rt" type="number" min="0" step="0.01" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="e">מייל (לא חובה, לתזכורות בעתיד)</label>
            <input id="e" type="email" dir="ltr" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          <div className="row-actions">
            <button className="primary" disabled={busy}>הוספה</button>
            <button type="button" onClick={() => setBulkOpen(!bulkOpen)}>הוספה מרוכזת</button>
          </div>
        </form>
        {bulkOpen && (
          <form className="mt" onSubmit={addBulk}>
            <div className="field">
              <label htmlFor="b">שורה לכל אדם: שם, ואופציונלית מייל אחרי פסיק. התעריף נקבע אחר כך לכל אחד. ייכנסו לקבוצה "{newRole}".</label>
              <textarea id="b" value={bulk} onChange={(e) => setBulk(e.target.value)} required
                placeholder={'דוד כהן, david@example.com\nשרה לוי'} />
            </div>
            <button className="primary" disabled={busy}>הוספת כולם</button>
          </form>
        )}
      </section>
    </main>
  );
}
