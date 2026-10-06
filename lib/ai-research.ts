export const AI_TOOL_LIMIT = 12;
export const RESEARCH_CHANNELS = ['Facebook','Instagram','LinkedIn','Allegro Polska','Amazon','eBay','Allegro Czechy / Słowacja / Węgry','Pozostałe platformy'] as const;
export type Presence = { channel: string; status: 'potwierdzono' | 'nie znaleziono' | 'niedostępne' | 'nie sprawdzono'; url: string; evidence: string; identityEvidence: string; sourceUrl: string };
export type ReviewedPage = { name: string; url: string; status: 'sprawdzono treść' | 'wynik wyszukiwania' | 'niedostępna' | 'nie sprawdzono'; finding: string };
export type Offer = { priority: 'wysoki' | 'średni' | 'niski'; service: string; reason: string; benefit: string; basis: 'fakt' | 'hipoteza'; sourceUrl: string; question: string };
export type ResearchFields = { analysisVersion?: 2; presence?: Presence[]; websiteReview?: { summary: string; pages: ReviewedPage[]; notChecked: string[] }; offers?: Offer[]; searchQueries?: string[] };
const str = { type: 'string' };
const obj = (properties: Record<string,unknown>) => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const researchSchema = {
  presence: {type:'array',items:obj({channel:{type:'string',enum:RESEARCH_CHANNELS},status:{type:'string',enum:['potwierdzono','nie znaleziono','niedostępne','nie sprawdzono']},url:str,evidence:str,identityEvidence:str,sourceUrl:str})},
  websiteReview: obj({summary:str,pages:{type:'array',items:obj({name:str,url:str,status:{type:'string',enum:['sprawdzono treść','wynik wyszukiwania','niedostępna','nie sprawdzono']},finding:str})},notChecked:{type:'array',items:str}}),
  offers:{type:'array',items:obj({priority:{type:'string',enum:['wysoki','średni','niski']},service:str,reason:str,benefit:str,basis:{type:'string',enum:['fakt','hipoteza']},sourceUrl:str,question:str})},
};
export const researchInstructions = `Przygotuj szerszą analizę. Maksymalnie 12 użyć narzędzia łącznie; jest to górny limit, nie nakaz zużycia. Zgrupuj wyszukiwania tak, aby sprawdzić tożsamość firmy, jej podstrony i kanały sprzedaży.
W presence umieść po jednym wierszu dla każdego kanału: Facebook, Instagram, LinkedIn, Allegro Polska, Amazon, eBay, Allegro Czechy / Słowacja / Węgry, Pozostałe platformy. Szukaj publicznych profili, sklepów i kont sprzedawcy: nazwa/marka + miasto/NIP + nazwa platformy lub site:domena. Dla pozostałych wybierz kanał adekwatny do oferty, np. Etsy, OLX, Booksy, Google Maps. Nie utożsamiaj podobnej nazwy z tą firmą. Potwierdzenie wymaga źródła oraz konkretnego identityEvidence: zgodny NIP lub link z potwierdzonej strony albo zgodna nazwa i miejscowość/adres. Podaj dokładny URL znalezionego profilu/sklepu i źródło dopasowania. Nie stwierdzaj potwierdzonej obecności na podstawie samych założeń PKD. Status nie znaleziono tylko po rzeczywistym wyszukiwaniu tego kanału; niedostępne gdy weryfikację blokuje dostęp/logowanie; nie sprawdzono gdy zabrakło czasu/budżetu lub dowodu. Nie znaleziono nie oznacza nie istnieje. Nie loguj się, nie obchodź ograniczeń.
W websiteReview otwórz najważniejsze dostępne podstrony potwierdzonej firmy: główna, oferta/usługi, produkty/sklep, kontakt oraz rezerwacja lub informacje o dostawie/zwrotach, jeżeli są istotne. Do 6 stron. Podaj dokładnie które URL i treści sprawdziłeś. Status sprawdzono treść wymaga otwarcia tej strony narzędziem, wynik wyszukiwania oznacza tylko treść z wyników. Nie zmyślaj adresów podstron. Jeżeli strona jest niepotwierdzona, niczego nie przedstawiaj jako sprawdzonego. W notChecked jawnie wymień brakujące elementy: nieodwiedzone strony, logowanie, szybkość/SEO techniczne, widok mobilny, działanie formularza i finalizacja zamówienia. Nie klikaj wysyłki ani zakupu. Jest to analiza treści wybranych stron, a nie pełny audyt witryny.
W offers uporządkuj maksymalnie 5 propozycji naszych usług według wartości dla tej firmy: strona, sklep, formularze/rezerwacje, integracja lub uruchomienie odpowiedniego marketplace, ekspansja zagraniczna. Każda: konkretny powód, korzyść, priorytet, fakt/hipoteza, użyte źródło lub puste pole oraz pytanie weryfikujące. Uwzględnij już znalezione kanały, nie proponuj zakładania istniejącego konta. Dla ekspansji wymagaj potwierdzenia asortymentu, marży, logistyki, zwrotów i języka; dla usług nie wciskaj sprzedaży produktów. Nie oceniaj zamiaru zakupu. Około 1400 słów całego raportu.`;

