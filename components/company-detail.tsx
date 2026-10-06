"use client";
import { useState, type FormEvent } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import type { Company, LeadStatus } from '@/lib/types';
import { canCall } from '@/lib/team';
import { AnalysisDetail } from './lead-analysis';
import { AiAnalysis } from './ai-analysis';

const statuses: LeadStatus[] = ['Nowy', 'Do sprawdzenia', 'Do kontaktu', 'Kontakt wykonany', 'Zainteresowany', 'Oferta wysłana', 'Negocjacje', 'Klient', 'Nie zainteresowany', 'Nie kontaktować'];
type Props = { company: Company; person: string; people: string[]; admin: boolean; busy: boolean; launchToken?: number; onClose: () => void; onUpdate: (patch: Partial<Company>) => Promise<Company> };

export function CompanyDetail({ company, person, people, admin, busy, launchToken, onClose, onUpdate }: Props) {
  const [draft, setDraft] = useState(() => ({ note: company.note || '', status: company.status, tags: company.tags, assignee: company.assignee || '', crmRevision: company.crmRevision || '0' }));
  const [tag, setTag] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const locked = !admin && Boolean(company.assignee && company.assignee !== person);
  const changedElsewhere = draft.crmRevision !== (company.crmRevision || '0');
  function reload() { setDraft({ note: company.note || '', status: company.status, tags: company.tags, assignee: company.assignee || '', crmRevision: company.crmRevision || '0' }); setTag(''); setEditingTag(null); }
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await onUpdate(draft);
      setDraft({ note: saved.note || '', status: saved.status, tags: saved.tags, assignee: saved.assignee || '', crmRevision: saved.crmRevision || '0' });
    } catch { /* Keep draft; the parent displays the conflict or failure. */ }
  }
  function applyTag() {
    const value = tag.trim();
    if (!value) return;
    const next = editingTag ? draft.tags.map(t => t === editingTag ? value : t) : [...draft.tags, value];
    setDraft({ ...draft, tags: [...new Map(next.map(t => [t.toLocaleLowerCase('pl'), t])).values()] });
    setTag(''); setEditingTag(null);
  }
  return <aside className="detail-pane">
    <div className="detail-heading"><span className="eyebrow">{company.source} / SZCZEGÓŁY</span><button aria-label="Zamknij szczegóły" onClick={onClose}><X size={18}/></button></div>
    <h2>{company.name}</h2>
    <div className="assignment-banner"><strong>{company.assignee ? `Kontakt prowadzi: ${company.assignee}` : 'Kontakt nieprzypisany'}</strong><p>Przed telefonem przypisz firmę do siebie i zapisz. Przekazanie kontaktu uzgodnij z osobą, która go prowadzi.</p></div>
    <form onSubmit={save} className="crm-form">
      <h3>Praca z firmą</h3>
      {changedElsewhere && <div className="draft-conflict" role="alert">Firma została zmieniona w innym oknie. Twój szkic pozostaje w formularzu. Wczytanie danych zastąpi go aktualnym zapisem.<button type="button" disabled={busy} onClick={reload}>Wczytaj aktualne dane</button></div>}
      <label>Osoba odpowiedzialna<select disabled={busy || locked} value={draft.assignee} onChange={e => setDraft({ ...draft, assignee: e.target.value })}><option value="">Nieprzypisana</option>{[...new Set([...(admin ? people : person ? [person] : []), ...(draft.assignee ? [draft.assignee] : [])])].map(name => <option key={name} value={name}>{name}{people.includes(name) ? '' : ' (osoba wyłączona)'}</option>)}</select></label>{locked && <p className="draft-conflict">Tę firmę prowadzi inna osoba. Administrator może przekazać kontakt.</p>}
      {person && <button type="button" disabled={busy || changedElsewhere || locked} onClick={() => setDraft({ ...draft, assignee: person.trim() })}>Wpisz mnie: {person.trim()}</button>}
      <label>Status leada<select disabled={busy} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as LeadStatus })}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Oznaczenia</label>
      <div className="editable-tags">{draft.tags.map(t => <div key={t}><span>{t}</span><button type="button" disabled={busy} aria-label={`Edytuj oznaczenie ${t}`} onClick={() => { setEditingTag(t); setTag(t); }}>Edytuj</button><button type="button" disabled={busy} aria-label={`Usuń oznaczenie ${t}`} onClick={() => { setDraft({ ...draft, tags: draft.tags.filter(x => x !== t) }); if (editingTag === t) { setEditingTag(null); setTag(''); } }}><X size={13}/></button></div>)}</div>
      <div className="tag-form"><input aria-label={editingTag ? 'Nazwa oznaczenia' : 'Nowe oznaczenie'} list="team-tags" maxLength={80} value={tag} onChange={e => setTag(e.target.value)} placeholder="Np. Pilne, Allegro" disabled={busy}/><button type="button" disabled={busy || !tag.trim() || (!editingTag && draft.tags.length >= 30)} onClick={applyTag}>{editingTag ? 'Zmień' : 'Dodaj'}</button>{editingTag && <button type="button" disabled={busy} onClick={() => {setEditingTag(null);setTag('');}}>Anuluj</button>}</div>
      <label>Notatka<textarea maxLength={20000} value={draft.note} disabled={busy} onChange={e => setDraft({ ...draft, note: e.target.value })} placeholder="Ustalenia, następny krok…"/></label>
      <button className="primary" disabled={busy || changedElsewhere || locked}>{busy ? 'Zapisywanie…' : 'Zapisz zmiany'}</button>
      <p className="muted small">Osoba, status i oznaczenia są wspólne dla zespołu po zapisaniu. Oznaczenia edytujesz przy tej firmie.</p>
      {company.lastContact && <p className="muted small">Kontakt oznaczony jako wykonany: {new Date(company.lastContact).toLocaleString('pl-PL')}</p>}
    </form>
    <dl>{[['NIP', company.nip], ['REGON', company.regon], ['KRS', company.krs], ['Data rozpoczęcia', company.startedAt ? new Date(company.startedAt).toLocaleDateString('pl-PL') : undefined], ['Miasto', company.city], ['Stan w rejestrze', company.registryStatus], ['PKD', company.pkdMain], ['Wersja PKD', company.pkdYear], ['Telefon', company.phone], ['E-mail', company.email]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
    {company.pkdName && <p className="muted small">{company.pkdName}</p>}
    <div className="contact-links">{company.phone && (canCall(company,person) ? <a href={`tel:${company.phone.replace(/[^+\d]/g, '')}`}>Zadzwoń <ArrowUpRight size={14}/></a> : <span className="muted small">Telefon dostępny po zapisaniu przypisania do osoby połączonej z Twoim kontem.</span>)}{company.website && <a href={company.website} target="_blank" rel="noreferrer">Strona WWW <ArrowUpRight size={14}/></a>}</div>
    <AiAnalysis companyId={company.id} launchToken={launchToken}/>
    <AnalysisDetail company={company}/>
    <p className="muted small">Pobrano: {company.syncedAt ? new Date(company.syncedAt).toLocaleString('pl-PL') : '—'}</p>
  </aside>;
}
