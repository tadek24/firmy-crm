"use client";
import { useEffect, useState } from 'react';
import type { BulkJob } from '@/lib/bulk';
const labels = { running: 'Zbieranie w tle', paused: 'Wstrzymany', failed: 'Wymaga sprawdzenia', complete: 'Zakończony' };
export function BulkImport() {
  const [job, setJob] = useState<BulkJob | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [workerAlive, setWorkerAlive] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState(1000);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch('/api/import/bulk'); const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!cancelled) { setJob(data.job); setConfigured(data.ceidgConfigured); setWorkerAlive(data.workerAlive); setError(''); setLoaded(true); }
      } catch (error) { if (!cancelled) { setError((error as Error).message || 'Nie można odczytać postępu importu.'); setLoaded(true); } }
    }
    void refresh(); const timer = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  async function control(action: 'focus' | 'pause' | 'resume') {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/import/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, target }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); setJob(data.job);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const format = (n: number) => n.toLocaleString('pl-PL');
  const selection = job?.selection;
  return <section className="bulk-import">
    <p className="eyebrow">SELEKCJA FIRM / USŁUGI I HANDEL</p><h2>Kolejka dopasowanych kontaktów</h2>
    <p className="muted">Aktywne firmy usługowe i handlowe z telefonem lub e-mailem oraz sygnałem do sprawdzenia WWW lub marketplace. Bez ograniczenia wieku firmy, z całej Polski.</p>
    <p className="small muted">To wstępne dopasowanie do oferty, nie potwierdzone zainteresowanie. Najpierw wykorzystujemy pasujące firmy zapisane w bazie. Podczas dalszego pobierania zapisujemy tylko wpisy spełniające warunki.</p>
    {configured === false && loaded && <p className="token-notice">Dodaj CEIDG_API_TOKEN w ustawieniach Vercel i wykonaj ponowne wdrożenie.</p>}
    {job && <div className="bulk-progress" aria-live="polite">
      <div className="progress-heading"><strong>{labels[job.state]}</strong><span>{selection ? `${format(selection.qualified)} / ${format(selection.target)} w kolejce` : `${format(job.saved)} zapisanych wpisów poprzedniego importu`}</span></div>
      {selection ? <>
        <progress aria-label="Postęp zbierania dopasowanych firm" max={selection.target} value={selection.qualified}/>
        <div className="progress-counts"><span>Dopasowane <strong>{format(selection.qualified)}</strong></span><span>Sprawdzone w selekcji <strong>{format(selection.checked)}</strong> / {format(selection.maxChecks)}</span><span>Odrzucone przy selekcji <strong>{format(selection.excluded)}</strong></span></div>
        <p className="small muted">Zatrzymujemy pobieranie po osiągnięciu celu albo limitu {format(selection.maxChecks)} sprawdzonych wpisów. Nie kontaktować, Nie zainteresowany i Klient nie trafiają do kolejki.</p>
      </> : <p className="small muted">Poprzednio pobrane dane i pozycja importu pozostają zapisane. Uruchom selekcję, aby zmienić zakres na dopasowane kontakty.</p>}
      {job.message && <p className="token-notice">{job.message}{job.state === 'running' && job.nextRunAt > 0 && ` Następna próba: ${new Date(job.nextRunAt).toLocaleString('pl-PL')}.`}</p>}
      {job.state === 'running' && !workerAlive && <p className="small muted">Zadanie jest zaplanowane w chmurze. Kolejna partia zostanie sprawdzona automatycznie.</p>}
    </div>}
    {error && <p role="alert" className="token-notice">{error}</p>}
    <div className="bulk-actions">
      {(!selection || job?.state === 'complete') ? <>
        <label>Cel kolejki <select aria-label="Cel kolejki" value={target} disabled={busy} onChange={event => setTarget(Number(event.target.value))}><option value={100}>100 firm</option><option value={300}>300 firm</option><option value={1000}>1000 firm</option></select></label>
        <button className="primary" disabled={!loaded || !configured || busy} onClick={() => control('focus')}>Zbieraj {format(target)} dopasowanych firm</button>
      </> : job?.state === 'running' ? <button disabled={busy} onClick={() => control('pause')}>Wstrzymaj selekcję</button> : <button className="primary" disabled={!configured || busy} onClick={() => control('resume')}>Wznów selekcję</button>}
    </div>
    <p className="small muted">Pobieranie działa na Vercel również przy wyłączonym komputerze. Dane kontaktowe pochodzą z rejestru; ich aktualność wymaga sprawdzenia. Spółki wpisane wyłącznie do KRS dodasz osobno po numerze KRS.</p>
  </section>;
}
