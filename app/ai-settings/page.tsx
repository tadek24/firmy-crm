import Link from 'next/link';
import { GET } from '../api/ai/diagnostics/route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export default async function AiSettings() {
  const response=await GET();
  const data=await response.json();
  const provider=data.provider==='openai' ? 'OpenAI' : 'Gemini';
  return <main className="team-panel" style={{maxWidth:1000,margin:'40px auto',padding:24}}>
    <Link href="/">← Wróć do CRM</Link><h1>Połączenie z {provider}</h1>
    <p>Sprawdzenie połączenia odczytuje listę modeli i nie uruchamia płatnej analizy.</p>
    {response.status!==200 ? <p role="alert">{data.error || 'Brak dostępu do ustawień.'}</p> : !data.configured ? <p>{provider==='OpenAI' ? 'OpenAI wymaga klucza OPENAI_API_KEY i włączenia AI w Vercel.' : 'Gemini wymaga klucza i potwierdzenia projektu Free Tier w Vercel.'}</p> : <>
      <p>Odpowiedź {provider}: {data.listStatus}. {data.keyRejected ? 'Klucz został odrzucony.' : data.listStatus===200 ? 'Klucz działa.' : 'Nie udało się potwierdzić połączenia.'}</p>
      {provider==='OpenAI' && <p>Odczyt modelu nie potwierdza salda ani dostępnej liczby analiz. Rozszerzona analiza wymaga środków lub przyznanych kredytów API. <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noreferrer">Sprawdź Billing ↗</a></p>}
      <p>Wybrany model: <strong>{data.model}</strong>. {data.available===true ? 'Model jest dostępny.' : data.available===false ? 'Model nie znajduje się na liście dostępnych modeli.' : 'Lista modeli jest niepełna.'}</p>
      <details open><summary>Modele dostępne dla tego klucza</summary><ul>{data.models.map((model:string)=><li key={model}>{model}</li>)}</ul></details>
    </>}
  </main>;
}
