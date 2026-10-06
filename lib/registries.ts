import { categorizePkd } from './pkd';
import { reserveCeidgRequest, CeidgRateLimitError, type RegistryCompany } from './store';

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
function dateOnly(value: unknown) {
  const text = str(value);
  if (!text) return undefined;
  const european = text.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (european) return `${european[3]}-${european[2]}-${european[1]}`;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
}
function required(value: unknown, field: string) { const text = str(value); if (!text) throw new Error(`Niepełna odpowiedź rejestru: ${field}.`); return text; }
export function safeWebsite(value: unknown) {
  const text = str(value); if (!text) return undefined;
  try { const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
export function normalizeCeidg(value: unknown): RegistryCompany {
  const entry = obj(value), owner = obj(entry.wlasciciel), address = obj(entry.adresDzialalnosci), pkd = obj(entry.pkdGlowny);
  const registryId = required(entry.id, 'id');
  return { id: `CEIDG:${registryId}`, registryId, source: 'CEIDG', name: required(entry.nazwa, 'nazwa'), nip: str(owner.nip), regon: str(owner.regon) || undefined, startedAt: dateOnly(entry.dataRozpoczecia ?? entry.dataRozpoczeciaDzialalnosci ?? entry.dataRozpoczeciaWykonywaniaDzialalnosci ?? owner.dataRozpoczecia), city: str(address.miasto), voivodeship: str(address.wojewodztwo), pkdMain: str(pkd.kod), pkdName: str(pkd.nazwa), pkdYear: str(entry.rokPkd), category: categorizePkd(str(pkd.kod)), phone: str(entry.telefon) || undefined, email: str(entry.email) || undefined, website: safeWebsite(entry.www), registryStatus: str(entry.status), syncedAt: new Date().toISOString() };
}
export function normalizeKrs(value: unknown, krs: string): RegistryCompany {
  const odpis = obj(obj(value).odpis), data = obj(odpis.dane), section = obj(data.dzial1), company = obj(section.danePodmiotu), identifiers = obj(company.identyfikatory), seat = obj(obj(section.siedzibaIAdres).siedziba), contact = obj(section.siedzibaIAdres);
  const activities = obj(obj(data.dzial3).przedmiotDzialalnosci).przedmiotPrzewazajacejDzialalnosci;
  const pkd = obj(Array.isArray(activities) ? activities[0] : null);
  const code = [str(pkd.kodDzial), str(pkd.kodKlasa), str(pkd.kodPodklasa)].join('');
  const number = str(obj(odpis.naglowekA).numerKRS);
  if (number && number.padStart(10, '0') !== krs) throw new Error('Odpowiedź KRS dotyczy innego podmiotu.');
  const header = obj(odpis.naglowekA);
  return { id: `KRS:${krs}`, registryId: krs, source: 'KRS', krs, name: required(company.nazwa, 'nazwa podmiotu KRS'), nip: str(identifiers.nip), regon: str(identifiers.regon) || undefined, startedAt: dateOnly(header.dataPierwszegoWpisu ?? header.dataWpisuDoRejestru ?? header.dataWpisu), city: str(seat.miejscowosc), voivodeship: str(seat.wojewodztwo), pkdMain: code, pkdName: str(pkd.opis), category: categorizePkd(code), email: str(contact.adresPocztyElektronicznej) || undefined, website: safeWebsite(contact.adresStronyInternetowej), syncedAt: new Date().toISOString() };
}
export class RegistryError extends Error { constructor(message: string, public status = 502, public retryAfter?: string, public upstreamStatus?: number) { super(message); } }
async function getJson(url: URL, token?: string): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { throw new RegistryError('Rejestr nie odpowiada. Sprawdź połączenie i spróbuj ponownie.'); }
  if (response.status === 204) return null;
  if (!response.ok) {
    if (response.status === 400) {
      const details = obj(await response.json().catch(() => null));
      let message = str(details.message);
      if (token) message = message.replaceAll(token, '[ukryto]');
      message = message.replace(/Bearer\s+\S+|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g, '[ukryto]').replace(/[\r\n\t]/g, ' ').slice(0, 300);
      throw new RegistryError(`Rejestr odrzucił parametry zapytania${message ? `: ${message}` : '.'}`, 502, undefined, 400);
    }
    const messages: Record<number, string> = { 400: 'Rejestr odrzucił parametry zapytania.', 401: 'CEIDG odrzucił token. Sprawdź CEIDG_API_TOKEN w ustawieniach Vercel.', 403: 'Brak uprawnień do rejestru.', 404: 'Nie znaleziono podmiotu w rejestrze.', 429: 'Limit żądań rejestru. Spróbuj później.' };
    throw new RegistryError(messages[response.status] || 'Usługa rejestru jest chwilowo niedostępna.', response.status === 429 ? 429 : response.status === 404 ? 404 : 502, response.headers.get('retry-after') || undefined, response.status);
  }
  try { return await response.json(); } catch { throw new RegistryError('Rejestr zwrócił nieprawidłowy format danych.'); }
}
async function ceidgRequest(url: URL) {
  const token = process.env.CEIDG_API_TOKEN?.trim();
  if (!token) throw new RegistryError('Dodaj CEIDG_API_TOKEN w ustawieniach Vercel i wykonaj ponowne wdrożenie.', 503);
  try { await reserveCeidgRequest(); } catch (error) { throw new RegistryError((error as Error).message, 429, error instanceof CeidgRateLimitError ? String(error.retryAfter) : '4'); }
  return getJson(url, token);
}
export async function ceidgActivePage(page: number) {
  const url = new URL('https://dane.biznes.gov.pl/api/ceidg/v3/firmy');
  url.searchParams.set('status', 'AKTYWNY'); url.searchParams.set('limit', '25'); url.searchParams.set('page', String(page));
  const response = await ceidgRequest(url);
  if (!response) return { ids: [], total: 0, nextPage: null };
  const data = obj(response);
  if (!Array.isArray(data.firmy)) throw new RegistryError('Nieznany format listy CEIDG.');
  const ids = data.firmy.map(entry => required(obj(entry).id, 'id'));
  if (new Set(ids).size !== ids.length) throw new RegistryError('Lista CEIDG zawiera powtórzone identyfikatory.');
  const links = obj(data.links);
  let nextPage: number | null = null;
  if (typeof links.next === 'string' && links.next) {
    const next = new URL(links.next);
    if (next.origin !== url.origin || next.pathname !== url.pathname || next.searchParams.get('status') !== 'AKTYWNY' || next.searchParams.get('dataod') || next.searchParams.get('datado')) throw new RegistryError('Nieprawidłowy odsyłacz kolejnej strony CEIDG.');
    const number = Number(next.searchParams.get('page'));
    if (Number.isSafeInteger(number) && number > page) nextPage = number;
  }
  // Some responses repeat the current page in links.next, even on the last page.
  if (nextPage === null && ids.length === 25) {
    const total = typeof data.count === 'number' ? data.count : 0;
    if (total > (page + 1) * 25) nextPage = page + 1;
    else if (!('next' in links) && total === 0) throw new RegistryError('CEIDG nie podał informacji o kolejnej stronie.');
  }
  return { ids, total: typeof data.count === 'number' ? data.count : null, nextPage };
}
export async function ceidgDetails(ids: string[]) {
  if (!ids.length || ids.length > 25 || ids.some(id => !/^[a-zA-Z0-9-]{1,80}$/.test(id))) throw new RegistryError('Nieprawidłowa partia identyfikatorów CEIDG.', 400);
  const url = new URL('https://dane.biznes.gov.pl/api/ceidg/v3/firma');
  ids.forEach(id => url.searchParams.append('ids', id));
  const response = await ceidgRequest(url);
  if (!response) return [];
  const firms = obj(response).firma;
  if (!Array.isArray(firms)) throw new RegistryError('Nieznany format szczegółów CEIDG.');
  const result = firms.map(normalizeCeidg);
  if (new Set(result.map(firm => firm.registryId)).size !== result.length) throw new RegistryError('Powtórzone szczegóły firm w odpowiedzi CEIDG.');
  if (result.some(firm => !ids.includes(firm.registryId))) throw new RegistryError('CEIDG zwrócił firmę spoza zamówionej partii.');
  return result;
}
export async function ceidgByNip(nip: string) {
  if (!/^\d{10}$/.test(nip)) throw new RegistryError('NIP musi zawierać 10 cyfr.', 400);
  const url = new URL('https://dane.biznes.gov.pl/api/ceidg/v3/firma'); url.searchParams.set('nip', nip);
  const data = await ceidgRequest(url);
  if (!data) return [];
  const firms = obj(data).firma;
  if (!Array.isArray(firms)) throw new RegistryError('Nieznany format odpowiedzi CEIDG.');
  return firms.map(normalizeCeidg);
}
export async function krsByNumber(input: string) {
  if (!/^\d{1,10}$/.test(input)) throw new RegistryError('KRS musi zawierać od 1 do 10 cyfr.', 400);
  const krs = input.padStart(10, '0');
  const url = new URL(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${krs}`); url.searchParams.set('rejestr', 'P'); url.searchParams.set('format', 'json');
  return [normalizeKrs(await getJson(url), krs)];
}
