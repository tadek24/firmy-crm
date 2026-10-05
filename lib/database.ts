import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type Parameter = string | number | null;
export type Statement = { sql: string; args?: Parameter[] };
type Row = Record<string, string | number | null>;
export type Result = { rows: Row[]; changes: number };
type Value = { type: string; value?: string | number };
type Pipeline = { baton: string | null; base_url: string | null; results: { type: string; response?: { result?: { cols: { name: string }[]; rows: Value[][]; affected_row_count: number } } }[] };

export class DatabaseError extends Error {}
class Connection {
  private baton: string | null = null;
  constructor(private local?: DatabaseSync) {}
  async execute(statements: Statement[], close = false): Promise<Result[]> {
    if (this.local) return statements.map(statement => {
      const query = this.local!.prepare(statement.sql);
      if (/^\s*(SELECT|WITH|PRAGMA)/i.test(statement.sql)) return { rows: query.all(...(statement.args || [])) as Row[], changes: 0 };
      const result = query.run(...(statement.args || []));
      return { rows: [], changes: Number(result.changes) };
    });
    const configured = process.env.TURSO_DATABASE_URL?.trim();
    const token = process.env.TURSO_AUTH_TOKEN?.trim();
    if (!configured || !token) throw new DatabaseError('Podłącz bazę Turso w ustawieniach Storage projektu na Vercel i wykonaj ponowne wdrożenie.');
    const url = new URL(configured.replace(/^(libsql|turso):/, 'https:'));
    if (url.protocol !== 'https:' || url.username || url.password) throw new DatabaseError('Nieprawidłowy adres bazy danych.');
    url.pathname = '/v2/pipeline'; url.search = '';
    const encode = (value: Parameter) => value === null ? { type: 'null' } : typeof value === 'number' ? { type: Number.isInteger(value) ? 'integer' : 'float', value: String(value) } : { type: 'text', value };
    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ baton: this.baton, requests: [...statements.map(statement => ({ type: 'execute', stmt: { sql: statement.sql, args: (statement.args || []).map(encode) } })), ...(close ? [{ type: 'close' }] : [])] }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw new DatabaseError('Baza danych w chmurze nie odpowiada. Spróbuj ponownie.'); }
    if (!response.ok) throw new DatabaseError(response.status === 401 || response.status === 403 ? 'Baza odrzuciła dane dostępu. Sprawdź ustawienia Turso na Vercel.' : 'Baza danych jest chwilowo niedostępna lub osiągnęła limit planu.');
    const data = await response.json() as Pipeline;
    this.baton = data.baton;
    if (!Array.isArray(data.results) || data.results.length !== statements.length + Number(close) || data.results.some(result => result.type !== 'ok')) throw new DatabaseError('Nie udało się wykonać operacji w bazie danych. Postęp importu pozostaje zapisany.');
    return data.results.slice(0, statements.length).map(entry => {
      const result = entry.response?.result;
      if (!result) throw new DatabaseError('Nieprawidłowa odpowiedź bazy danych.');
      return { changes: result.affected_row_count, rows: result.rows.map(values => Object.fromEntries(result.cols.map((column, index) => {
        const value = values[index];
        return [column.name, value.type === 'null' ? null : value.type === 'integer' || value.type === 'float' ? Number(value.value) : value.value];
      }))) as Row[] };
    });
  }
  async finish(commit: boolean) { await this.execute([{ sql: commit ? 'COMMIT' : 'ROLLBACK' }], true); }
}

let localDatabase: DatabaseSync | undefined;
const scope = new AsyncLocalStorage<Connection>();
// Local SQLite is available only to tests/development. Vercel always uses Turso.
function connection() {
  if (process.env.CRM_TEST_DB_PATH && !process.env.VERCEL) {
    if (!localDatabase) {
      const file = path.resolve(/* turbopackIgnore: true */ process.env.CRM_TEST_DB_PATH);
      mkdirSync(path.dirname(file), { recursive: true });
      localDatabase = new DatabaseSync(file);
      localDatabase.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    }
    return new Connection(localDatabase);
  }
  return new Connection();
}
export async function batch(statements: Statement[]) {
  const current = scope.getStore();
  return (current || connection()).execute(statements, !current);
}
export async function query(sql: string, args: Parameter[] = []) { return (await batch([{ sql, args }]))[0]; }
export async function transaction<T>(run: () => Promise<T>): Promise<T> {
  if (scope.getStore()) return run();
  const current = connection();
  await current.execute([{ sql: 'BEGIN IMMEDIATE' }]);
  try {
    const result = await scope.run(current, run);
    await current.finish(true);
    return result;
  } catch (error) {
    try { await current.finish(false); } catch { /* Timed out connections roll back server-side. */ }
    throw error;
  }
}
export function closeTestDatabase() { localDatabase?.close(); localDatabase = undefined; }
