"use client";
import { useEffect, useState } from 'react';
import type { BulkJob } from '@/lib/bulk';
const labels = { running: 'Pobieranie w tle', paused: 'Wstrzymany', failed: 'Wymaga sprawdzenia', complete: 'Zakończony' };
export function BulkImport() {
  const [job, setJob] = useState<BulkJob | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [workerAlive, setWorkerAlive] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try { const response = await fetch('/api/import/bulk'); const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!cancelled) { setJob(data.job); setConfigured(data.ceidgConfigured); setWorkerAlive(data.workerAlive); setError(''); setLoaded(true); }
      } catch (error) { if (!cancelled) { setError((error as Error).message || 'Nie można odczytać postępu importu.'); setLoaded(true); } }
    }
    void refresh(); const timer = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  async function control(action: 'start' | 'pause' | 'resume') {
    setBusy(true); setError('');
    try { const response = await fetch('/api/import/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); const data = await response.json();
      if (!response.ok) throw new Error(data.error); setJob(data.job);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const format = (n: number) => n.toLocaleString('pl-PL');
  return <section className="bulk-import"><p className="eyebrow">IMPORT AUTOMATYCZNY / CAŁA POLSKA</p><h2>Wszystkie aktywne firmy z CEIDG</h2><p className="muted">Bez wpisywania NIP-u i bez ograniczenia daty założenia. Pobieramy dane firmy oraz udostępnione w rejestrze: stronę WWW, e-mail i telefon.</p><p className="small muted">Każda zapisana firma otrzymuje automatyczną analizę: potencjał WWW, Allegro i sprzedaży za granicą oraz kontrolę braków danych. Sugestie i uzasadnienia znajdziesz w bazie firm.</p><p className="small muted">Zakres obejmuje CEIDG. Spółki wpisane wyłącznie do KRS nie należą do tego importu. Dostępność kontaktów zależy od wpisu przedsiębiorcy.</p>
    {configured === false && loaded && <p className="token-notice">Aby uruchomić import, dodaj CEIDG_API_TOKEN w ustawieniach Vercel i wykonaj ponowne wdrożenie.</p>}
    {job && <div className="bulk-progress" aria-live="polite"><div className="progress-heading"><strong>{labels[job.state]}</strong><span>{format(job.saved)} zapisanych wpisów</span></div>{job.total !== null && job.total > 0 && <progress aria-label="Postęp przetwarzania firm" max={Math.max(job.total, job.processed)} value={job.processed}/>}<div className="progress-counts"><span>Przetworzono <strong>{format(job.processed)}</strong>{job.total ? ` / ${format(job.total)}` : ''}</span><span>WWW <strong>{format(job.withWebsite)}</strong></span><span>E-mail <strong>{format(job.withEmail)}</strong></span><span>Telefon <strong>{format(job.withPhone)}</strong></span></div><p className="small muted">Pominięte wpisy nieaktywne lub nieudostępnione: {format(job.skipped)}. Liczba firm w rejestrze może zmieniać się podczas importu.</p>{job.message && <p className="token-notice">{job.message}{job.state === 'running' && job.nextRunAt > 0 && ` Następna próba: ${new Date(job.nextRunAt).toLocaleString('pl-PL')}.`}</p>}{job.state === 'running' && !workerAlive && <p className="small muted">Import jest zaplanowany w chmurze. Kolejna partia zostanie pobrana automatycznie.</p>}</div>}
    {error && <p role="alert" className="token-notice">{error}</p>}
    <div className="bulk-actions">{(!job || job.state === 'complete') ? <button className="primary" disabled={!loaded || !configured || busy} onClick={() => control('start')}>{job ? 'Uruchom ponownie od początku' : 'Pobierz wszystkie aktywne firmy'}</button> : job.state === 'running' ? <button disabled={busy} onClick={() => control('pause')}>Wstrzymaj import</button> : <button className="primary" disabled={!configured || busy} onClick={() => control('resume')}>Wznów od zapisanej pozycji</button>}</div>
    <p className="small muted">Duża baza jest pobierana etapami z uwzględnieniem limitów CEIDG. Możesz zamknąć kartę przeglądarki; import będzie kontynuowany na Vercel również przy wyłączonym komputerze. Po przerwaniu postęp pozostaje zapisany.</p></section>;
}

