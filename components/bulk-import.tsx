"use client";
import { useEffect, useState } from 'react';
import type { BulkJob } from '@/lib/bulk';
const labels = { running: 'Zbieranie w tle', paused: 'Wstrzymany', failed: 'Wymaga sprawdzenia', complete: 'Zakończony' };
const format = (n: number) => n.toLocaleString('pl-PL');
export function BulkImport() {
  const [job, setJob] = useState<BulkJob | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [workerAlive, setWorkerAlive] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const thisYear = new Date().getUTCFullYear();
  const [fromYear, setFromYear] = useState(2020);
  const [toYear, setToYear] = useState(thisYear);
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
  async function control(action: 'yearly' | 'pause' | 'resume') {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/import/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, target: 1000, fromYear, toYear }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); setJob(data.job);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const campaign = job?.yearly;
  const qualified = campaign ? campaign.years.reduce((sum, year) => sum + year.qualified, 0) : job?.selection?.qualified || 0;
  const target = campaign ? campaign.years.reduce((sum, year) => sum + year.target, 0) : job?.selection?.target || 0;
  return <section className="bulk-import">
    <p className="eyebrow">SELEKCJA FIRM / USŁUGI I HANDEL</p><h2>Po 1000 kontaktów z każdego rocznika</h2>
    <p className="muted">Aktywne firmy usługowe i handlowe z całej Polski, z telefonem lub e-mailem i wstępnym dopasowaniem do oferty WWW lub marketplace. Każdy rok ma własny limit i zakres dat w CEIDG.</p>
    <p className="small muted">Dopasowanie wynika z branży i danych rejestrowych; nie potwierdza zainteresowania zakupem. Pasujące firmy już zapisane w bazie liczą się do limitu rocznika. Zachowujemy wcześniejsze wpisy, notatki i osoby odpowiedzialne, także nadwyżki ponad 1000. Import nie uruchamia płatnych analiz AI.</p>
    {configured === false && loaded && <p className="token-notice">Dodaj CEIDG_API_TOKEN w ustawieniach Vercel i wykonaj ponowne wdrożenie.</p>}
    {job && <div className="bulk-progress" aria-live="polite">
      <div className="progress-heading"><strong>{labels[job.state]}</strong><span>{target ? `${format(qualified)} / ${format(target)} w selekcji${campaign ? ` · ${campaign.from}–${campaign.to}` : ' poprzedniego importu'}` : `${format(job.saved)} zapisanych wpisów`}</span></div>
      {!!target && <progress aria-label="Postęp zbierania dopasowanych firm" max={target} value={qualified}/>}
      {campaign ? <div className="year-import-wrap"><table className="year-import-table"><thead><tr><th>Rok rozpoczęcia</th><th>Dopasowane / cel</th><th>Sprawdzone w CEIDG</th><th>Stan rocznika</th></tr></thead><tbody>{campaign.years.map((year, index) => <tr key={year.year} className={index === campaign.index && job.state !== 'complete' ? 'current-year' : ''}><td><strong>{year.year}</strong><span className="subline">{year.minStartedAt} – {year.maxStartedAt}</span></td><td>{format(year.qualified)} / {format(year.target)}</td><td>{format(year.checked)}</td><td>{year.stopReason === 'target' ? 'Cel osiągnięty' : year.stopReason === 'exhausted' ? 'Koniec dostępnej listy — mniej dopasowań' : year.stopReason === 'budget' ? 'Limit sprawdzeń — mniej dopasowań' : index === campaign.index ? labels[job.state] : 'Oczekuje'}</td></tr>)}</tbody></table></div> : <p className="small muted">To postęp poprzedniego importu. Uruchom roczniki poniżej, aby starsze lata otrzymały osobne limity.</p>}
      {campaign && <p className="small muted">Najpierw uzupełniamy najstarszy rocznik. Firmy bez daty rozpoczęcia lub z datą przyszłą nie trafiają do selekcji. Pomijamy statusy Nie kontaktować, Nie zainteresowany i Klient. Dla ochrony przed zapętlonym rejestrem sprawdzamy maksymalnie {format(campaign.years[0].maxChecks)} wpisów na rok; brakujące dopasowania są pokazane w tabeli.</p>}
      {job.message && <p className="token-notice">{job.message}{job.state === 'running' && job.nextRunAt > 0 && ` Następna próba: ${new Date(job.nextRunAt).toLocaleString('pl-PL')}.`}</p>}
      {job.state === 'running' && !workerAlive && <p className="small muted">Zadanie jest zaplanowane w chmurze. Kolejna partia zostanie sprawdzona automatycznie.</p>}
    </div>}
    {error && <p role="alert" className="token-notice">{error}</p>}
    <div className="bulk-actions">
      {job?.state === 'running' ? <button disabled={busy} onClick={() => control('pause')}>Wstrzymaj selekcję</button> : campaign && job?.state !== 'complete' ? <button className="primary" disabled={!configured || busy} onClick={() => control('resume')}>Wznów import roczników</button> : <>
        <label>Od roku <input type="number" aria-label="Import od roku" min={1900} max={thisYear} value={fromYear} disabled={busy} onChange={event => setFromYear(Number(event.target.value))}/></label>
        <label>Do roku włącznie <input type="number" aria-label="Import do roku" min={fromYear} max={thisYear} value={toYear} disabled={busy} onChange={event => setToYear(Number(event.target.value))}/></label>
        <button className="primary" disabled={!loaded || !configured || busy || fromYear > toYear || toYear - fromYear > 19} onClick={() => control('yearly')}>{busy ? 'Przygotowanie roczników…' : `Zbieraj po 1000 firm z lat ${fromYear}–${toYear}`}</button>
      </>}
    </div>
    <p className="small muted">Pobieranie działa na Vercel również przy wyłączonym komputerze. Dane kontaktowe pochodzą z rejestru; ich aktualność wymaga sprawdzenia. Spółki wpisane wyłącznie do KRS dodasz osobno po numerze KRS.</p>
  </section>;
}
