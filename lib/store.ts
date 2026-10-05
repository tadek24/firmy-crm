import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Company } from './types';

export const statuses = ['Nowy', 'Do sprawdzenia', 'Do kontaktu', 'Kontakt wykonany', 'Zainteresowany', 'Oferta wysłana', 'Negocjacje', 'Klient', 'Nie zainteresowany', 'Nie kontaktować'] as const;
export type RegistryCompany = Omit<Company, 'status' | 'tags' | 'note' | 'online' | 'lastContact'>;
let database: DatabaseSync;
export function db() {
  if (!database) {
    // Database is created at runtime; never bundle user data into server output.
    const file = path.resolve(/* turbopackIgnore: true */ process.env.CRM_DB_PATH || './data/crm.sqlite');
    mkdirSync(path.dirname(file), { recursive: true });
    database = new DatabaseSync(file);
    database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, source TEXT NOT NULL, registryId TEXT NOT NULL, nip TEXT, regon TEXT, krs TEXT, registry TEXT NOT NULL, crm TEXT NOT NULL, UNIQUE(source, registryId));
      CREATE UNIQUE INDEX IF NOT EXISTS company_nip ON companies(nip) WHERE nip IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS company_regon ON companies(regon) WHERE regon IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS company_krs ON companies(krs) WHERE krs IS NOT NULL;
      CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, source TEXT NOT NULL, count INTEGER NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS api_requests (createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS company_status ON companies(json_extract(crm, '$.status'));
      CREATE INDEX IF NOT EXISTS company_category ON companies(json_extract(registry, '$.category'));
      CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY, total INTEGER NOT NULL, toContact INTEGER NOT NULL, active INTEGER NOT NULL, website INTEGER NOT NULL, email INTEGER NOT NULL, phone INTEGER NOT NULL);
    `);
    if (!database.prepare('SELECT 1 FROM metrics WHERE id=1').get()) {
      database.exec(`INSERT OR IGNORE INTO metrics SELECT 1, count(*), coalesce(sum(json_extract(crm,'$.status')='Do kontaktu'),0), coalesce(sum(json_extract(crm,'$.status') IN ('Zainteresowany','Oferta wysłana','Negocjacje')),0), coalesce(sum(coalesce(json_extract(registry,'$.website'),'')!=''),0), coalesce(sum(coalesce(json_extract(registry,'$.email'),'')!=''),0), coalesce(sum(coalesce(json_extract(registry,'$.phone'),'')!=''),0) FROM companies;`);
    }
    const flags = (prefix: string) => ({
      toContact: `(json_extract(${prefix}.crm,'$.status')='Do kontaktu')`,
      active: `(json_extract(${prefix}.crm,'$.status') IN ('Zainteresowany','Oferta wysłana','Negocjacje'))`,
      website: `(coalesce(json_extract(${prefix}.registry,'$.website'),'')!='')`,
      email: `(coalesce(json_extract(${prefix}.registry,'$.email'),'')!='')`,
      phone: `(coalesce(json_extract(${prefix}.registry,'$.phone'),'')!='')`
    });
    const next = flags('NEW'), old = flags('OLD');
    const keys = Object.keys(next) as (keyof typeof next)[];
    database.exec(`CREATE TRIGGER IF NOT EXISTS metrics_insert AFTER INSERT ON companies BEGIN UPDATE metrics SET total=total+1, ${keys.map(key => `${key}=${key}+${next[key]}`).join(', ')} WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS metrics_update AFTER UPDATE ON companies BEGIN UPDATE metrics SET ${keys.map(key => `${key}=${key}+${next[key]}-${old[key]}`).join(', ')} WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS metrics_delete AFTER DELETE ON companies BEGIN UPDATE metrics SET total=total-1, ${keys.map(key => `${key}=${key}-${old[key]}`).join(', ')} WHERE id=1; END;`);
  }
  return database;
}
type Row = { id: string; registry: string; crm: string };
function unpack(row: Row): Company { return { ...JSON.parse(row.registry), ...JSON.parse(row.crm), id: row.id }; }
export function listCompanies(): Company[] { return (db().prepare('SELECT * FROM companies ORDER BY rowid DESC').all() as Row[]).map(unpack); }
export function companyPage(query = '', status = 'Wszystkie', category = 'Wszystkie', page = 0) {
  const database = db(); const clauses: string[] = []; const parameters: string[] = [];
  if (query.trim()) {
    clauses.push(`(coalesce(json_extract(registry,'$.search'), lower(registry)) || coalesce(json_extract(crm,'$.searchTags'),lower(json_extract(crm,'$.tags')))) LIKE ? ESCAPE '\\'`);
    parameters.push(`%${query.trim().toLocaleLowerCase('pl').replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (status !== 'Wszystkie') { clauses.push(`json_extract(crm,'$.status') = ?`); parameters.push(status); }
  if (category !== 'Wszystkie') { clauses.push(`json_extract(registry,'$.category') = ?`); parameters.push(category); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const total = (database.prepare(`SELECT count(*) AS n FROM companies${where}`).get(...parameters) as { n: number }).n;
  const currentPage = Math.min(Math.max(0, page), Math.max(0, Math.ceil(total / 100) - 1));
  const companies = (database.prepare(`SELECT * FROM companies${where} ORDER BY rowid DESC LIMIT 100 OFFSET ?`).all(...parameters, currentPage * 100) as Row[]).map(unpack);
  const stats = database.prepare('SELECT * FROM metrics WHERE id=1').get();
  const categories = (database.prepare(`SELECT DISTINCT json_extract(registry,'$.category') AS category FROM companies ORDER BY category`).all() as { category: string }[]).map(row => row.category);
  return { companies, total, page: currentPage, pageSize: 100, stats, categories };
}
export function recentImports() { return db().prepare('SELECT * FROM imports ORDER BY id DESC LIMIT 8').all(); }
export class CeidgRateLimitError extends Error {
  constructor(public retryAfter: number) { super('Limit CEIDG: importer poczeka do zwolnienia limitu zapytań.'); }
}
export function reserveCeidgRequest() {
  const database = db();
  database.exec('BEGIN IMMEDIATE');
  try {
    const now = Date.now();
    database.prepare('DELETE FROM api_requests WHERE createdAt < ?').run(now - 3600000);
    const count = database.prepare('SELECT count(*) AS n FROM api_requests').get() as { n: number };
    const last = database.prepare('SELECT max(createdAt) AS t FROM api_requests').get() as { t: number | null };
    if (count.n >= 1000) {
      const first = database.prepare('SELECT min(createdAt) AS t FROM api_requests').get() as { t: number };
      throw new CeidgRateLimitError(Math.max(4, Math.ceil((first.t + 3600001 - now) / 1000)));
    }
    if (last.t && now - last.t < 3600) throw new CeidgRateLimitError(4);
    database.prepare('INSERT INTO api_requests VALUES (?)').run(now);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
export function upsertRegistry(items: RegistryCompany[], source: string, manageTransaction = true, logImport = true): Company[] {
  const database = db();
  if (manageTransaction) database.exec('BEGIN IMMEDIATE');
  try {
    const result = items.map(item => {
      const matches = database.prepare('SELECT * FROM companies WHERE (source = ? AND registryId = ?) OR nip = ? OR regon = ? OR krs = ?').all(item.source, item.registryId, item.nip || null, item.regon || null, item.krs || null) as Row[];
      if (matches.length > 1) throw new Error('Konflikt identyfikatorów: wymagane ręczne sprawdzenie firmy. Import nie został zapisany.');
      const existing = matches[0];
      const old = existing ? unpack(existing) : null;
      const id = existing?.id || randomUUID();
      const registry = { ...item, id, nip: item.nip || old?.nip || '', regon: item.regon || old?.regon, krs: item.krs || old?.krs, search: [item.name, item.nip, item.regon, item.krs, item.city, item.pkdMain].join(' ').toLocaleLowerCase('pl') };
      const crm = existing ? JSON.parse(existing.crm) : { status: 'Nowy', tags: [], online: [], note: '' };
      database.prepare(`INSERT INTO companies VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source=excluded.source, registryId=excluded.registryId, nip=excluded.nip, regon=excluded.regon, krs=excluded.krs, registry=excluded.registry`).run(id, registry.source, registry.registryId, registry.nip || null, registry.regon || null, registry.krs || null, JSON.stringify(registry), JSON.stringify(crm));
      return { ...registry, ...crm } as Company;
    });
    if (logImport) database.prepare('INSERT INTO imports(source,count,createdAt) VALUES (?,?,?)').run(source, items.length, new Date().toISOString());
    if (manageTransaction) database.exec('COMMIT');
    return result;
  } catch (error) { if (manageTransaction) database.exec('ROLLBACK'); throw error; }
}
export function updateCrm(id: string, patch: unknown): Company {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Nieprawidłowe dane CRM.');
  const data = patch as Record<string, unknown>;
  const allowed = ['status', 'tags', 'note'];
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new Error('Możesz zmieniać tylko status, etykiety i notatkę.');
  if ('status' in data && !statuses.includes(data.status as typeof statuses[number])) throw new Error('Nieprawidłowy status.');
  if ('note' in data && (typeof data.note !== 'string' || data.note.length > 20000)) throw new Error('Nieprawidłowa notatka.');
  if ('tags' in data && (!Array.isArray(data.tags) || data.tags.length > 30 || data.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80))) throw new Error('Nieprawidłowe etykiety.');
  const row = db().prepare('SELECT * FROM companies WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('Firma nie istnieje.');
  const crm = { ...JSON.parse(row.crm), ...data };
  if (crm.tags) crm.tags = [...new Set(crm.tags.map((tag: string) => tag.trim()))];
  crm.searchTags = crm.tags.join(' ').toLocaleLowerCase('pl');
  db().prepare('UPDATE companies SET crm = ? WHERE id = ?').run(JSON.stringify(crm), id);
  return unpack({ ...row, crm: JSON.stringify(crm) });
}
