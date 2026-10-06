import { randomUUID } from 'node:crypto';
import { batch, query, transaction, type Statement } from './database';
import type { Company } from './types';
import type { CurrentUser } from './team';
import { RegistryError } from './registries';
import { analyzeCompany, ANALYSIS_VERSION } from './analysis';
import { parseContactFilter } from './contact-filters';
import { qualifiesForProspecting } from './prospecting';
const contactPresent = (field: 'email' | 'phone' | 'website') => `(trim(coalesce(json_extract(registry,'$.${field}'),''))!='')`;
export const statuses = ['Nowy', 'Do sprawdzenia', 'Do kontaktu', 'Kontakt wykonany', 'Zainteresowany', 'Oferta wysłana', 'Negocjacje', 'Klient', 'Nie zainteresowany', 'Nie kontaktować'] as const;
export type RegistryCompany = Omit<Company, 'status' | 'tags' | 'note' | 'online' | 'lastContact' | 'assignee' | 'crmRevision' | 'crmUpdatedAt' | 'aiState'>;
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
    "CREATE INDEX IF NOT EXISTS company_assignee ON companies(json_extract(crm,'$.assignee'))",
    "CREATE INDEX IF NOT EXISTS company_started_at ON companies(json_extract(registry,'$.startedAt'))",
    ...(['email', 'phone', 'website'] as const).map(field => `CREATE INDEX IF NOT EXISTS company_contact_${field} ON companies(${contactPresent(field)})`),
    'CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY, total INTEGER NOT NULL, toContact INTEGER NOT NULL, active INTEGER NOT NULL, website INTEGER NOT NULL, email INTEGER NOT NULL, phone INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS bulk_jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expiresAt INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS bulk_seen (jobId TEXT NOT NULL, registryId TEXT NOT NULL, PRIMARY KEY(jobId,registryId))',
    'CREATE TABLE IF NOT EXISTS prospect_members (jobId TEXT NOT NULL, companyId TEXT NOT NULL, PRIMARY KEY(jobId,companyId))',
    'CREATE TABLE IF NOT EXISTS ai_jobs (companyId TEXT PRIMARY KEY, taskId TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS ai_requests (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS ai_requests_date ON ai_requests(createdAt)',
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
  company.assignee ||= '';
  company.crmRevision ||= '0';
  if (company.analysis?.version !== ANALYSIS_VERSION) company.analysis = analyzeCompany(company);
  return company;
}
export async function listCompanies() { await setup(); return ((await query('SELECT * FROM companies ORDER BY rowid DESC')).rows as Row[]).map(unpack); }
export async function getCompany(id: string) { await setup(); const row = (await query('SELECT * FROM companies WHERE id=?',[id])).rows[0] as Row | undefined; return row ? unpack(row) : null; }
export async function companyPage(search = '', status = 'Wszystkie', category = 'Wszystkie', page = 0, contact = 'all', scope = 'all', owner = '', tag = '', sort = 'fit') {
  await setup(); const clauses: string[] = [], parameters: string[] = [];
  if (search.trim()) {
    clauses.push("(coalesce(json_extract(registry,'$.search'),lower(registry)) || coalesce(json_extract(crm,'$.searchTags'),lower(json_extract(crm,'$.tags')))) LIKE ? ESCAPE '\\'");
    parameters.push(`%${search.trim().toLocaleLowerCase('pl').replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (status !== 'Wszystkie') { clauses.push("json_extract(crm,'$.status')=?"); parameters.push(status); }
  if (category !== 'Wszystkie') { clauses.push("json_extract(registry,'$.category')=?"); parameters.push(category); }
  if (owner === 'unassigned') clauses.push("trim(coalesce(json_extract(crm,'$.assignee'),''))=''");
  else if (owner.startsWith('person:')) { clauses.push("json_extract(crm,'$.assignee')=?"); parameters.push(owner.slice(7)); }
  if (tag) { clauses.push("EXISTS(SELECT 1 FROM json_each(companies.crm,'$.tags') WHERE value=?)"); parameters.push(tag); }
  const contactFilter = parseContactFilter(contact);
  if (['email', 'phone', 'website'].includes(contactFilter)) clauses.push(`${contactPresent(contactFilter as 'email' | 'phone' | 'website')}=1`);
  if (contactFilter === 'direct') clauses.push(`(${contactPresent('email')}=1 OR ${contactPresent('phone')}=1)`);
  if (contactFilter === 'any') clauses.push(`(${contactPresent('email')}=1 OR ${contactPresent('phone')}=1 OR ${contactPresent('website')}=1)`);
  if (contactFilter === 'none') clauses.push(`(${contactPresent('email')}=0 AND ${contactPresent('phone')}=0 AND ${contactPresent('website')}=0)`);
  if (scope === 'prospects') {
    clauses.push("EXISTS(SELECT 1 FROM prospect_members WHERE companyId=companies.id AND jobId=(SELECT id FROM bulk_jobs ORDER BY rowid DESC LIMIT 1))");
    clauses.push("json_extract(crm,'$.status') NOT IN ('Nie kontaktować','Nie zainteresowany','Klient')");
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const summary = await batch([{ sql: 'SELECT * FROM metrics WHERE id=1' }, { sql: "SELECT DISTINCT json_extract(registry,'$.category') AS category FROM companies ORDER BY category" }, ...(where ? [{ sql: `SELECT count(*) AS n FROM companies${where}`, args: parameters }] : [])]);
  const stats = summary[0].rows[0]; const total = Number(where ? summary[2].rows[0].n : stats.total);
  const currentPage = Math.min(Math.max(0, page), Math.max(0, Math.ceil(total / 100) - 1));
  const order = sort === 'startedAsc'
    ? "CASE WHEN json_extract(registry,'$.startedAt') IS NULL OR json_extract(registry,'$.startedAt')='' THEN 1 ELSE 0 END,json_extract(registry,'$.startedAt') ASC,rowid DESC"
    : sort === 'startedDesc'
      ? "CASE WHEN json_extract(registry,'$.startedAt') IS NULL OR json_extract(registry,'$.startedAt')='' THEN 1 ELSE 0 END,json_extract(registry,'$.startedAt') DESC,rowid DESC"
      : scope === 'prospects' ? "coalesce(json_extract(registry,'$.analysis.fitScore'),0) DESC,rowid DESC" : 'rowid DESC';
  const companies = ((await query(`SELECT *, (SELECT state FROM ai_jobs WHERE companyId=companies.id) AS aiState FROM companies${where} ORDER BY ${order} LIMIT 100 OFFSET ?`, [...parameters, currentPage * 100])).rows as (Row & {aiState: Company['aiState']})[]).map(row => ({...unpack(row),aiState:row.aiState || undefined}));
  const labels = await batch([
    { sql: "SELECT DISTINCT json_extract(crm,'$.assignee') AS name FROM companies WHERE trim(coalesce(json_extract(crm,'$.assignee'),''))!='' ORDER BY name" },
    { sql: "SELECT DISTINCT value AS name FROM companies,json_each(companies.crm,'$.tags') ORDER BY name" },
  ]);
  return { companies, total, page: currentPage, pageSize: 100, stats, categories: summary[1].rows.map(row => row.category), assignees: labels[0].rows.map(row => String(row.name)), tags: labels[1].rows.map(row => String(row.name)) };
}
export async function addProspects(jobId: string, companies: Company[], remaining: number) {
  const eligible = companies.filter(qualifiesForProspecting);
  if (!eligible.length || remaining <= 0) return 0;
  const current = (await query(`SELECT companyId FROM prospect_members WHERE jobId=? AND companyId IN (${eligible.map(() => '?').join(',')})`, [jobId, ...eligible.map(company => company.id)])).rows.map(row => row.companyId);
  const next = eligible.filter(company => !current.includes(company.id)).slice(0, remaining);
  const writes = next.flatMap(company => [
    { sql: "UPDATE companies SET registry=json_set(registry,'$.analysis',json(?)) WHERE id=?", args: [JSON.stringify(analyzeCompany(company)), company.id] },
    { sql: 'INSERT OR IGNORE INTO prospect_members VALUES (?,?)', args: [jobId, company.id] },
  ]);
  let added = 0;
  for (let offset = 0; offset < writes.length; offset += 100) {
    const results = await batch(writes.slice(offset, offset + 100));
    added += results.reduce((sum, result, index) => sum + (index % 2 ? result.changes : 0), 0);
  }
  return added;
}
export async function seedProspects(jobId: string, target: number, maxChecks: number) {
  const rows = (await query(`SELECT * FROM companies WHERE source='CEIDG' AND json_extract(registry,'$.registryStatus')='AKTYWNY' AND (${contactPresent('email')}=1 OR ${contactPresent('phone')}=1) ORDER BY rowid DESC LIMIT ?`, [maxChecks])).rows as Row[];
  const candidates = rows.map(unpack).filter(qualifiesForProspecting).sort((a,b) => (b.analysis?.fitScore || 0) - (a.analysis?.fitScore || 0));
  return addProspects(jobId, candidates.slice(0, target), target);
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
      const registry = { ...item, id, nip: item.nip || old?.nip || '', regon: item.regon || old?.regon, krs: item.krs || old?.krs, startedAt: item.startedAt || old?.startedAt, search: [item.name, item.nip, item.regon, item.krs, item.city, item.pkdMain].join(' ').toLocaleLowerCase('pl') };
      const crm = existing ? JSON.parse(existing.crm) : { status: 'Nowy', tags: [], online: [], note: '', assignee: '', crmRevision: '0' };
      registry.analysis = analyzeCompany(registry);
      writes.push({ sql: 'INSERT INTO companies VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,registryId=excluded.registryId,nip=excluded.nip,regon=excluded.regon,krs=excluded.krs,registry=excluded.registry', args: [id, registry.source, registry.registryId, registry.nip || null, registry.regon || null, registry.krs || null, JSON.stringify(registry), JSON.stringify(crm)] });
      result.push({ ...registry, ...crm, assignee: crm.assignee || '', crmRevision: crm.crmRevision || '0' });
    });
    if (logImport) writes.push({ sql: 'INSERT INTO imports(source,count,createdAt) VALUES (?,?,?)', args: [source, items.length, new Date().toISOString()] });
    if (writes.length) await batch(writes);
    return result;
  };
  return manageTransaction ? transaction(write) : write();
}
export class CrmConflictError extends Error {}
export async function updateCrm(id: string, patch: unknown, actor?: CurrentUser): Promise<Company> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Nieprawidłowe dane CRM.');
  const data = patch as Record<string, unknown>;
  if (Object.keys(data).some(key => !['status','tags','note','assignee','crmRevision'].includes(key))) throw new Error('Możesz zmieniać tylko status, osobę odpowiedzialną, etykiety i notatkę.');
  if (typeof data.crmRevision !== 'string' || data.crmRevision.length > 80) throw new CrmConflictError('Odśwież aplikację przed zapisaniem zmian.');
  if ('assignee' in data && (typeof data.assignee !== 'string' || data.assignee.length > 80 || /[\u0000-\u001f]/.test(data.assignee))) throw new Error('Nieprawidłowa osoba odpowiedzialna.');
  if ('status' in data && !statuses.includes(data.status as typeof statuses[number])) throw new Error('Nieprawidłowy status.');
  if ('note' in data && (typeof data.note !== 'string' || data.note.length > 20000)) throw new Error('Nieprawidłowa notatka.');
  if ('tags' in data && (!Array.isArray(data.tags) || data.tags.length > 30 || data.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80))) throw new Error('Nieprawidłowe etykiety.');
  await setup();
  return transaction(async () => {
    const row = (await query('SELECT * FROM companies WHERE id=?', [id])).rows[0] as Row | undefined;
    if (!row) throw new Error('Firma nie istnieje.');
    const previous = JSON.parse(row.crm);
    if (actor) {
      const nextOwner = 'assignee' in data ? String(data.assignee).trim() : String(previous.assignee || '');
      if (nextOwner !== String(previous.assignee || '') && nextOwner && !(await query('SELECT 1 FROM crm_people WHERE name=? AND active=1', [nextOwner])).rows.length) throw new RegistryError('Wybierz aktywną osobę z listy zespołu.', 400);
      if (actor.role !== 'admin') {
        if (previous.assignee && previous.assignee !== actor.person) throw new RegistryError('Tę firmę prowadzi inna osoba. Administrator może przekazać kontakt.', 403);
        if (nextOwner && nextOwner !== actor.person) throw new RegistryError('Możesz przypisać firmę do siebie. Przekazanie kontaktu wykonuje administrator.', 403);
        if ('status' in data && data.status !== previous.status && !nextOwner) throw new RegistryError('Przed zmianą statusu przypisz firmę do siebie.', 403);
      }
    }
    if (data.crmRevision !== (previous.crmRevision || '0')) throw new CrmConflictError('Ktoś zmienił tę firmę. Wczytaj aktualne dane przed ponownym zapisem; Twój szkic nie został zapisany.');
    const crm = { ...previous, ...data, crmRevision: randomUUID(), crmUpdatedAt: new Date().toISOString() };
    if (data.status === 'Kontakt wykonany' && previous.status !== 'Kontakt wykonany') crm.lastContact = crm.crmUpdatedAt;
    crm.assignee = (crm.assignee || '').trim();
    crm.tags = [...new Map<string, string>(crm.tags.map((tag: string) => [tag.trim().toLocaleLowerCase('pl'), tag.trim()])).values()];
    crm.searchTags = [...crm.tags, crm.assignee].join(' ').toLocaleLowerCase('pl');
    await query('UPDATE companies SET crm=? WHERE id=?', [JSON.stringify(crm), id]);
    return unpack({ ...row, crm: JSON.stringify(crm) });
  });
}
import { randomUUID } from 'node:crypto';
import { batch, query, transaction, type Statement } from './database';
import type { Company } from './types';
import type { CurrentUser } from './team';
import { RegistryError } from './registries';
import { analyzeCompany, ANALYSIS_VERSION } from './analysis';
import { parseContactFilter } from './contact-filters';
import { qualifiesForProspecting } from './prospecting';
const contactPresent = (field: 'email' | 'phone' | 'website') => `(trim(coalesce(json_extract(registry,'$.${field}'),''))!='')`;
export const statuses = ['Nowy', 'Do sprawdzenia', 'Do kontaktu', 'Kontakt wykonany', 'Zainteresowany', 'Oferta wysłana', 'Negocjacje', 'Klient', 'Nie zainteresowany', 'Nie kontaktować'] as const;
export type RegistryCompany = Omit<Company, 'status' | 'tags' | 'note' | 'online' | 'lastContact' | 'assignee' | 'crmRevision' | 'crmUpdatedAt' | 'aiState'>;
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
    "CREATE INDEX IF NOT EXISTS company_assignee ON companies(json_extract(crm,'$.assignee'))",
    ...(['email', 'phone', 'website'] as const).map(field => `CREATE INDEX IF NOT EXISTS company_contact_${field} ON companies(${contactPresent(field)})`),
    'CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY, total INTEGER NOT NULL, toContact INTEGER NOT NULL, active INTEGER NOT NULL, website INTEGER NOT NULL, email INTEGER NOT NULL, phone INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS bulk_jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expiresAt INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS bulk_seen (jobId TEXT NOT NULL, registryId TEXT NOT NULL, PRIMARY KEY(jobId,registryId))',
    'CREATE TABLE IF NOT EXISTS prospect_members (jobId TEXT NOT NULL, companyId TEXT NOT NULL, PRIMARY KEY(jobId,companyId))',
    'CREATE TABLE IF NOT EXISTS ai_jobs (companyId TEXT PRIMARY KEY, taskId TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS ai_requests (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS ai_requests_date ON ai_requests(createdAt)',
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
  company.assignee ||= '';
  company.crmRevision ||= '0';
  if (company.analysis?.version !== ANALYSIS_VERSION) company.analysis = analyzeCompany(company);
  return company;
}
export async function listCompanies() { await setup(); return ((await query('SELECT * FROM companies ORDER BY rowid DESC')).rows as Row[]).map(unpack); }
export async function getCompany(id: string) { await setup(); const row = (await query('SELECT * FROM companies WHERE id=?',[id])).rows[0] as Row | undefined; return row ? unpack(row) : null; }
export async function companyPage(search = '', status = 'Wszystkie', category = 'Wszystkie', page = 0, contact = 'all', scope = 'all', owner = '', tag = '') {
  await setup(); const clauses: string[] = [], parameters: string[] = [];
  if (search.trim()) {
    clauses.push("(coalesce(json_extract(registry,'$.search'),lower(registry)) || coalesce(json_extract(crm,'$.searchTags'),lower(json_extract(crm,'$.tags')))) LIKE ? ESCAPE '\\'");
    parameters.push(`%${search.trim().toLocaleLowerCase('pl').replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (status !== 'Wszystkie') { clauses.push("json_extract(crm,'$.status')=?"); parameters.push(status); }
  if (category !== 'Wszystkie') { clauses.push("json_extract(registry,'$.category')=?"); parameters.push(category); }
  if (owner === 'unassigned') clauses.push("trim(coalesce(json_extract(crm,'$.assignee'),''))=''");
  else if (owner.startsWith('person:')) { clauses.push("json_extract(crm,'$.assignee')=?"); parameters.push(owner.slice(7)); }
  if (tag) { clauses.push("EXISTS(SELECT 1 FROM json_each(companies.crm,'$.tags') WHERE value=?)"); parameters.push(tag); }
  const contactFilter = parseContactFilter(contact);
  if (['email', 'phone', 'website'].includes(contactFilter)) clauses.push(`${contactPresent(contactFilter as 'email' | 'phone' | 'website')}=1`);
  if (contactFilter === 'direct') clauses.push(`(${contactPresent('email')}=1 OR ${contactPresent('phone')}=1)`);
  if (contactFilter === 'any') clauses.push(`(${contactPresent('email')}=1 OR ${contactPresent('phone')}=1 OR ${contactPresent('website')}=1)`);
  if (contactFilter === 'none') clauses.push(`(${contactPresent('email')}=0 AND ${contactPresent('phone')}=0 AND ${contactPresent('website')}=0)`);
  if (scope === 'prospects') {
    clauses.push("EXISTS(SELECT 1 FROM prospect_members WHERE companyId=companies.id AND jobId=(SELECT id FROM bulk_jobs ORDER BY rowid DESC LIMIT 1))");
    clauses.push("json_extract(crm,'$.status') NOT IN ('Nie kontaktować','Nie zainteresowany','Klient')");
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const summary = await batch([{ sql: 'SELECT * FROM metrics WHERE id=1' }, { sql: "SELECT DISTINCT json_extract(registry,'$.category') AS category FROM companies ORDER BY category" }, ...(where ? [{ sql: `SELECT count(*) AS n FROM companies${where}`, args: parameters }] : [])]);
  const stats = summary[0].rows[0]; const total = Number(where ? summary[2].rows[0].n : stats.total);
  const currentPage = Math.min(Math.max(0, page), Math.max(0, Math.ceil(total / 100) - 1));
  const order = scope === 'prospects' ? "coalesce(json_extract(registry,'$.analysis.fitScore'),0) DESC,rowid DESC" : 'rowid DESC';
  const companies = ((await query(`SELECT *, (SELECT state FROM ai_jobs WHERE companyId=companies.id) AS aiState FROM companies${where} ORDER BY ${order} LIMIT 100 OFFSET ?`, [...parameters, currentPage * 100])).rows as (Row & {aiState: Company['aiState']})[]).map(row => ({...unpack(row),aiState:row.aiState || undefined}));
  const labels = await batch([
    { sql: "SELECT DISTINCT json_extract(crm,'$.assignee') AS name FROM companies WHERE trim(coalesce(json_extract(crm,'$.assignee'),''))!='' ORDER BY name" },
    { sql: "SELECT DISTINCT value AS name FROM companies,json_each(companies.crm,'$.tags') ORDER BY name" },
  ]);
  return { companies, total, page: currentPage, pageSize: 100, stats, categories: summary[1].rows.map(row => row.category), assignees: labels[0].rows.map(row => String(row.name)), tags: labels[1].rows.map(row => String(row.name)) };
}
export async function addProspects(jobId: string, companies: Company[], remaining: number) {
  const eligible = companies.filter(qualifiesForProspecting);
  if (!eligible.length || remaining <= 0) return 0;
  const current = (await query(`SELECT companyId FROM prospect_members WHERE jobId=? AND companyId IN (${eligible.map(() => '?').join(',')})`, [jobId, ...eligible.map(company => company.id)])).rows.map(row => row.companyId);
  const next = eligible.filter(company => !current.includes(company.id)).slice(0, remaining);
  const writes = next.flatMap(company => [
    { sql: "UPDATE companies SET registry=json_set(registry,'$.analysis',json(?)) WHERE id=?", args: [JSON.stringify(analyzeCompany(company)), company.id] },
    { sql: 'INSERT OR IGNORE INTO prospect_members VALUES (?,?)', args: [jobId, company.id] },
  ]);
  let added = 0;
  for (let offset = 0; offset < writes.length; offset += 100) {
    const results = await batch(writes.slice(offset, offset + 100));
    added += results.reduce((sum, result, index) => sum + (index % 2 ? result.changes : 0), 0);
  }
  return added;
}
export async function seedProspects(jobId: string, target: number, maxChecks: number) {
  const rows = (await query(`SELECT * FROM companies WHERE source='CEIDG' AND json_extract(registry,'$.registryStatus')='AKTYWNY' AND (${contactPresent('email')}=1 OR ${contactPresent('phone')}=1) ORDER BY rowid DESC LIMIT ?`, [maxChecks])).rows as Row[];
  const candidates = rows.map(unpack).filter(qualifiesForProspecting).sort((a,b) => (b.analysis?.fitScore || 0) - (a.analysis?.fitScore || 0));
  return addProspects(jobId, candidates.slice(0, target), target);
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
      const crm = existing ? JSON.parse(existing.crm) : { status: 'Nowy', tags: [], online: [], note: '', assignee: '', crmRevision: '0' };
      registry.analysis = analyzeCompany(registry);
      writes.push({ sql: 'INSERT INTO companies VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source=excluded.source,registryId=excluded.registryId,nip=excluded.nip,regon=excluded.regon,krs=excluded.krs,registry=excluded.registry', args: [id, registry.source, registry.registryId, registry.nip || null, registry.regon || null, registry.krs || null, JSON.stringify(registry), JSON.stringify(crm)] });
      result.push({ ...registry, ...crm, assignee: crm.assignee || '', crmRevision: crm.crmRevision || '0' });
    });
    if (logImport) writes.push({ sql: 'INSERT INTO imports(source,count,createdAt) VALUES (?,?,?)', args: [source, items.length, new Date().toISOString()] });
    if (writes.length) await batch(writes);
    return result;
  };
  return manageTransaction ? transaction(write) : write();
}
export class CrmConflictError extends Error {}
export async function updateCrm(id: string, patch: unknown, actor?: CurrentUser): Promise<Company> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Nieprawidłowe dane CRM.');
  const data = patch as Record<string, unknown>;
  if (Object.keys(data).some(key => !['status','tags','note','assignee','crmRevision'].includes(key))) throw new Error('Możesz zmieniać tylko status, osobę odpowiedzialną, etykiety i notatkę.');
  if (typeof data.crmRevision !== 'string' || data.crmRevision.length > 80) throw new CrmConflictError('Odśwież aplikację przed zapisaniem zmian.');
  if ('assignee' in data && (typeof data.assignee !== 'string' || data.assignee.length > 80 || /[\u0000-\u001f]/.test(data.assignee))) throw new Error('Nieprawidłowa osoba odpowiedzialna.');
  if ('status' in data && !statuses.includes(data.status as typeof statuses[number])) throw new Error('Nieprawidłowy status.');
  if ('note' in data && (typeof data.note !== 'string' || data.note.length > 20000)) throw new Error('Nieprawidłowa notatka.');
  if ('tags' in data && (!Array.isArray(data.tags) || data.tags.length > 30 || data.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 80))) throw new Error('Nieprawidłowe etykiety.');
  await setup();
  return transaction(async () => {
    const row = (await query('SELECT * FROM companies WHERE id=?', [id])).rows[0] as Row | undefined;
    if (!row) throw new Error('Firma nie istnieje.');
    const previous = JSON.parse(row.crm);
    if (actor) {
      const nextOwner = 'assignee' in data ? String(data.assignee).trim() : String(previous.assignee || '');
      if (nextOwner !== String(previous.assignee || '') && nextOwner && !(await query('SELECT 1 FROM crm_people WHERE name=? AND active=1', [nextOwner])).rows.length) throw new RegistryError('Wybierz aktywną osobę z listy zespołu.', 400);
      if (actor.role !== 'admin') {
        if (previous.assignee && previous.assignee !== actor.person) throw new RegistryError('Tę firmę prowadzi inna osoba. Administrator może przekazać kontakt.', 403);
        if (nextOwner && nextOwner !== actor.person) throw new RegistryError('Możesz przypisać firmę do siebie. Przekazanie kontaktu wykonuje administrator.', 403);
        if ('status' in data && data.status !== previous.status && !nextOwner) throw new RegistryError('Przed zmianą statusu przypisz firmę do siebie.', 403);
      }
    }
    if (data.crmRevision !== (previous.crmRevision || '0')) throw new CrmConflictError('Ktoś zmienił tę firmę. Wczytaj aktualne dane przed ponownym zapisem; Twój szkic nie został zapisany.');
    const crm = { ...previous, ...data, crmRevision: randomUUID(), crmUpdatedAt: new Date().toISOString() };
    if (data.status === 'Kontakt wykonany' && previous.status !== 'Kontakt wykonany') crm.lastContact = crm.crmUpdatedAt;
    crm.assignee = (crm.assignee || '').trim();
    crm.tags = [...new Map<string, string>(crm.tags.map((tag: string) => [tag.trim().toLocaleLowerCase('pl'), tag.trim()])).values()];
    crm.searchTags = [...crm.tags, crm.assignee].join(' ').toLocaleLowerCase('pl');
    await query('UPDATE companies SET crm=? WHERE id=?', [JSON.stringify(crm), id]);
    return unpack({ ...row, crm: JSON.stringify(crm) });
  });
}
