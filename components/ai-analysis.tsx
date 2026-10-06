"use client";
import { useEffect, useState } from 'react';
import type { AiTask } from '@/lib/ai-analysis';

type Status = { task: AiTask | null; configured: boolean; provider: 'openai' | 'gemini'; dailyLimit: number; used: number };
export function AiAnalysis({ companyId, launchToken = 0 }: { companyId: string; launchToken?: number }) {
  const [data, setData] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshConfirmed, setRefreshConfirmed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/analysis`, { cache: 'no-store' });
        const status = await response.json();
        if (!response.ok) throw new Error(status.error || 'Nie można odczytać analizy AI.');
        if (!cancelled) setData(status);
      } catch (error) { if (!cancelled) setError((error as Error).message); }
    }
    void load(); const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [companyId, launchToken]);
  async function run(force: boolean) {
    setBusy(true); setError(''); setRefreshConfirmed(false);
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/analysis`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ force }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Nie udało się uruchomić analizy.');
      setData(current => current ? { ...current, task:result.task, used:current.used + (result.created ? 1 : 0) } : current);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const gemini = data?.provider === 'gemini';
  const task = data?.task;
  const pending = task?.state === 'queued' || task?.state === 'running';
  const report = task?.state === 'completed' ? task.report : null;
  return <section className="ai-analysis">
    <span className="eyebrow">ANALIZA AI / PUBLICZNE ŹRÓDŁA</span><h3>WWW i marketplace</h3>
    <p className="muted small">Analiza na kliknięcie. Dopasowanie naszej oferty, fakty ze źródłami i hipotezy do rozmowy. Potencjał nie potwierdza zamiaru zakupu.</p>
    {error && <p className="feedback error" role="alert">{error}</p>}
    {!data && !error && <p>Wczytywanie stanu AI…</p>}
    {data && !data.configured && <p className="feedback">{gemini ? 'Gemini oczekuje na klucz GEMINI_API_KEY z projektu Free tier w Vercel oraz potwierdzenie darmowego planu. Po zapisie konfiguracji potrzebne jest ponowne wdrożenie.' : 'AI oczekuje na OPENAI_API_KEY oraz CRM_AI_ENABLED=true w Vercel i ponowne wdrożenie.'}</p>}
    {data && <p className="muted small">Zespół: {data.used} / {data.dailyLimit} uruchomień dzisiaj (UTC). Limit obejmuje również nieudane próby. <a href={gemini ? "https://aistudio.google.com/" : "https://platform.openai.com/usage"} target="_blank" rel="noreferrer">{gemini ? 'Limity i użycie w Google AI Studio ↗' : 'Koszty w OpenAI ↗'}</a></p>}
    {gemini && <p className="muted small">Gemini / Free tier: analiza rejestru i podanej strony WWW, bez wyszukiwarki Google. Bezpłatność wymaga projektu bez włączonych rozliczeń. Limit Google może być niższy niż limit CRM; aplikacja nie przełącza się na płatnego dostawcę.</p>}
    {pending && <p role="status">{task?.state === 'queued' ? 'Analiza czeka na uruchomienie' : 'AI sprawdza źródła i przygotowuje raport'}… Możesz zamknąć kartę; praca trwa w chmurze.</p>}
    {task?.state === 'failed' && <p className="feedback error">{task.error}</p>}
    {data && !report && <button className="primary" disabled={busy || pending || !data.configured || data.used >= data.dailyLimit} onClick={() => void run(false)}>{busy ? 'Uruchamianie…' : task?.state === 'failed' ? (gemini ? 'Ponów analizę Gemini' : 'Ponów analizę AI (płatne)') : 'Analizuj AI'}</button>}
    {report && <>
      <p className="ai-summary">{report.summary}</p>
      <p className="muted small">Sprawdzono: {new Date(report.checkedAt).toLocaleString('pl-PL')} · {report.model} · {report.provider === 'gemini' ? 'Gemini — bez opłat za API w projekcie Free tier; limity w Google AI Studio.' : `szacunkowy koszt ${(report.estimatedUsd || 0).toFixed(4)}. Rzeczywiste rozliczenie w OpenAI Usage.`}</p>
      <h4>Strona internetowa — {report.website.identity}</h4><p>{report.website.evidence}</p>
      {report.website.url && <a href={report.website.url} target="_blank" rel="noreferrer">Sprawdzona strona ↗</a>}
      {report.website.findings.length > 0 && <ul>{report.website.findings.map((item,i) => <li key={i}>{item.statement} <a href={item.sourceUrl} target="_blank" rel="noreferrer">Źródło ↗</a></li>)}</ul>}
      <h4>Co możemy zaproponować</h4>
      {report.website.improvements.length ? report.website.improvements.map((item,i) => <div className="ai-finding" key={i}><strong>{item.action}</strong><span className="status-label">{item.basis === 'fakt' ? 'Ustalenie ze źródła' : 'Hipoteza do rozmowy'}</span><p>{item.benefit}</p>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Źródło ↗</a>}</div>) : <p>Brak wystarczających danych o stronie.</p>}
      <h4>Polska i zagraniczne marketplace</h4>
      {report.marketplaces.map((item,i) => <div className="ai-finding" key={i}><strong>{item.channel} / {item.country}</strong><span className="status-label">Potencjał: {item.potential}</span><p>{item.reason}</p><p><strong>Nasza oferta: </strong>{item.offer}</p>{item.requirements.length > 0 && <ul>{item.requirements.map((value,j) => <li key={j}>{value}</li>)}</ul>}{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">Źródło ↗</a>}</div>)}
      <h4>Pytania do pierwszej rozmowy</h4><ul>{report.questions.map((value,i) => <li key={i}>{value}</li>)}</ul>
      <h4>Ograniczenia oceny</h4><ul>{report.limitations.map((value,i) => <li key={i}>{value}</li>)}<li>To analiza publicznej treści; nie mierzy wydajności, wyglądu na telefonie ani sprzedaży.</li></ul>
      <details><summary>Wykorzystane źródła ({report.sources.length})</summary><ul>{report.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></details>
      {!refreshConfirmed ? <button disabled={busy || !data?.configured} onClick={() => setRefreshConfirmed(true)}>Odśwież raport AI…</button> : <div className="feedback"><p>Odświeżenie zastąpi zapisany raport i zużyje kolejne uruchomienie {gemini ? 'Gemini w projekcie Free tier' : 'płatnej analizy OpenAI'}.</p><button disabled={busy || !data?.configured || data.used >= data.dailyLimit} onClick={() => void run(true)}>{gemini ? 'Odśwież przez Gemini' : 'Uruchom płatne odświeżenie'}</button><button onClick={() => setRefreshConfirmed(false)}>Anuluj</button></div>}
    </>}
  </section>;
}
