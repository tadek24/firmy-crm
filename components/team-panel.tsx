"use client";
import { useEffect, useState, type FormEvent } from 'react';
import type { TeamPerson, TeamUser } from '@/lib/team';
type Directory = { people: TeamPerson[]; users: TeamUser[] };
const emptyPerson = { id: '', name: '', active: true };
const emptyUser = { id: '', login: '', name: '', role: 'member' as 'admin' | 'member', active: true, personId: '', revision: '', password: '' };
export function TeamPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [directory, setDirectory] = useState<Directory>({ people: [], users: [] });
  const [person, setPerson] = useState(emptyPerson), [user, setUser] = useState(emptyUser);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { let alive = true; fetch('/api/team').then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (alive) setDirectory(data); }).catch(error => { if (alive) setError(error.message); }); return () => { alive = false; }; }, []);
  async function save(event: FormEvent, kind: 'person' | 'user') {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...(kind === 'person' ? person : user) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Nie udało się zapisać zespołu.');
      setDirectory(data); kind === 'person' ? setPerson(emptyPerson) : setUser(emptyUser);
      setNotice('Zmiany w zespole zapisane.'); await onChanged();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="team-panel">
    <p className="muted">Tylko administrator zarządza dostępem. Osoba odpowiedzialna może istnieć bez konta; konto można połączyć z jedną osobą, aby przejmować firmy i dzwonić.</p>
    {error && <p className="feedback error" role="alert">{error}</p>}{notice && <p className="feedback" role="status">{notice}</p>}
    <div className="team-admin-grid"><section><h2>Osoby odpowiedzialne</h2><p className="muted small">Wyłączenie osoby zachowuje przypisane firmy i usuwa ją z wyboru przy nowych przypisaniach. Zmiana nazwy aktualizuje przypisania.</p>
      <table><thead><tr><th>Osoba</th><th>Stan</th><th>Ustawienia</th></tr></thead><tbody>{directory.people.map(entry => <tr key={entry.id}><td>{entry.name}</td><td>{entry.active ? 'Aktywna' : 'Wyłączona'}</td><td><button type="button" disabled={busy} aria-label={`Edytuj osobę ${entry.name}`} onClick={() => { setPerson(entry); setError(''); }}>Edytuj</button></td></tr>)}</tbody></table>
      {!directory.people.length && <p className="muted">Dodaj pierwszą osobę odpowiedzialną.</p>}
      <form className="crm-form team-admin-form" onSubmit={event => void save(event, 'person')}><h3>{person.id ? 'Edytuj osobę' : 'Dodaj osobę'}</h3><label>Nazwa osoby<input required maxLength={80} disabled={busy} value={person.name} onChange={event => setPerson({ ...person, name: event.target.value })}/></label><label>Stan osoby<select disabled={busy} value={String(person.active)} onChange={event => setPerson({ ...person, active: event.target.value === 'true' })}><option value="true">Aktywna</option><option value="false">Wyłączona</option></select></label><div className="team-actions"><button className="primary" disabled={busy}>{person.id ? 'Zapisz osobę' : 'Dodaj osobę'}</button>{person.id && <button type="button" disabled={busy} onClick={() => setPerson(emptyPerson)}>Anuluj</button>}</div></form>
    </section><section><h2>Konta użytkowników</h2><p className="muted small">Każda osoba loguje się własnym loginem i hasłem. Blokada konta, zmiana hasła lub roli unieważnia jego sesje.</p>
      <table><thead><tr><th>Użytkownik / login</th><th>Dostęp</th><th>Ustawienia</th></tr></thead><tbody>{directory.users.map(entry => <tr key={entry.id}><td>{entry.name}<span className="subline">{entry.login}{entry.personId ? ` · ${directory.people.find(person => person.id === entry.personId)?.name || 'Osoba wyłączona'}` : ' · bez przypisanej osoby'}</span></td><td>{entry.active ? (entry.role === 'admin' ? 'Administrator' : 'Użytkownik') : 'Zablokowane'}</td><td><button type="button" disabled={busy} aria-label={`Edytuj konto ${entry.login}`} onClick={() => { setUser({ ...entry, password: '' }); setError(''); }}>Edytuj</button></td></tr>)}</tbody></table>
      <form className="crm-form team-admin-form" autoComplete="off" onSubmit={event => void save(event, 'user')}><h3>{user.id ? 'Edytuj konto' : 'Dodaj konto'}</h3><label>Imię i nazwisko<input required disabled={busy} maxLength={80} value={user.name} onChange={event => setUser({ ...user, name: event.target.value })}/></label><label>Login<input required disabled={busy || user.id === 'owner'} minLength={3} maxLength={80} pattern="[a-z0-9][a-z0-9._-]{2,79}" value={user.login} onChange={event => setUser({ ...user, login: event.target.value.toLowerCase() })}/></label><label>Osoba połączona z kontem<select disabled={busy} value={user.personId} onChange={event => setUser({ ...user, personId: event.target.value })}><option value="">Bez przypisanej osoby</option>{directory.people.filter(entry => entry.active || entry.id === user.personId).map(entry => <option key={entry.id} value={entry.id}>{entry.name}{entry.active ? '' : ' (wyłączona — wybierz inną)'}</option>)}</select></label><label>Rola<select disabled={busy || user.id === 'owner'} value={user.role} onChange={event => setUser({ ...user, role: event.target.value as 'admin' | 'member' })}><option value="member">Użytkownik — praca z firmami</option><option value="admin">Administrator — zarządzanie zespołem</option></select></label><label>Stan konta<select disabled={busy || user.id === 'owner'} value={String(user.active)} onChange={event => setUser({ ...user, active: event.target.value === 'true' })}><option value="true">Aktywne</option><option value="false">Zablokowane</option></select></label>
      {user.id === 'owner' ? <p className="muted small">Login admin korzysta z dotychczasowego hasła CRM ustawionego w Vercel.</p> : <label>{user.id ? 'Nowe hasło (puste pole zachowuje dotychczasowe)' : 'Hasło dla nowego konta'}<input type="password" autoComplete="new-password" minLength={12} maxLength={200} required={!user.id} disabled={busy} value={user.password} onChange={event => setUser({ ...user, password: event.target.value })}/></label>}
      <div className="team-actions"><button className="primary" disabled={busy}>{user.id ? 'Zapisz konto' : 'Dodaj konto'}</button>{user.id && <button type="button" disabled={busy} onClick={() => setUser(emptyUser)}>Anuluj</button>}</div></form>
    </section></div>
  </section>;
}
