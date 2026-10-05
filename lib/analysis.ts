import type { Company, LeadAnalysis } from './types';

export const ANALYSIS_VERSION = 1;
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
    if (!company.website) opportunities.push({ channel: 'Strona WWW', confidence: 'Niska', reason: `Brak WWW w rejestrze; działalność: ${company.pkdName}. Sprawdź możliwość strony ofertowej lub katalogu.` });
    if (consumerGoods) {
      opportunities.push({ channel: 'Allegro', confidence: 'Umiarkowana', reason: `Główna działalność wskazuje handel detaliczny lub wytwarzanie towarów (${company.pkdMain}). Dopasowanie zależy od rzeczywistego asortymentu.` });
      opportunities.push({ channel: 'Amazon / eBay', confidence: 'Niska', reason: 'Możliwy kierunek sprzedaży towarów za granicą. Rejestr nie potwierdza eksportu, produktów ani gotowości logistycznej.' });
      nextSteps.push('Sprawdź asortyment, ograniczenia platform, marżę, dostawy, zwroty i obsługę językową. Rozważ także zagraniczne rynki Allegro.');
    } else if (restricted) nextSteps.push('Branża wymaga sprawdzenia ograniczeń asortymentu; nie przypisano automatycznie marketplace.');
    else if (company.website) nextSteps.push('WWW jest podana w rejestrze. Jej jakości, sklepu i obecności na marketplace jeszcze nie sprawdzono.');
  }
  return { version: ANALYSIS_VERSION, checkedAt: company.syncedAt, opportunities, issues, nextSteps,
    priority: opportunities.length ? (consumerGoods && (company.phone || company.email) ? 'Sprawdź wcześniej' : 'Standardowy') : 'Brak podstaw' };
}