const channelPatterns: Record<string,RegExp> = {
  Facebook:/facebook|fb\.com/i,Instagram:/instagram/i,LinkedIn:/linkedin/i,
  'Allegro Polska':/allegro/i,Amazon:/amazon/i,eBay:/ebay/i,
  'Allegro Czechy / Słowacja / Węgry':/allegro\.(cz|sk|hu)|allegro.*(czech|słow|slow|węg|weg|zagran|hung)/i,
  'Pozostałe platformy':/etsy|olx|booksy|maps|google.*map|ceneo|empik|er li|erli/i,
};
function channelUrl(channel:string,url:string) {
  const host=new URL(url).hostname.replace(/^www\./,'');
  const matches=(domain:string)=>host===domain || host.endsWith('.'+domain);
  switch(channel) {
    case 'Facebook': return matches('facebook.com') || matches('fb.com');
    case 'Instagram': return matches('instagram.com');
    case 'LinkedIn': return matches('linkedin.com');
    case 'Allegro Polska': return matches('allegro.pl');
    case 'Allegro Czechy / Słowacja / Węgry': return ['allegro.cz','allegro.sk','allegro.hu'].some(matches);
    case 'Amazon': return /^(.+\.)?amazon\.(com|pl|de|fr|it|es|co\.uk|nl|se|com\.be|ie|ca|com\.au|co\.jp)$/.test(host);
    case 'eBay': return /^(.+\.)?ebay\.(com|pl|de|fr|it|es|co\.uk|nl|at|ch|ca|com\.au|ie)$/.test(host);
    default: return true;
  }
}
export function readResearch(value: unknown, sources: Set<string>, opened: Set<string>, queries: string[], websiteUrl: string, websiteConfirmed: boolean): ResearchFields {
  const raw=value as {presence:Presence[];websiteReview:{summary:string;pages:ReviewedPage[];notChecked:string[]};offers:Offer[]};
  const text=(v:unknown):v is string=>typeof v==='string' && v.length<=10000;
  const strings=(v:unknown,n:number)=>Array.isArray(v) && v.length<=n && v.every(text);
  if(!raw || !Array.isArray(raw.presence) || raw.presence.length>8 || !raw.presence.every(v=>v && RESEARCH_CHANNELS.includes(v.channel as typeof RESEARCH_CHANNELS[number]) && ['potwierdzono','nie znaleziono','niedostępne','nie sprawdzono'].includes(v.status) && [v.url,v.evidence,v.identityEvidence,v.sourceUrl].every(text)) || new Set(raw.presence.map(v=>v.channel)).size!==raw.presence.length || !raw.websiteReview || !text(raw.websiteReview.summary) || !Array.isArray(raw.websiteReview.pages) || raw.websiteReview.pages.length>6 || !raw.websiteReview.pages.every(v=>v && [v.name,v.url,v.finding].every(text) && ['sprawdzono treść','wynik wyszukiwania','niedostępna','nie sprawdzono'].includes(v.status)) || !strings(raw.websiteReview.notChecked,10) || !Array.isArray(raw.offers) || raw.offers.length>5 || !raw.offers.every(v=>v && [v.service,v.reason,v.benefit,v.sourceUrl,v.question].every(text) && ['wysoki','średni','niski'].includes(v.priority) && ['fakt','hipoteza'].includes(v.basis))) throw new Error('Nieprawidłowy rozszerzony raport AI. Nie zapisano analizy.');
  const verified=(url:string)=>sources.has(url) ? url : '';
  const presence=RESEARCH_CHANNELS.map(channel=>{
    const row=raw.presence.find(v=>v.channel===channel);
    if(!row) return {channel,status:'nie sprawdzono' as const,url:'',sourceUrl:'',identityEvidence:'',evidence:'Brak potwierdzenia sprawdzenia tego kanału.'};
    const url=verified(row.url),sourceUrl=verified(row.sourceUrl);
    if(row.status==='potwierdzono' && (!url || !sourceUrl || !row.identityEvidence.trim() || !channelUrl(channel,url))) return {...row,url:'',sourceUrl:'',identityEvidence:'',status:'nie sprawdzono' as const,evidence:'Nie uzyskano źródeł pozwalających potwierdzić profil tej firmy.'};
    if(row.status==='nie znaleziono' && !queries.some(q=>channelPatterns[channel].test(q))) return {...row,url:'',sourceUrl:'',identityEvidence:'',status:'nie sprawdzono' as const,evidence:'API nie zwróciło zapytania potwierdzającego sprawdzenie tego kanału.'};
    return {...row,url,sourceUrl,identityEvidence:row.status==='potwierdzono' ? row.identityEvidence : ''};
  });
  const sameSite=(url:string)=>{try {return new URL(url).hostname===new URL(websiteUrl).hostname;}catch{return false;}};
  const pages=raw.websiteReview.pages.map(page=>{
    const url=verified(page.url);
    if(!url || !websiteConfirmed || !sameSite(url)) return {...page,url:'',status:'nie sprawdzono' as const,finding:'Nie potwierdzono odczytu tej podstrony właściwej firmy.'};
    return {...page,url,status:page.status==='sprawdzono treść' && !opened.has(url) ? 'wynik wyszukiwania' as const : page.status};
  });
  const offers=raw.offers.map(offer=>({...offer,sourceUrl:verified(offer.sourceUrl),basis:offer.basis==='fakt' && !verified(offer.sourceUrl) ? 'hipoteza' as const : offer.basis})).sort((a,b)=>['wysoki','średni','niski'].indexOf(a.priority)-['wysoki','średni','niski'].indexOf(b.priority));
  const notChecked=[...raw.websiteReview.notChecked.slice(0,8),'Nie wykonano pomiarów szybkości, SEO technicznego, widoku mobilnego ani testów wysłania formularza lub zamówienia.'];
  if(!websiteConfirmed) notChecked.push('Tożsamość strony firmy nie została potwierdzona; ustalenia o jej podstronach wymagają sprawdzenia.');
  return {analysisVersion:2,presence,websiteReview:{summary:websiteConfirmed ? raw.websiteReview.summary : 'Brak potwierdzonej strony do analizy podstron.',pages,notChecked},offers,searchQueries:queries.slice(0,30)};
}
