"use client";
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, ArrowUpRight, Building2, Search, X } from 'lucide-react';
import type { Company, LeadStatus } from '@/lib/types';
import { BulkImport } from './bulk-import';
import { AnalysisSummary } from './lead-analysis';
import { CompanyDetail } from './company-detail';
import { canCall, type CurrentUser, type TeamPerson } from '@/lib/team';
import { TeamPanel } from './team-panel';
import { contactFilters, parseContactFilter, type ContactFilter } from '@/lib/contact-filters';
const statuses: LeadStatus[] = ['Nowy', 'Do sprawdzenia', 'Do kontaktu', 'Kontakt wykonany', 'Zainteresowany', 'Oferta wysłana', 'Negocjacje', 'Klient', 'Nie zainteresowany', 'Nie kontaktować'];
type ImportEntry = { id: number; source: string; count: number; createdAt: string };
async function api(url: string, options?: RequestInit) {
  const response = await fetch(url, options); const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Nie udało się wykonać operacji.'); return data;
}
export function CrmApp() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [imports, setImports] = useState<ImportEntry[]>([]);
  const [configured, setConfigured] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [launchToken, setLaunchToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''); const [status, setStatus] = useState('Wszystkie'); const [category, setCategory] = useState('Wszystkie');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importedCompany, setImportedCompany] = useState<Company | null>(null);
  const [view, setView] = useState<'companies' | 'registries' | 'team'>('companies');
  const [source, setSource] = useState('KRS'); const [identifier, setIdentifier] = useState('');
  const [page, setPage] = useState(0);
  const [contact, setContact] = useState<ContactFilter>('all');
  const [scope, setScope] = useState('prospects');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [directory, setDirectory] = useState<TeamPerson[]>([]);
  const person = user?.person || '';
  const [owner, setOwner] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const people = [...new Set([...directory.map(entry => entry.name), ...assignees])].sort((a,b) => a.localeCompare(b,'pl'));
  const activePeople = directory.filter(entry => entry.active).map(entry => entry.name);

  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState({ total: 0, toContact: 0, active: 0, website: 0, email: 0, phone: 0 });
  const listUrl = `/api/companies?${new URLSearchParams({ q: query, status, category, contact, scope, owner, tag: tagFilter, page: String(page) })}`;
  async function load() { const data = await api(listUrl); setCompanies(data.companies); setImports(data.imports); setConfigured(data.ceidgConfigured); setAiConfigured(data.aiConfigured); setTotal(data.total); setCategories(data.categories); setStats(data.stats); setAssignees(data.assignees || []); setTagOptions(data.tags || []); setUser(data.user); setDirectory(data.people || []); setUser(data.user); setDirectory(data.people || []); }
  useEffect(() => { let cancelled = false;
    window.localStorage.removeItem('firmy-crm-demo-v1'); window.localStorage.removeItem('firmy-crm-person');
    async function refresh() {
      try { const data = await api(listUrl);
        if (!cancelled) { setCompanies(data.companies); setImports(data.imports); setConfigured(data.ceidgConfigured); setAiConfigured(data.aiConfigured); setTotal(data.total); setCategories(data.categories); setStats(data.stats); setAssignees(data.assignees || []); setTagOptions(data.tags || []); }
      } catch (error) { if (!cancelled) setError((error as Error).message); }
      finally { if (!cancelled) setLoading(false); }
    }
    const debounce = setTimeout(refresh, 250); const timer = setInterval(refresh, 10000);
    return () => { cancelled = true; clearTimeout(debounce); clearInterval(timer); };
  }, [listUrl]);
  async function importCompany(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const result = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, identifier }) });
      await load(); setImportedCompany(result.companies[0]); setSelectedId(result.companies[0].id); setView('companies'); setNotice(`Zapisano dane ${result.count} firm z ${source}.`); setIdentifier('');
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function update(id: string, patch: Partial<Company>) {
    setBusy(true); setError(''); setNotice('');
    try { const data = await api(`/api/companies/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      setCompanies(current => current.map(company => company.id === id ? data.company : company)); setImportedCompany(data.company); await load(); setNotice('Zmiany zapisane.'); return data.company as Company;
    } catch (error) { setError((error as Error).message); await load().catch(() => {}); throw error; } finally { setBusy(false); }
  }
  async function analyze(company: Company) {
    setSelectedId(company.id); setAiBusy(company.id); setError('');
    try {
      if (aiConfigured) await api(`/api/companies/${encodeURIComponent(company.id)}/analysis`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:false})});
      setLaunchToken(current => current + 1); await load();
    } catch (error) { setError((error as Error).message); } finally { setAiBusy(null); }
  }
  const selected = companies.find(company => company.id === selectedId) || (importedCompany?.id === selectedId ? importedCompany : null);
  const filtered = companies;
  return <div className="workspace">
    <header className="masthead"><Link className="brand" href="/"><span className="brand-mark">F /</span> Firmy <span>CRM</span></Link><nav aria-label="Nawigacja"><button className={view === 'companies' ? 'active' : ''} onClick={() => setView('companies')}>Baza firm <small>{stats.total.toLocaleString("pl-PL")}</small></button><button className={view === 'registries' ? 'active' : ''} onClick={() => setView('registries')}>Rejestry i import</button>{user?.role === 'admin' && <button className={view === 'team' ? 'active' : ''} onClick={() => setView('team')}>Zespół i dostęp</button>}</nav><span className="workspace-label">{user?.name || 'Wczytywanie konta…'}</span><button onClick={async () => { await fetch('/api/auth', { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }); window.location.reload(); }}>Wyloguj</button></header>
    <div className="page-heading"><div><p className="eyebrow">PROSPECTING / {view === 'companies' ? 'KARTOTEKA' : view === 'team' ? 'ADMINISTRACJA' : 'ŹRÓDŁA DANYCH'}</p><h1>{view === 'companies' ? 'Baza firm' : view === 'team' ? 'Zespół i dostęp' : 'Rejestry i import'}<span className="heading-index"> / 01</span></h1></div><button className="primary" onClick={() => setView('registries')}><ArrowDownToLine size={16}/> Pobierz firmę</button></div>
    <div className="summary-line"><span><strong>{stats.total.toLocaleString("pl-PL")}</strong> w bazie</span><span><strong>{stats.toContact.toLocaleString("pl-PL")}</strong> do kontaktu</span><span><strong>{stats.active.toLocaleString("pl-PL")}</strong> aktywne leady</span><span className="summary-source">WWW {stats.website.toLocaleString("pl-PL")} · E-mail {stats.email.toLocaleString("pl-PL")} · Telefon {stats.phone.toLocaleString("pl-PL")}</span></div>
    {error && <div className="feedback error" role="alert">{error}<button aria-label="Zamknij komunikat" onClick={() => setError('')}><X size={16}/></button></div>}{notice && <div className="feedback" role="status">{notice}</div>}
    {view === 'team' && user?.role === 'admin' ? <TeamPanel onChanged={load}/> : view === 'registries' ? <div className="registry-workspace"><section><BulkImport/><p className="eyebrow">POJEDYNCZA FIRMA / CEIDG LUB KRS</p><h2>Dodaj firmę z rejestru</h2><p className="muted">Pobierz aktualny wpis. Ponowny import odświeża dane firmy i zachowuje Twoje notatki, etykiety i status.</p><form onSubmit={importCompany} className="import-form"><label>Rejestr<select value={source} disabled={busy} onChange={e => {setSource(e.target.value); setIdentifier('');}}><option value="KRS">KRS — przedsiębiorcy</option><option value="CEIDG">CEIDG — działalności gospodarcze</option></select></label><label>{source === 'KRS' ? 'Numer KRS' : 'Numer NIP'}<input required inputMode="numeric" maxLength={10} pattern={source === 'KRS' ? '[0-9]{1,10}' : '[0-9]{10}'} value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder={source === 'KRS' ? 'Wprowadź numer KRS' : 'Wprowadź 10 cyfr NIP'} disabled={busy}/></label><button className="primary" disabled={busy || (source === 'CEIDG' && !configured)}>{busy ? 'Pobieranie…' : 'Pobierz i zapisz'}</button></form><p className="muted small">KRS wymaga numeru KRS. Publiczne API odpisów nie wyszukuje po NIP ani nazwie.</p></section><aside className="registry-info"><h3>Dostęp do rejestrów</h3><div className="connection-row"><strong>KRS</strong><span>Bez tokenu</span></div><div className="connection-row"><strong>CEIDG API v3</strong><span>{configured ? 'Token skonfigurowany' : 'Wymaga tokenu'}</span></div><p className="muted">{configured ? 'Token zostanie zweryfikowany przy pobraniu firmy.' : 'Dodaj token z Hurtowni Danych jako CEIDG_API_TOKEN w ustawieniach Vercel i wykonaj ponowne wdrożenie.'}</p><a href="https://akademia.biznes.gov.pl/portal/004856" target="_blank" rel="noreferrer">Dokumentacja CEIDG <ArrowUpRight size={14}/></a><a href="https://prs.ms.gov.pl/krs/openApi" target="_blank" rel="noreferrer">Dokumentacja KRS <ArrowUpRight size={14}/></a><h3 className="history-title">Ostatnie importy</h3>{imports.length ? imports.map(entry => <div className="history-row" key={entry.id}><strong>{entry.source} · {entry.count} firm</strong><span>{new Date(entry.createdAt).toLocaleString('pl-PL')}</span></div>) : <p className="muted">Nie wykonano jeszcze importu.</p>}</aside></div> : <div className={`operation-grid ${selected ? 'with-detail' : ''}`}><section className="list-pane"><div className="toolbar"><label className="search"><Search size={16}/><input aria-label="Szukaj firm" value={query} onChange={e => {setQuery(e.target.value); setPage(0);}} placeholder="Nazwa, NIP, miasto, PKD, etykieta…"/></label><select aria-label="Status leada" value={status} onChange={e => {setStatus(e.target.value); setPage(0);}}><option>Wszystkie</option>{statuses.map(s => <option key={s}>{s}</option>)}</select><select aria-label="Kategoria PKD" value={category} onChange={e => {setCategory(e.target.value); setPage(0);}}><option>Wszystkie</option>{categories.map(c => <option key={c}>{c}</option>)}</select></div><div className="contact-filter-line"><label htmlFor="company-scope">Widok</label><select id="company-scope" value={scope} onChange={e => {setScope(e.target.value); setPage(0);}}><option value="prospects">Kolejka dopasowanych firm</option><option value="all">Wszystkie zapisane firmy</option></select><label htmlFor="contact-filter">Dane kontaktowe</label><select id="contact-filter" value={contact} onChange={e => {setContact(parseContactFilter(e.target.value)); setPage(0);}}>{contactFilters.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="muted small">Według danych udostępnionych w rejestrze</span></div><div className="team-filter-line"><label>Osoba odpowiedzialna<select value={owner} onChange={e => {setOwner(e.target.value);setPage(0);}}><option value="">Wszystkie osoby</option><option value="unassigned">Nieprzypisane</option>{people.map(name => <option key={name} value={`person:${name}`}>{name}</option>)}</select></label><label>Oznaczenie<select value={tagFilter} onChange={e => {setTagFilter(e.target.value);setPage(0);}}><option value="">Wszystkie oznaczenia</option>{[...new Set([...tagOptions, ...(tagFilter ? [tagFilter] : [])])].map(name => <option key={name}>{name}</option>)}</select></label><datalist id="team-tags">{tagOptions.map(name => <option key={name} value={name}/>)}</datalist><p className="muted small">Przed telefonem przejmij nieprzypisany kontakt. Pracujesz na koncie {user?.name || '…'}{person ? `, powiązanym z osobą ${person}` : '. Administrator musi połączyć Twoje konto z osobą odpowiedzialną, aby przejmować kontakty'}. Lista odświeża się co 10 sekund.</p></div><div className="result-line"><span>{loading ? 'Wczytywanie…' : `${total.toLocaleString("pl-PL")} firm`}</span><span>DANE REJESTROWE / STATUS HANDLOWY</span></div><div className="table-wrap"><table><thead><tr><th>Firma / identyfikator</th><th>Lokalizacja</th><th>PKD</th><th>Kontakt</th><th>Potencjał / kontrola</th><th>Osoba / status</th></tr></thead><tbody>{filtered.map(company => <tr key={company.id} className={selectedId === company.id ? 'selected' : ''}><td><button className="company-name" onClick={() => setSelectedId(company.id)}>{company.name}</button><span className="subline">{company.source} · {company.nip ? `NIP ${company.nip}` : `KRS ${company.krs}`}</span>{company.tags.length > 0 && <span className="subline">{company.tags.join(' / ')}</span>}</td><td>{company.city || '—'}<span className="subline">{company.voivodeship}</span></td><td className="mono">{company.pkdMain || '—'}<span className="subline">{company.category}</span></td><td className="table-contacts">{company.website && <a href={company.website} target="_blank" rel="noreferrer">WWW ↗</a>}{company.email && <a href={`mailto:${company.email}`}>{company.email}</a>}{company.phone && (canCall(company,person) ? <a href={`tel:${company.phone.replace(/[^+\d]/g, "")}`}>{company.phone}</a> : <span className="phone-readonly" title="Przed telefonem zapisz przypisanie firmy do siebie">{company.phone}</span>)}{!company.website && !company.email && !company.phone && <span className="muted">Brak w rejestrze</span>}</td><td><AnalysisSummary company={company}/><button className="ai-row-button" disabled={aiBusy === company.id} onClick={() => void analyze(company)}>{aiBusy === company.id ? 'Uruchamianie…' : company.aiState === 'completed' ? 'Raport AI' : company.aiState === 'queued' || company.aiState === 'running' ? 'AI w trakcie…' : 'Analizuj AI'}</button></td><td><strong className="assignee-name">{company.assignee || 'Nieprzypisana'}</strong><span className="status-label">{company.status}</span>{!company.assignee && <button className="claim-button" disabled={busy || !person.trim()} title={person.trim() ? `Przypisz do ${person.trim()} przed telefonem` : 'Administrator musi połączyć konto z osobą odpowiedzialną'} onClick={async () => {try {await update(company.id,{assignee:person.trim(),crmRevision:company.crmRevision || '0'});} catch { /* Error is shown by update. */ }}}>Przejmij kontakt</button>}</td></tr>)}</tbody></table></div>{!loading && !filtered.length && <div className="empty"><Building2 size={30} strokeWidth={1}/><h2>{stats.total ? 'Brak wyników' : 'Zacznij od pierwszej firmy'}</h2><p>{stats.total ? 'Zmień wyszukiwanie lub filtry.' : 'Pobierz aktualne dane z CEIDG lub KRS, aby rozpocząć pracę.'}</p>{!stats.total && <button className="primary" onClick={() => setView('registries')}>Przejdź do importu <ArrowUpRight size={15}/></button>}</div>}<div className="pagination"><span>Strona {page + 1} / {Math.max(1, Math.ceil(total / 100))} · do 100 firm na stronie</span><div><button disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>Poprzednia</button><button disabled={(page + 1) * 100 >= total || loading} onClick={() => setPage(page + 1)}>Następna</button></div></div></section>{selected && <CompanyDetail key={selected.id} company={selected} launchToken={launchToken} person={person} people={activePeople} admin={user?.role === 'admin'} busy={busy} onClose={() => setSelectedId(null)} onUpdate={patch => update(selected.id, patch)}/>}</div>}
    <footer><span>Firmy CRM / Kartoteka operacyjna</span><span>Dane zapisane w chmurze</span></footer>
  </div>;
}
