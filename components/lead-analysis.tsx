import type { Company } from '@/lib/types';

export function AnalysisSummary({ company }: { company: Company }) {
  const analysis = company.analysis;
  if (!analysis) return <span className="muted">Oczekuje na analizę</span>;
  return <div className="analysis-summary">
    <strong>{analysis.priority}</strong>
    <span>Dopasowanie: {analysis.fitScore}/100 · {analysis.sector}</span>
    <span>{analysis.opportunities.map(item => item.channel).join(' · ') || 'Wymaga rozpoznania'}</span>
    <small>{analysis.issues.length ? `Kontrola: ${analysis.issues.length} uwag` : 'Dane podstawowe kompletne'}</small>
  </div>;
}

export function AnalysisDetail({ company }: { company: Company }) {
  const analysis = company.analysis;
  if (!analysis) return null;
  return <section className="analysis-detail" aria-label="Wstępna analiza firmy">
    <p className="eyebrow">AUTOMATYCZNA ANALIZA / DANE REJESTROWE</p>
    <h3>{analysis.priority}</h3>
    <p><strong>Dopasowanie do oferty: {analysis.fitScore}/100</strong> · {analysis.sector}</p>
    <p className="muted small">Ocena reguł, nie prawdopodobieństwo zakupu. Wyższy wynik oznacza więcej sygnałów do sprawdzenia.</p>
    <ul>{analysis.fitReasons.map(reason => <li key={reason.label}>+{reason.points} · {reason.label}</li>)}</ul>
    <p className="muted small">Wskazania do sprawdzenia na podstawie głównego PKD i kontaktów. Zainteresowanie firmy oraz jej strona i konta sprzedażowe nie zostały zweryfikowane.</p>
    {analysis.opportunities.length ? analysis.opportunities.map(item => <div className="opportunity" key={item.channel}>
      <div><strong>{item.channel}</strong><small>Pewność: {item.confidence.toLocaleLowerCase('pl')}</small></div>
      <p>{item.reason}</p>
      <h4>Propozycja naszej usługi</h4><p>{item.offer}</p>
      <h4>Możliwa korzyść</h4><p>{item.benefit}</p>
      <h4>Pytania do rozpoznania</h4><ul>{item.questions.map(question => <li key={question}>{question}</li>)}</ul>
    </div>) : <p>Brak wystarczających podstaw do automatycznego wskazania kanału.</p>}
    <h4>Kontrola danych</h4>
    {analysis.issues.length ? <ul>{analysis.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>Podstawowe pola są uzupełnione. Aktualność kontaktów wymaga sprawdzenia.</p>}
    <h4>Przed ofertą</h4><ul>{analysis.nextSteps.map(step => <li key={step}>{step}</li>)}</ul>
    <p className="muted small">Źródło: {company.source}, główny PKD {company.pkdMain || 'niepodany'}{company.pkdYear ? ` (${company.pkdYear})` : ''}. Dane z {analysis.checkedAt ? new Date(analysis.checkedAt).toLocaleString('pl-PL') : 'nieznanego dnia'}. Reguły v{analysis.version}.</p>
  </section>;
}
