import { randomUUID } from 'node:crypto';
import { db, upsertRegistry } from './store';
import { ceidgActivePage, ceidgDetails, RegistryError } from './registries';

export type BulkJob = {
  id: string; state: 'running' | 'paused' | 'complete' | 'failed';
  page: number; pending: string[]; nextPage: number | null; total: number | null;
  discovered: number; processed: number; saved: number; skipped: number;
  withWebsite: number; withEmail: number; withPhone: number;
  retries: number; nextRunAt: number; message: string; createdAt: string; updatedAt: string;
};
function setup() {
  db().exec(`CREATE TABLE IF NOT EXISTS bulk_jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bulk_seen (jobId TEXT NOT NULL, registryId TEXT NOT NULL, PRIMARY KEY(jobId, registryId));`);
}
export function bulkStatus(): BulkJob | null {
  setup(); const row = db().prepare('SELECT data FROM bulk_jobs ORDER BY rowid DESC LIMIT 1').get() as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}
function save(job: BulkJob) {
  job.updatedAt = new Date().toISOString();
  db().prepare('UPDATE bulk_jobs SET state=?, data=? WHERE id=?').run(job.state, JSON.stringify(job), job.id);
}
export function controlBulk(action: 'start' | 'pause' | 'resume'): BulkJob {
  setup(); db().exec('BEGIN IMMEDIATE');
  try {
    let job = bulkStatus();
    if (action === 'start') {
      if (job && job.state !== 'complete') throw new RegistryError('Import już istnieje. Użyj Wznów, aby zachować postęp.', 409);
      job = { id: randomUUID(), state: 'running', page: 0, pending: [], nextPage: null, total: null, discovered: 0, processed: 0, saved: 0, skipped: 0, withWebsite: 0, withEmail: 0, withPhone: 0, retries: 0, nextRunAt: 0, message: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      db().prepare('INSERT INTO bulk_jobs VALUES (?,?,?)').run(job.id, job.state, JSON.stringify(job));
    } else {
      if (!job || job.state === 'complete') throw new RegistryError('Brak importu do wznowienia lub wstrzymania.', 409);
      job.state = action === 'pause' ? 'paused' : 'running'; job.message = ''; job.retries = 0;
      // Keep an upstream Retry-After deadline when resuming.
      save(job);
    }
    db().exec('COMMIT'); return job;
  } catch (error) { db().exec('ROLLBACK'); throw error; }
}
export function acquireWorker(owner: string, now = Date.now()) {
  setup();
  return db().prepare('INSERT INTO worker_lease VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, expiresAt=excluded.expiresAt WHERE worker_lease.expiresAt < ? OR worker_lease.owner = ?').run(owner, now + 60000, now, owner).changes > 0;
}
export function releaseWorker(owner: string) { db().prepare('DELETE FROM worker_lease WHERE owner=?').run(owner); }
export function workerIsAlive() { setup(); return Boolean(db().prepare('SELECT 1 FROM worker_lease WHERE expiresAt > ?').get(Date.now())); }
export function retryDelay(value?: string, now = Date.now()) {
  if (!value) return 60000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(4000, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(4000, date - now) : 60000;
}
export async function bulkStep() {
  const initial = bulkStatus();
  if (!initial || initial.state !== 'running' || initial.nextRunAt > Date.now()) return;
  try {
    if (!initial.pending.length) {
      const page = await ceidgActivePage(initial.page);
      db().exec('BEGIN IMMEDIATE');
      try {
        const job = bulkStatus(); if (!job || job.id !== initial.id) { db().exec('COMMIT'); return; }
        const ids = page.ids.filter(id => {
          return db().prepare('INSERT OR IGNORE INTO bulk_seen VALUES (?,?)').run(job.id, id).changes > 0;
        });
        if (page.ids.length && !ids.length && page.nextPage !== null) throw new RegistryError('CEIDG powtórzył całą stronę. Import zatrzymany, aby uniknąć pętli.');
        job.pending = ids; job.nextPage = page.nextPage; job.total = page.total;
        job.discovered += ids.length; job.retries = 0; job.message = ''; job.nextRunAt = 0;
        if (!ids.length) {
          if (page.nextPage === null) job.state = 'complete'; else job.page = page.nextPage;
        }
        save(job); db().exec('COMMIT');
      } catch (error) { db().exec('ROLLBACK'); throw error; }
    } else {
      const ids = initial.pending.slice(0, 25);
      const details = await ceidgDetails(ids);
      db().exec('BEGIN IMMEDIATE');
      try {
        const job = bulkStatus(); if (!job || job.id !== initial.id) { db().exec('COMMIT'); return; }
        const active = details.filter(firm => firm.registryStatus === 'AKTYWNY');
        // Data and cursor must commit together, so a crash never loses a batch.
        upsertRegistry(active, 'CEIDG', false, false);
        job.pending = job.pending.slice(ids.length); job.processed += ids.length;
        job.saved += active.length; job.skipped += ids.length - active.length;
        job.withWebsite += active.filter(f => f.website).length; job.withEmail += active.filter(f => f.email).length; job.withPhone += active.filter(f => f.phone).length;
        job.retries = 0; job.message = ''; job.nextRunAt = 0;
        if (!job.pending.length) {
          if (job.nextPage === null) job.state = 'complete'; else job.page = job.nextPage;
        }
        save(job); db().exec('COMMIT');
      } catch (error) { db().exec('ROLLBACK'); throw error; }
    }
  } catch (error) {
    const job = bulkStatus(); if (!job || job.id !== initial.id) return;
    const registryError = error instanceof RegistryError ? error : null;
    const temporary = registryError && (registryError.status === 429 || (registryError.status === 502 && (!registryError.upstreamStatus || registryError.upstreamStatus >= 500)));
    job.retries += 1;
    job.message = registryError?.message || 'Nie udało się zapisać partii. Sprawdź bazę lub konflikt identyfikatorów; postęp zachowany.';
    if (temporary && job.retries <= 10) job.nextRunAt = Date.now() + (registryError.status === 429 ? retryDelay(registryError.retryAfter) : Math.min(600000, 10000 * 2 ** job.retries));
    else if (job.state === 'running') job.state = 'failed';
    save(job);
  }
}
