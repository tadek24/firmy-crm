import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { query, batch, transaction } from './database';
import { setup } from './store';
import { RegistryError } from './registries';
import type { CurrentUser, TeamPerson, TeamUser } from './team';

let ready: Promise<void> | undefined;
export function setupAccounts() {
  if (!ready) ready = initialize().catch(error => { ready = undefined; throw error; });
  return ready;
}
async function initialize() {
  await setup();
  await batch([
    { sql: 'CREATE TABLE IF NOT EXISTS crm_people (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL)' },
    { sql: 'CREATE TABLE IF NOT EXISTS crm_users (id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL, personId TEXT NOT NULL, passwordHash TEXT NOT NULL, revision TEXT NOT NULL)' },
    { sql: "INSERT OR IGNORE INTO crm_users VALUES ('owner','admin','Administrator','admin',1,'','','1')" },
  ]);
  // Preserve only people actually assigned to firms. No example names are seeded.
  await transaction(async () => {
    const existing = (await query('SELECT name FROM crm_people')).rows.map(row => String(row.name).toLocaleLowerCase('pl'));
    const assigned = (await query("SELECT DISTINCT json_extract(crm,'$.assignee') AS name FROM companies WHERE trim(coalesce(json_extract(crm,'$.assignee'),''))!=''")).rows;
    for (const row of assigned) {
      const name = String(row.name).trim(), key = name.toLocaleLowerCase('pl');
      if (!existing.includes(key)) { await query('INSERT INTO crm_people VALUES (?,?,1)', [randomUUID(), name]); existing.push(key); }
    }
  });
}
function user(row: Record<string, string | number | null>): TeamUser {
  return { id: String(row.id), login: String(row.login), name: String(row.name), role: row.role === 'admin' ? 'admin' : 'member', active: Boolean(row.active), personId: String(row.personId || ''), revision: String(row.revision) };
}
export async function teamDirectory() {
  await setupAccounts();
  const rows = (await query('SELECT id,name,active FROM crm_people ORDER BY name')).rows;
  return rows.map(row => ({ id: String(row.id), name: String(row.name), active: Boolean(row.active) })) as TeamPerson[];
}
export async function teamUsers() { await setupAccounts(); return (await query('SELECT id,login,name,role,active,personId,revision FROM crm_users ORDER BY name')).rows.map(user); }
export async function accountById(id: string): Promise<CurrentUser | null> {
  await setupAccounts();
  const row = (await query('SELECT u.*,p.name AS person,p.active AS personActive FROM crm_users u LEFT JOIN crm_people p ON p.id=u.personId WHERE u.id=?', [id])).rows[0];
  return row ? { ...user(row), person: row.personActive ? String(row.person || '') : '' } : null;
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 200) throw new RegistryError('Hasło musi mieć od 12 do 200 znaków.', 400);
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await derive(value, salt)).toString('hex')}`;
}
export async function verifyPassword(value: unknown, encoded: string) {
  if (typeof value !== 'string' || value.length > 200) return false;
  const [kind, salt, digest] = encoded.split(':');
  if (kind !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(digest || '')) return false;
  return timingSafeEqual(await derive(value, salt), Buffer.from(digest, 'hex'));
}
export async function loginAccount(login: string, password: unknown) {
  await setupAccounts();
  const row = (await query('SELECT * FROM crm_users WHERE login=?', [login])).rows[0];
  if (!row || row.id === 'owner') return null;
  const valid = await verifyPassword(password, String(row.passwordHash));
  return valid && row.active ? accountById(String(row.id)) : null;
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f]/.test(value)) throw new RegistryError(`Nieprawidłowe pole: ${label}.`, 400);
  return value.trim();
}
export function requireAdminAccount(actor: CurrentUser) { if (!actor.active || actor.role !== 'admin') throw new RegistryError('Panel zespołu jest dostępny tylko dla administratora.', 403); }
export async function saveTeamPerson(actor: CurrentUser, input: Record<string, unknown>) {
  requireAdminAccount(actor); await setupAccounts();
  const name = text(input.name, 'nazwa osoby');
  if (typeof input.active !== 'boolean') throw new RegistryError('Wybierz aktywność osoby.', 400);
  return transaction(async () => {
    const all = await teamDirectory();
    const old = input.id ? all.find(person => person.id === input.id) : undefined;
    if (input.id && !old) throw new RegistryError('Osoba nie istnieje.', 404);
    if (all.some(person => person.id !== old?.id && person.name.toLocaleLowerCase('pl') === name.toLocaleLowerCase('pl'))) throw new RegistryError('Osoba o tej nazwie już istnieje.', 409);
    const id = old?.id || randomUUID();
    await query('INSERT INTO crm_people VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active', [id, name, Number(input.active)]);
    if (old && old.name !== name) {
      const revision = randomUUID(), now = new Date().toISOString();
      await query("UPDATE companies SET crm=json_set(crm,'$.assignee',?,'$.crmRevision',?,'$.crmUpdatedAt',?,'$.searchTags',lower(coalesce(json_extract(crm,'$.tags'),'') || ' ' || ?)) WHERE json_extract(crm,'$.assignee')=?", [name, revision, now, name, old.name]);
    }
    return { id, name, active: input.active };
  });
}
export async function saveTeamUser(actor: CurrentUser, input: Record<string, unknown>) {
  requireAdminAccount(actor); await setupAccounts();
  const login = text(input.login, 'login').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(login)) throw new RegistryError('Login: 3–80 znaków, litery a–z, cyfry, kropka, myślnik lub podkreślenie.', 400);
  const name = text(input.name, 'imię i nazwisko');
  if (!['admin','member'].includes(String(input.role)) || typeof input.active !== 'boolean' || typeof input.personId !== 'string') throw new RegistryError('Nieprawidłowe ustawienia konta.', 400);
  const personId = input.personId;
  const passwordHash = input.password ? await hashPassword(input.password) : '';
  return transaction(async () => {
    const old = input.id ? (await query('SELECT * FROM crm_users WHERE id=?', [String(input.id)])).rows[0] : undefined;
    if (input.id && !old) throw new RegistryError('Konto nie istnieje.', 404);
    if (old && input.revision !== old.revision) throw new RegistryError('Konto zostało zmienione. Odśwież panel.', 409);
    if ((!old || old.login !== login) && (await query('SELECT 1 FROM crm_users WHERE login=?', [login])).rows.length) throw new RegistryError('Ten login jest zajęty.', 409);
    if (login === 'admin' && old?.id !== 'owner') throw new RegistryError('Login admin jest zarezerwowany.', 400);
    if (old?.id === 'owner' && (login !== 'admin' || input.role !== 'admin' || !input.active || passwordHash)) throw new RegistryError('Główne konto administratora pozostaje aktywne. Jego hasło ustawiasz w Vercel.', 400);
    if (old?.id === actor.id && (!input.active || input.role !== 'admin')) throw new RegistryError('Nie możesz odebrać sobie dostępu do panelu.', 400);
    const person = personId ? (await query('SELECT * FROM crm_people WHERE id=?', [personId])).rows[0] : null;
    if (input.personId && (!person || !person.active)) throw new RegistryError('Wybierz aktywną osobę odpowiedzialną.', 400);
    if (personId && (await query('SELECT 1 FROM crm_users WHERE personId=? AND active=1 AND id!=?', [personId, String(old?.id || '')])).rows.length && input.active) throw new RegistryError('Ta osoba jest już połączona z aktywnym kontem.', 409);
    if (!old && !passwordHash) throw new RegistryError('Ustaw hasło nowego konta.', 400);
    const id = String(old?.id || randomUUID());
    // Profile changes keep sessions; credentials, role and activation revoke them immediately.
    const revoke = old && (passwordHash || old.role !== input.role || Boolean(old.active) !== input.active);
    const revision = revoke || !old ? randomUUID() : String(old.revision);
    await query('INSERT INTO crm_users VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login,name=excluded.name,role=excluded.role,active=excluded.active,personId=excluded.personId,passwordHash=excluded.passwordHash,revision=excluded.revision', [id, login, name, String(input.role), Number(input.active), personId, passwordHash || String(old?.passwordHash || ''), revision]);
    return accountById(id);
  });
}
