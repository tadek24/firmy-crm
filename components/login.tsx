"use client";
import { useState, type FormEvent } from 'react';
export function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: login || 'admin', password }) });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Nie udało się zalogować.'); }
      setPassword(''); window.location.reload();
    } catch (error) { setError((error as Error).message); setBusy(false); }
  }
  return <main className="login"><p className="eyebrow">F / FIRMY CRM</p><h1>Zaloguj się do kartoteki</h1><p className="muted">Twoje firmy, kontakty i notatki są zapisane w chmurze.</p><form onSubmit={submit}><label>Login<input autoComplete="username" maxLength={80} value={login} onChange={event => setLogin(event.target.value)} placeholder="admin lub login nadany przez administratora"/></label><p className="muted small">Administrator: login admin i dotychczasowe hasło CRM.</p><label>Hasło dostępu<input type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={event => setPassword(event.target.value)}/></label>{error && <p className="token-notice" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Logowanie…' : 'Zaloguj się'}</button></form></main>;
}
