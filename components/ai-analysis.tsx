"use client";
import { useEffect, useState } from 'react';
import type { AiTask } from '@/lib/ai-analysis';
import { startVisiblePolling } from '@/lib/visible-polling';

type Status = { task: AiTask | null; configured: boolean; provider: 'openai' | 'gemini'; dailyLimit: number; used: number };
export function AiAnalysis({ companyId, launchToken = 0 }: { companyId: string; launchToken?: number }) {
  const [data, setData] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshConfirmed, setRefreshConfirmed] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/analysis`, { cache: 'no-store' });
        const status = await response.json();
        if (!response.ok) throw new Error(status.error || 'Nie można odczytać analizy AI.');
        if (!cancelled) { setData(status); setError(''); }
        return status.task?.state === 'queued' || status.task?.state === 'running' ? 5000 : null;
      } catch (error) { if (!cancelled) setError((error as Error).message); return null; }
    }
    const stop = startVisiblePolling(load);
    return () => { cancelled = true; stop(); };
  }, [companyId, launchToken, refreshVersion]);
  async function run(force: boolean) {
    setBusy(true); setError(''); setRefreshConfirmed(false);
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(companyId)}/analysis`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ force }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Nie udało się uruchomić analizy.');
      setData(current => current ? { ...current, task:result.task, used:current.used + (result.created ? 1 : 0) } : current);
      setRefreshVersion(value => value + 1);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const gemini = data?.provider === 'gemini';
  const task = data?.task;
  const pending = task?.state === 'queued' || task?.state === 'running';
  const report = task?.state === 'completed' ? task.report : null;
  const previousProvider = task?.provider || 'openai';
  const providerName = gemini ? 'Gemini' : 'OpenAI';
  return <section className="ai-analysis">
    <span className="eyebrow">ANALIZA AI / PUBLICZNE ŹRÓDŁA</span><h3>WWW, profile i marketplace</h3>
    <p className="muted small">Analiza na kliknięcie. Dopasowanie naszej oferty, fakty ze źródłami i hipotezy do rozmowy. Potencjał nie potwierdza zamiaru zakupu.</p>
    {error && <p className="feedback error" role="alert">{error}</p>}
    {!data && !error && <p>Wczytywanie stanu AI…</p>}
    {data && !data.configured && <p className="feedback">{gemini ? 'Gemini oczekuje na klucz GEMINI_API_KEY z projektu Free tier w Vercel oraz potwierdzenie darmowego planu. Po zapisie konfiguracji potrzebne jest ponowne wdrożenie.' : 'AI oczekuje na OPENAI_API_KEY oraz CRM_AI_ENABLED=true w Vercel i ponowne wdrożenie.'}</p>}
    {data && <p className="muted small">Zespół: {data.used} / {data.dailyLimit} uruchomień dzisiaj (UTC). Limit obejmuje również nieudane próby. <a href={gemini ? "https://aistudio.google.com/" : "https://platform.openai.com/usage"} target="_blank" rel="noreferrer">{gemini ? 'Limity i użycie w Google AI Studio ↗' : 'Koszty w OpenAI ↗'}</a></p>}
    {gemini && <p className="muted small">Gemini / Free tier: analiza rejestru i podanej strony WWW, bez wyszukiwarki Google. Bezpłatność wymaga projektu bez włączonych rozliczeń. Limit Google może być niższy niż limit CRM; aplikacja nie przełącza się na płatnego dostawcę.</p>}
    {data && !gemini && <p className="muted small">OpenAI / analiza rozszerzona: publiczne profile Facebook, Instagram, LinkedIn, sklepy na marketplace i najważniejsze podstrony firmy. Maksymalnie 12 użyć wyszukiwarki na raport. Jest to płatna analiza dostępnych treści; nie obejmuje pomiarów szybkości ani testów formularzy.</p>}
    {pending && <p role="status">{task?.state === 'queued' ? 'Analiza czeka na uruchomienie' : 'AI sprawdza źródła i przygotowuje raport'}… Możesz zamknąć kartę; praca trwa w chmurze.</p>}
    {task?.state === 'failed' && <div className="feedback error ai-task-error"><strong>Ostatnia próba: {previousProvider === 'gemini' ? 'Gemini' : 'OpenAI'}</strong><p>{task.error}</p>{data && previousProvider !== data.provider && <p>Ten błąd dotyczy poprzedniego dostawcy. Następne uruchomienie użyje {providerName}.</p>}</div>}
    {data && !report && <button className="primary" disabled={busy || pending || !data.configured || data.used >= data.dailyLimit} onClick={() => void run(false)}>{busy ? 'Uruchamianie…' : gemini ? (task?.state === 'failed' ? 'Uruchom ponownie Gemini' : 'Analizuj przez Gemini') : (task?.state === 'failed' ? 'Uruchom ponownie OpenAI (płatne)' : 'Analizuj szerzej — OpenAI (płatne)')}</button>}
    {report && <>
      <p className="ai-summary">{report.summary}</p>
      <p className="muted small">Sprawdzono: {new Date(report.checkedAt).toLocaleString('pl-PL')} · {report.model} · {report.provider === 'gemini' ? 'Gemini — bez opłat za API w projekcie Free tier; limity w Google AI Studio.' : `szacunkowy koszt ${(report.estimatedUsd || 0).toFixed(4)} USD. Rzeczywiste rozliczenie w OpenAI Usage.`}</p>
      {!gemini && report.analysisVersion !== 2 && <p className="feedback">Zapisany raport ma wcześniejszy, krótszy zakres. Odśwież go, aby wykonać rozszerzoną analizę OpenAI. Odświeżenie jest płatne.</p>}
      {report.presence && <>
        <h4>Gdzie firma jest obecna</h4>
        <p className="muted small">„Nie znaleziono” oznacza brak wyniku z wykonanego wyszukiwania, nie dowód braku konta.</p>
        <dl className="ai-presence">{report.presence.map(item => <div key={item.channel}><dt><strong>{item.channel}</strong><span className="status-label">{item.status}</span></dt><dd><p>{item.evidence}</p>{item.identityEvidence && <p><strong>Dopasowanie firmy: </strong>{item.identityEvidence}</p>}{item.url && <a href={item.url} target="_blank" rel="noreferrer">Profil / sklep ↗</a>}{item.sourceUrl && item.sourceUrl !== item.url && <a href={item.sourceUrl} target="_blank" rel="noreferrer"> Źródło dopasowania ↗</a>}</dd></div>)}</dl>
      </>}
      {report.websiteReview && <>
        <h4>Zakres sprawdzenia strony</h4><p>{report.websiteReview.summary}</p>
        {report.websiteReview.pages.length ? report.websiteReview.pages.map((page,i) => <div className="ai-finding" key={i}><strong>{page.name}</strong><span className="status-label">{page.status}</span><p>{page.finding}</p>{page.url && <a href={page.url} target="_blank" rel="noreferrer">Podstrona ↗</a>}</div>) : <p>Nie uzyskano potwierdzenia sprawdzenia podstron.</p>}
        <details><summary>Czego nie sprawdzono</summary><ul>{report.websiteReview.notChecked.map((item,i) => <li key={i}>{item}</li>)}</ul></details>
      </>}
      {report.offers && <><h4>Priorytety naszej oferty</h4>{report.offers.length ? report.offers.map((offer,i) => <div className="ai-finding" key={i}><strong>{i+1}. {offer.service}</strong><span className="status-label">Priorytet: {offer.priority} · {offer.basis === 'fakt' ? 'Ustalenie ze źródła' : 'Hipoteza do rozmowy'}</span><p><strong>Dlaczego: </strong>{offer.reason}</p><p><strong>Korzyść: </strong>{offer.benefit}</p><p><strong>Zapytaj: </strong>{offer.question}</p>{offer.sourceUrl && <a href={offer.sourceUrl} target="_blank" rel="noreferrer">Źródło ↗</a>}</div>) : <p>Brak wystarczających danych do wskazania konkretnych usług.</p>}</>}
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
      {report.searchQueries && <details><summary>Wykonane wyszukiwania ({report.searchQueries.length})</summary>{report.searchQueries.length ? <ul>{report.searchQueries.map((query,i) => <li key={i}>{query}</li>)}</ul> : <p>API nie zwróciło treści zapytań.</p>}</details>}
      {!refreshConfirmed ? <button disabled={busy || !data?.configured} onClick={() => setRefreshConfirmed(true)}>Odśwież raport AI…</button> : <div className="feedback"><p>Odświeżenie zastąpi zapisany raport i zużyje kolejne uruchomienie {gemini ? 'Gemini w projekcie Free tier' : 'płatnej analizy OpenAI'}.</p><button disabled={busy || !data?.configured || data.used >= data.dailyLimit} onClick={() => void run(true)}>{gemini ? 'Odśwież przez Gemini' : 'Uruchom płatne odświeżenie'}</button><button onClick={() => setRefreshConfirmed(false)}>Anuluj</button></div>}
    </>}
  </section>;
}
