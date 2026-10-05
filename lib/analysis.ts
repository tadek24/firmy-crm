import type { Company, LeadAnalysis } from './types';
import { businessSector } from './pkd';

export const ANALYSIS_VERSION = 2;
type Input = Pick<Company, 'source' | 'registryStatus' | 'syncedAt' | 'pkdMain' | 'pkdName' | 'pkdYear' | 'website' | 'phone' | 'email' | 'city'>;

// Registry signals describe possible fit, never a company's intent or audited web presence.
export function analyzeCompany(company: Input): LeadAnalysis {
  const code = company.pkdMain.replace(/[^0-9]/g, '');
  const division = Number(code.slice(0, 2));
  const description = company.pkdName.toLocaleLowerCase('pl');
  const issues: string[] = [];
  const opportunities: LeadAnalysis['opportunities'] = [];
  const nextSteps = ['Potwierdź faktyczną obecność firmy w internecie i jej potrzeby przed przygotowaniem oferty.'];
  if (!company.website) issues.push('WWW nie podana w rejestrze — firma może mieć stronę.');
  if (!company.email && !company.phone) issues.push('Brak telefonu i e-maila w rejestrze.');
  if (!code || !company.pkdName) issues.push('Niepełne dane głównej działalności PKD.');
  if (!company.city) issues.push('Brak miejscowości w rejestrze.');
  if (!company.pkdYear) issues.push('Wersja PKD nie została podana; interpretacja branży jest ostrożna.');
  const inactive = company.source === 'CEIDG' && company.registryStatus !== 'AKTYWNY';
  if (inactive) issues.push('Aktywność firmy nie jest potwierdzona jako AKTYWNY w CEIDG.');
  const known = code.length >= 4 && Boolean(company.pkdName);
  const restricted = /alkohol|tytoni|papieros|farmaceut|leków|paliw|broni|amunicj|wyrobów medycznych/.test(description);
  // PKD 2025 47.91 is intermediation; only PKD 2007 described internet retail.
  const oldInternetRetail = code.startsWith('4791') && company.pkdYear === '2007';
  const intermediary = /pośrednictw|pośrednic/.test(description) || (code.startsWith('479') && !oldInternetRetail);
  const consumerGoods = !restricted && !intermediary && known && (
    (division === 47 && (!code.startsWith('479') || oldInternetRetail)) ||
    [13, 14, 15, 16, 18, 23, 31, 32].includes(division)
  );
  if (!inactive && known) {
    if (!company.website) opportunities.push({ channel: 'Strona WWW', confidence: 'Niska', reason: `Brak WWW w rejestrze; działalność: ${company.pkdName}. Sprawdź możliwość strony ofertowej lub katalogu.`,
      offer: businessSector(company.pkdMain) === 'Handel' ? 'Katalog produktów lub sklep po sprawdzeniu asortymentu; dla hurtowni także zapytania B2B.' : 'Strona usługowa z opisem oferty i formularzem zapytania; rezerwacje, jeśli pasują do sposobu pracy.',
      benefit: 'Łatwiejsze przedstawienie oferty i pozyskiwanie zapytań poza samym telefonem. Rejestr nie mierzy obecnej liczby klientów ani efektu takiej zmiany.',
      questions: ['Czy firma ma już stronę, której nie podała w CEIDG?', 'Skąd obecnie trafiają klienci i o co najczęściej pytają?', 'Czy celem są zapytania, rezerwacje czy sprzedaż produktów?'] });
    if (consumerGoods) {
      opportunities.push({ channel: 'Allegro', confidence: 'Umiarkowana', reason: `Główna działalność wskazuje handel detaliczny lub wytwarzanie towarów (${company.pkdMain}). Dopasowanie zależy od rzeczywistego asortymentu.`,
        offer: 'Uruchomienie lub uporządkowanie sprzedaży Allegro: katalog ofert, zdjęcia i opisy, a następnie integracja zamówień i stanów.',
        benefit: 'Możliwy dodatkowy kanał dotarcia do kupujących oraz mniej ręcznego przepisywania zamówień. Wzrost sprzedaży i opłacalność wymagają oceny.',
        questions: ['Czy firma już sprzedaje na Allegro?', 'Jakie produkty, marże i stany magazynowe ma w ofercie?', 'Czy obsłuży wysyłkę, zwroty i więcej zamówień?'] });
      opportunities.push({ channel: 'Amazon / eBay', confidence: 'Niska', reason: 'Możliwy kierunek sprzedaży towarów za granicą. Rejestr nie potwierdza eksportu, produktów ani gotowości logistycznej.',
        offer: 'Ocena jednego rynku i mały pilotaż wybranego asortymentu, z ofertami w odpowiednim języku i przygotowaną obsługą dostaw.',
        benefit: 'Możliwość dotarcia do nowych rynków. Nie jest to potwierdzenie popytu ani rekomendacja uruchomienia eksportu bez sprawdzenia kosztów.',
        questions: ['Czy produkty mają dokumentację i mogą być oferowane na docelowym rynku?', 'Czy marża pokryje opłaty platformy, dostawę i zwroty?', 'Kto obsłuży klientów w języku danego rynku?'] });
      nextSteps.push('Sprawdź asortyment, ograniczenia platform, marżę, dostawy, zwroty i obsługę językową. Rozważ także zagraniczne rynki Allegro.');
    } else if (restricted) nextSteps.push('Branża wymaga sprawdzenia ograniczeń asortymentu; nie przypisano automatycznie marketplace.');
    else if (company.website) nextSteps.push('WWW jest podana w rejestrze. Jej jakości, sklepu i obecności na marketplace jeszcze nie sprawdzono.');
  }
  const sector = businessSector(company.pkdMain);
  const fitReasons: LeadAnalysis['fitReasons'] = inactive ? [] : [
    ...(sector !== 'Pozostałe' ? [{ points: 30, label: `Branża pasuje do zakresu oferty: ${sector.toLocaleLowerCase('pl')}` }] : []),
    ...(known ? [{ points: 10, label: 'Główny PKD i jego opis są dostępne' }] : []),
    ...(known && !company.website ? [{ points: 20, label: 'WWW nie podana w rejestrze — sygnał do sprawdzenia' }] : []),
    ...(company.email || company.phone ? [{ points: 20, label: 'Dostępny telefon lub e-mail' }] : []),
    ...(consumerGoods ? [{ points: 20, label: 'Profil towarowy może pasować do marketplace' }] : []),
  ];
  return { version: ANALYSIS_VERSION, checkedAt: company.syncedAt, opportunities, issues, nextSteps, sector,
    fitScore: fitReasons.reduce((sum, reason) => sum + reason.points, 0), fitReasons,
    priority: opportunities.length ? ((sector !== 'Pozostałe' && (company.phone || company.email)) ? 'Sprawdź wcześniej' : 'Standardowy') : 'Brak podstaw' };
}
