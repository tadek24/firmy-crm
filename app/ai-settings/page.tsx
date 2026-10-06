import Link from 'next/link';
import { GET } from '../api/ai/diagnostics/route';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export default async function AiSettings() {
  const response=await GET();
  const data=await response.json();
  return <main className="team-panel" style={{maxWidth:1000,margin:'40px auto',padding:24}}>
    <Link href="/">← Wróć do CRM</Link><h1>Połączenie z Gemini</h1>
    <p>Sprawdzenie połączenia odczytuje listę modeli i nie uruchamia płatnej analizy.</p>
    {response.status!==200 ? <p role="alert">{data.error || 'Brak dostępu do ustawień.'}</p> : !data.configured ? <p>Gemini wymaga klucza i potwierdzenia projektu Free Tier w Vercel.</p> : <>
      <p>Odpowiedź Google: {data.listStatus}. {data.keyRejected ? 'Klucz został odrzucony.' : data.listStatus===200 ? 'Klucz działa.' : 'Nie udało się potwierdzić połączenia.'}</p>
      <p>Wybrany model: <strong>{data.model}</strong>. {data.available===true ? 'Model jest dostępny.' : data.available===false ? 'Model nie znajduje się na liście dostępnych modeli.' : 'Lista modeli jest niepełna.'}</p>
      <details open><summary>Modele dostępne dla tego klucza</summary><ul>{data.models.map((model:string)=><li key={model}>{model}</li>)}</ul></details>
    </>}
  </main>;
}
