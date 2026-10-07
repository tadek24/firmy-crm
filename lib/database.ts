import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import type { PGlite, Transaction } from '@electric-sql/pglite';

export type Parameter = string | number | null;
export type Statement = { sql: string; args?: Parameter[] };
type Row = Record<string, string | number | null>;
export type Result = { rows: Row[]; changes: number };
export class DatabaseError extends Error {}
type Execute = (statement: Statement) => Promise<Result>;
const scope = new AsyncLocalStorage<Execute>();
const names = ['registryId','createdAt','expiresAt','jobId','companyId','taskId','passwordHash','personId','personActive','toContact','aiState'];
const columnNames = new Map(names.map(name => [name.toLowerCase(),name]));
export function bindParameters(sql: string) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, token => token === '?' ? `$${++index}` : token);
}
function rows(input: Record<string, unknown>[]): Row[] {
  return input.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [columnNames.get(key) || key,value])) as Row);
}
let pool: ReturnType<typeof postgres> | undefined;
let testDatabase: Promise<PGlite> | undefined;
function client() {
  const url = process.env.SUPABASE_DATABASE_URL?.trim();
  if (!url) throw new DatabaseError('Podłącz bazę Supabase: ustaw SUPABASE_DATABASE_URL w Vercel i wykonaj ponowne wdrożenie.');
  if (!pool) pool = postgres(url, {password:process.env.SUPABASE_DATABASE_PASSWORD,ssl:'require',prepare:false,max:2,idle_timeout:20,connect_timeout:10,types:{bigint:{to:20,from:[20],serialize:String,parse:Number}}});
  return pool;
}
async function local() {
  if (!testDatabase) testDatabase = import('@electric-sql/pglite').then(({PGlite}) => new PGlite());
  return testDatabase;
}
async function connect<T>(run: () => Promise<T>, lock: boolean): Promise<T> {
  try {
    const initialize = async (execute: Execute) => {
      if (lock) await execute({sql:'SELECT pg_advisory_xact_lock(729314005)'});
      await execute({sql:'CREATE SCHEMA IF NOT EXISTS crm'});
      await execute({sql:'SET LOCAL search_path TO crm,public'});
      await execute({sql:"SET LOCAL statement_timeout TO '15s'"});
      return scope.run(execute,run);
    };
    if (process.env.CRM_TEST_DB_PATH && !process.env.VERCEL) {
      return await (await local()).transaction(async (tx: Transaction) => initialize(async statement => {
        const result = await tx.query<Record<string,unknown>>(bindParameters(statement.sql),statement.args || []);
        return {rows:rows(result.rows),changes:result.affectedRows || 0};
      }));
    }
    return await client().begin(async tx => initialize(async statement => {
      const result = await tx.unsafe(bindParameters(statement.sql),statement.args || []);
      return {rows:rows([...result]),changes:result.count};
    })) as T;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    const code = (error as {code?:string}).code;
    if (!code || (process.env.CRM_TEST_DB_PATH && !process.env.VERCEL)) throw error;
    console.error('Supabase database operation failed', {code});
    throw new DatabaseError(code === '28P01' ? 'Supabase odrzuciło dane dostępu. Sprawdź połączenie bazy w Vercel.' : 'Nie można wykonać operacji w Supabase. Spróbuj ponownie lub sprawdź stan projektu bazy.');
  }
}
export async function batch(statements: Statement[]) {
  const run = async () => { const execute=scope.getStore()!; const results:Result[]=[]; for (const statement of statements) results.push(await execute(statement)); return results; };
  return scope.getStore() ? run() : connect(run,!statements.every(statement => /^\s*(SELECT|EXPLAIN)\b/i.test(statement.sql)));
}
export async function query(sql: string,args: Parameter[] = []) { return (await batch([{sql,args}]))[0]; }
export async function transaction<T>(run: () => Promise<T>): Promise<T> { return scope.getStore() ? run() : connect(run,true); }
export async function closeTestDatabase() { const current=testDatabase; testDatabase=undefined; if(current) await (await current).close(); }
