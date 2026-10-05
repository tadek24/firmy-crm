import { randomUUID } from 'node:crypto';
import { batch, query, transaction, type Statement } from './database';
import type { Company } from './types';
import { analyzeCompany, ANALYSIS_VERSION } from './analysis';
export const statuses = ['Nowy', 'Do sprawdzenia', 'Do kontaktu', 'Kontakt wykonany', 'Zainteresowany', 'Oferta wysłana', 'Negocjacje', 'Klient', 'Nie zainteresowany', 'Nie kontaktować'] as const;
export type RegistryCompany = Omit<Company, 'status' | 'tags' | 'note' | 'online' | 'lastContact'>;
let ready: Promise<void> | undefined;
export function setup() {
  if (!ready) ready = initialize().catch(error => { ready = undefined; throw error; });
  return ready;
}
async function initialize() {
  const schema = [
    'CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, source TEXT NOT NULL, registryId TEXT NOT NULL, nip TEXT, regon TEXT, krs TEXT, registry TEXT NOT NULL, crm TEXT NOT NULL, UNIQUE(source,registryId))',
    'CREATE UNIQUE INDEX IF NOT EXISTS company_nip ON companies(nip) WHERE nip IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS company_regon ON companies(regon) WHERE regon IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS company_krs ON companies(krs) WHERE krs IS NOT NULL',
    'CREATE TABLE IF NOT EXISTS imports (id INTEGER PRIMARY KEY, source TEXT NOT NULL, count INTEGER NOT NULL, createdAt TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS api_requests (createdAt INTEGER NOT NULL)',
    'CREATE INDEX IF NOT EXISTS api_request_time ON api_requests(createdAt)',
    "CREATE INDEX IF NOT EXISTS company_status ON companies(json_extract(crm,'$.status'))",
    "CREATE INDEX IF NOT EXISTS company_category ON companies(json_extract(registry,'$.category'))",
    'CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY, total INTEGER NOT NULL, toContact INTEGER NOT NULL, active INTEGER NOT NULL, website INTEGER NOT NULL, email INTEGER NOT NULL, phone INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS bulk_jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expiresAt INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS bulk_seen (jobId TEXT NOT NULL, registryId TEXT NOT NULL, PRIMARY KEY(jobId,registryId))',
    'CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expiresAt INTEGER NOT NULL)',
  ];
  const flags = (prefix: string) => ({ toContact: `(json_extract(${prefix}.crm,'$.status')='Do kontaktu')`, active: `(json_extract(${prefix}.crm,'$.status') IN ('Zainteresowany','Oferta wysłana','Negocjacje'))`, website: `(coalesce(json_extract(${prefix}.registry,'$.website'),'')!='')`, email: `(coalesce(json_extract(${prefix}.registry,'$.email'),'')!='')`, phone: `(coalesce(json_extract(${prefix}.registry,'$.phone'),'')!='')` });
  const next = flags('NEW'), old = flags('OLD'); const keys = Object.keys(next) as (keyof typeof next)[];
  schema.push(`CREATE TRIGGER IF NOT EXISTS metrics_insert AFTER INSERT ON companies BEGIN UPDATE metrics SET total=total+1, ${keys.map(key => `${key}=${key}+${next[key]}`).join(',')} WHERE id=1; END`,
    `CREATE TRIGGER IF NOT EXISTS metrics_update AFTER UPDATE ON companies BEGIN UPDATE metrics SET ${keys.map(key => `${key}=${key}+${next[key]}-${old[key]}`).join(',')} WHERE id=1; END`,
    `CREATE TRIGGER IF NOT EXISTS metrics_delete AFTER DELETE ON companies BEGIN UPDATE metrics SET total=total-1, ${keys.map(key => `${key}=${key}-${old[key]}`).join(',')} WHERE id=1; END`);
  await batch(schema.map(sql => ({ sql })));
  if (!(await query('SELECT 1 FROM metrics WHERE id=1')).rows.length) await query(`INSERT OR IGNORE INTO metrics SELECT 1,count(*),coalesce(sum(json_extract(crm,'$.status')='Do kontaktu'),0),coalesce(sum(json_extract(crm,'$.status') IN ('Zainteresowany','Oferta wysłana','Negocjacje')),0),coalesce(sum(coalesce(json_extract(registry,'$.website'),'')!=''),0),coalesce(sum(coalesce(json_extract(registry,'$.email'),'')!=''),0),coalesce(sum(coalesce(json_extract(registry,'$.phone'),'')!=''),0) FROM companies`);
}
type Row = { id: string; registry: string; crm: string };
function unpack(row: Row): Company {
  const company: Company = { ...JSON.parse(row.registry), ...JSON.parse(row.crm), id: row.id };
  if (company.analysis?.version !== ANALYSIS_VERSION) company.analysis = analyzeCompany(company);
  return company;
}
export async function listCompanies() { await setup(); return ((await query('SELECT * FROM companies ORDER BY rowid DESC')).rows as Row[]).map(unpack); }
export async function companyPage(search = '', status = 'Wszystkie', category = 'Wszystkie', page = 0) {
  await setup(); const clauses: string[] = [], parameters: string[] = [];
  if (search.trim()) {
    clauses.push("(coalesce(json_extract(registry,'$.search'),lower(registry)) || coalesce(json_extract(crm,'$.searchTags'),lower(json_extract(crm,'$.tags')))) LIKE ? ESCAPE '\\'");
    parameters.push(`%${search.trim().toLocaleLowerCase('pl').replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (status !== 'Wszystkie') { clauses.push("json_extract(crm,'$.status')=?"); parameters.push(status); }
  if (category !== 'Wszystkie') { clauses.push("json_extract(registry,'$.category')=?"); parameters.push(category); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const summary = await batch([{ sql: 'SELECT * FROM metrics WHERE id=1' }, { sql: "SELECT DISTINCT json_extract(registry,'$.category') AS category FROM companies ORDER BY category" }, ...(where ? [{ sql: `SELECT count(*) AS n FROM companies${where}`, args: parameters }] : [])]);
  const stats = summary[0].rows[0]; const total = Number(where ? summary[2].rows[0].n : stats.total);
  const currentPage = Math.min(Math.max(0, page), Math.max(0, Math.ceil(total / 100) - 1));
  const companies = ((await query(`SELECT * FROM companies${where} ORDER BY rowid DESC LIMIT 100 OFFSET ?`, [...parameters, currentPage * 100])).rows as Row[]).map(unpack);
  return { companies, total, page: currentPage, pageSize: 100, stats, categories: summary[1].rows.map(row => row.category) };
}
export async function recentImports() { await setup(); return (await query('SELECT * FROM imports ORDER BY id DESC LIMIT 8')).rows; }
export class CeidgRateLimitError extends Error {
  constructor(public retryAfter: number) { super('Limit CEIDG: importer poczeka do zwolnienia limitu zapytań.'); }
}
export async function reserveCeidgRequest() {
  await setup(); await transaction(async () => {
    const now = Date.now();
    const results = await batch([{ sql: 'DELETE FROM api_requests WHERE createdAt < ?', args: [now - 3600000] }, { sql: 'SELECT count(*) AS n,min(createdAt) AS first,max(createdAt) AS last FROM api_requests' }]);
    const count = results[1].rows[0];
    if (Number(count.n) >= 1000) throw new CeidgRateLimitError(Math.max(4, Math.ceil((Number(count.first) + 3600001 - now) / 1000)));
    if (count.last && now - Number(count.last) < 3600) throw new CeidgRateLimitError(4);
    await query('INSERT INTO api_requests VALUES (?)', [now]);
  });
}
export async function upsertRegistry(items: RegistryCompany[], source: string, manageTransaction = true, logImport = true): Promise<Company[]> {
  await setup();
  const write = async () => {
    const matches = await batch(items.map(item => ({ sql: 'SELECT * FROM companies WHERE (source=? AND registryId=?) OR nip=? OR regon=? OR krs=?', args: [item.source, item.registryId, item.nip || null, item.regon || null, item.krs || null] })));
    const writes: Statement[] = []; const result: Company[] = [];
    items.forEach((item, index) => {
      const found = matches[index].rows as Row[];
      if (found.length > 1) throw new Error('Konflikt identyfikatorów: wymagane ręczne sprawdzenie firmy. Import nie został zapisany.');
      const existing = found[0], old = existing ? unpack(existing) : null, id = existing?.id || randomUUID();
      const registry = { ...item, id, nip: item.nip || old?.nip || '', regon: item.regon || old?.regon, krs: item.krs || old?.krs, search: [item.name, item.nip, item.regon, item.krs, item.city, item.pkdMain].join(' ').toLocaleLowerCase('pl') };
      const crm = existing ? JSON.parse(existing.crm) : { status: 'Nowy', tags: [], online: [], note: '' };
      registry.analysis = analyzeCompany(registry);
      writes.push({ sql: 'INSERT INTO companies VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,registryId=excluded.registryId,nip=excluded.nip,regon=excluded.regon,krs=excluded.krs,registry=excluded.registry', args: [id, registry.source, registry.registryId, registry.nip || null, registry.regon || null, registry.krs || null, JSON.stringify(registry), JSON.stringify(crm)] });
      result.push({ ...registry, ...crm });
    });
    if (logImport) writes.push({ sql: 'INSERT INTO imports(source,count,createdAt) VALUES (?,?,?)', args: [source, items.length, new Date().toISOString()] });
    if (writes.length) await batch(writes);
    return result;
  };
  return manageTransaction ? transaction(write) : write();
}
export async function updateCrm(id: string, patch: unknown): Promise<Company> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Nieprawidłowe dane CRM.');
  const data = patch as Record<string, unknown>;
  if (Object.keys(data).some(key => !['status','tags','note'].includes(key))) throw new Error('Możesz zmieniać tylko status, etykiety i notatkę.');
  if ('status' in data && !statuses.includes(data.status as typeof statuses[number])) throw new Error('Nieprawidłowy status.');
  if ('note' in data && (typeof data.note !== 'string' || data.note.length > 20000)) throw new Error('Nieprawidłowa notatka.');
  if ('tags' in data && (!Array.isArray(data.tags) || data.tags.length > 30 || data.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80))) throw new Error('Nieprawidłowe etykiety.');
  await setup();
  return transaction(async () => {
    const row = (await query('SELECT * FROM companies WHERE id=?', [id])).rows[0] as Row | undefined;
    if (!row) throw new Error('Firma nie istnieje.');
    const crm = { ...JSON.parse(row.crm), ...data };
    crm.tags = [...new Set(crm.tags.map((tag: string) => tag.trim()))]; crm.searchTags = crm.tags.join(' ').toLocaleLowerCase('pl');
    await query('UPDATE companies SET crm=? WHERE id=?', [JSON.stringify(crm), id]);
    return unpack({ ...row, crm: JSON.stringify(crm) });
  });
}
