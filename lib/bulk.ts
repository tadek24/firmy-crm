import { randomUUID } from 'node:crypto';
import { batch, query, transaction, type Statement } from './database';
import { setup, upsertRegistry, seedProspects, addProspects } from './store';
import { qualifiesForProspecting } from './prospecting';
import { ceidgActivePage, ceidgDetails, RegistryError } from './registries';
export type BulkSelection = { target: number; maxChecks: number; checked: number; qualified: number; excluded: number; minStartedAt?: string; maxStartedAt?: string; stopReason?: 'target' | 'budget' | 'exhausted' };
export type YearSelection = BulkSelection & { year: number };
export type BulkJob = {
  id: string; state: 'running' | 'paused' | 'complete' | 'failed';
  generation: number; workflowId?: string;
  page: number; pending: string[]; nextPage: number | null; total: number | null;
  detailBatchSize?: number;
  selection?: BulkSelection;
  yearly?: { from: number; to: number; index: number; years: YearSelection[] };
  discovered: number; processed: number; saved: number; skipped: number;
  withWebsite: number; withEmail: number; withPhone: number;
  retries: number; nextRunAt: number; message: string; createdAt: string; updatedAt: string;
};
export async function bulkStatus(): Promise<BulkJob | null> {
  await setup(); const row = (await query('SELECT data FROM bulk_jobs ORDER BY rowid DESC LIMIT 1')).rows[0];
  return row ? JSON.parse(String(row.data)) : null;
}
function saveStatement(job: BulkJob): Statement {
  job.updatedAt = new Date().toISOString();
  return { sql: 'UPDATE bulk_jobs SET state=?,data=? WHERE id=?', args: [job.state, JSON.stringify(job), job.id] };
}
function freshJob(): BulkJob {
  return { id: randomUUID(), state: 'running', generation: 1, page: 0, pending: [], nextPage: null, total: null, discovered: 0, processed: 0, saved: 0, skipped: 0, withWebsite: 0, withEmail: 0, withPhone: 0, retries: 0, nextRunAt: 0, message: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function recentWindow(years = 5) {
  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return { minStartedAt: cutoff.toISOString().slice(0, 10), maxStartedAt: now.toISOString().slice(0, 10) };
}
function currentSelection(job: BulkJob) { return job.yearly ? job.yearly.years[job.yearly.index] : job.selection; }
function advanceYear(job: BulkJob, reason: NonNullable<BulkSelection['stopReason']>) {
  if (!job.yearly) return;
  const campaign = job.yearly;
  campaign.years[campaign.index].stopReason = reason;
  while (campaign.index + 1 < campaign.years.length) {
    campaign.index++;
    const next = campaign.years[campaign.index];
    if (next.qualified >= next.target) { next.stopReason = 'target'; continue; }
    job.state = 'running'; job.page = 0; job.pending = []; job.nextPage = null; job.total = null;
    job.message = ''; job.retries = 0; job.nextRunAt = 0;
    return;
  }
  job.state = 'complete'; job.pending = [];
  job.message = campaign.years.every(year => year.stopReason === 'target')
    ? 'Zebrano docelową liczbę firm z każdego rocznika.'
    : 'Import roczników zakończony. Niektóre roczniki mają mniej dopasowań niż cel; sprawdź ich liczniki.';
}
export async function controlBulk(action: 'start' | 'pause' | 'resume' | 'focus' | 'yearly', target = 1000, from = 2020, to = new Date().getUTCFullYear()): Promise<BulkJob> {
  await setup(); return transaction(async () => {
    let job = await bulkStatus();
    if (action === 'yearly') {
      const today = new Date().toISOString().slice(0, 10), thisYear = Number(today.slice(0, 4));
      if (!Number.isSafeInteger(target) || target < 1 || target > 5000 || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1900 || to > thisYear || from > to || to - from > 19) throw new RegistryError('Nieprawidłowy zakres lat lub cel importu.', 400);
      if (job?.state === 'running') throw new RegistryError('Wstrzymaj trwający import przed rozpoczęciem nowego zakresu.', 409);
      job = freshJob();
      job.yearly = { from, to, index: 0, years: [] };
      await query('INSERT INTO bulk_jobs VALUES (?,?,?)', [job.id, job.state, JSON.stringify(job)]);
      for (let year = from; year <= to; year++) {
        const dates = { minStartedAt: `${year}-01-01`, maxStartedAt: year === thisYear ? today : `${year}-12-31` };
        const maxChecks = target * 100;
        const qualified = await seedProspects(job.id, target, maxChecks, { ...dates, includeExisting: true });
        job.yearly.years.push({ year, target, maxChecks, checked: 0, qualified, excluded: 0, ...dates, ...(qualified >= target ? { stopReason: 'target' as const } : {}) });
      }
      if (job.yearly.years[0].qualified >= target) advanceYear(job, 'target');
      await batch([saveStatement(job)]);
    } else if (action === 'start') {
      if (job && job.state !== 'complete') throw new RegistryError('Import już istnieje. Użyj Wznów, aby zachować postęp.', 409);
      job = freshJob();
      await query('INSERT INTO bulk_jobs VALUES (?,?,?)', [job.id, job.state, JSON.stringify(job)]);
    } else if (action === 'focus') {
      if (!Number.isSafeInteger(target) || target < 1 || target > 5000) throw new RegistryError('Cel musi wynosić od 1 do 5000 firm.', 400);
      if (!job || job.state === 'complete') {
        job = freshJob();
        await query('INSERT INTO bulk_jobs VALUES (?,?,?)', [job.id, job.state, JSON.stringify(job)]);
      }
      if (job.selection) throw new RegistryError('Selekcja już istnieje. Użyj Wznów, aby zachować kolejkę.', 409);
      const maxChecks = target * 10;
      const window = recentWindow(5);
      const qualified = await seedProspects(job.id, target, maxChecks, window);
      job.selection = { target, maxChecks, checked: 0, qualified, excluded: 0, ...window };
      job.state = qualified >= target ? 'complete' : 'running';
      if (qualified >= target) { job.selection.stopReason = 'target'; job.message = 'Zebrano docelową kolejkę firm.'; }
      else job.message = '';
      job.generation++; delete job.workflowId; job.nextRunAt = 0; job.retries = 0;
      await batch([saveStatement(job)]);
    } else {
      if (!job || job.state === 'complete') throw new RegistryError('Brak importu do wznowienia lub wstrzymania.', 409);
      job.state = action === 'pause' ? 'paused' : 'running'; job.generation += 1; delete job.workflowId; job.message = ''; job.retries = 0;
      await batch([saveStatement(job)]);
    }
    return job;
  });
}
export async function attachWorkflow(id: string, generation: number, workflowId: string) {
  await transaction(async () => { const job = await bulkStatus(); if (job?.id === id && job.generation === generation) { job.workflowId = workflowId; await batch([saveStatement(job)]); } });
}
export async function dispatchFailed(id: string, generation: number) {
  await transaction(async () => { const job = await bulkStatus(); if (job?.id === id && job.generation === generation && job.state === 'running') { job.state = 'failed'; job.message = 'Nie udało się uruchomić importu w chmurze. Użyj Wznów, aby spróbować ponownie.'; await batch([saveStatement(job)]); } });
}
export async function acquireWorker(owner: string, now = Date.now()) {
  await setup(); return (await query('INSERT INTO worker_lease VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expiresAt=excluded.expiresAt WHERE worker_lease.expiresAt < ? OR worker_lease.owner = ?', [owner, now + 120000, now, owner])).changes > 0;
}
export async function releaseWorker(owner: string) { await query('DELETE FROM worker_lease WHERE owner=?', [owner]); }
export async function workerIsAlive() { await setup(); return Boolean((await query('SELECT 1 FROM worker_lease WHERE expiresAt > ?', [Date.now()])).rows.length); }
export function retryDelay(value?: string, now = Date.now()) {
  if (!value) return 60000; const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(4000, seconds * 1000);
  const date = Date.parse(value); return Number.isFinite(date) ? Math.max(4000, date - now) : 60000;
}
function samePosition(job: BulkJob | null, initial: BulkJob): job is BulkJob {
  return Boolean(job && job.id === initial.id && job.generation === initial.generation && job.yearly?.index === initial.yearly?.index && job.page === initial.page && JSON.stringify(job.pending) === JSON.stringify(initial.pending));
}
export async function bulkStep(expectedId?: string, generation?: number) {
  const initial = await bulkStatus();
  if (!initial || initial.state !== 'running' || initial.nextRunAt > Date.now() || (expectedId && (initial.id !== expectedId || initial.generation !== generation))) return;
  try {
    if (!initial.pending.length) {
      const page = await ceidgActivePage(initial.page, currentSelection(initial));
      await transaction(async () => {
        const job = await bulkStatus(); if (!samePosition(job, initial)) return;
        const seen = page.ids.length ? (await query(`SELECT registryId FROM bulk_seen WHERE jobId=? AND registryId IN (${page.ids.map(() => '?').join(',')})`, [job.id, ...page.ids])).rows.map(row => row.registryId) : [];
        const ids = page.ids.filter(id => !seen.includes(id));
        if (page.ids.length && !ids.length && page.nextPage !== null) throw new RegistryError('CEIDG powtórzył całą stronę. Import zatrzymany, aby uniknąć pętli.');
        job.pending = ids; job.nextPage = page.nextPage; job.total = page.total;
        job.discovered += ids.length; job.retries = 0; job.message = ''; job.nextRunAt = 0;
        if (!ids.length) { if (page.nextPage === null) job.state = 'complete'; else job.page = page.nextPage; }
        if (job.state === 'complete' && job.selection) { job.selection.stopReason = 'exhausted'; job.message = 'Przejrzano dostępną listę CEIDG. Zebrano tylko znalezione dopasowania.'; }
        if (job.state === 'complete' && job.yearly) advanceYear(job, 'exhausted');
        await batch([...ids.map(id => ({ sql: 'INSERT OR IGNORE INTO bulk_seen VALUES (?,?)', args: [job.id, id] })), saveStatement(job)]);
      });
    } else {
      const initialSelection = currentSelection(initial);
      const remainingChecks = initialSelection ? initialSelection.maxChecks - initialSelection.checked : 25;
      const ids = initial.pending.slice(0, Math.min(initial.detailBatchSize || 25, remainingChecks)); const details = await ceidgDetails(ids);
      await transaction(async () => {
        const job = await bulkStatus(); if (!samePosition(job, initial)) return;
        const active = details.filter(firm => firm.registryStatus === 'AKTYWNY');
        const selection = currentSelection(job);
        const options = selection ? { minStartedAt: selection.minStartedAt, maxStartedAt: selection.maxStartedAt, includeExisting: Boolean(job.yearly) } : {};
        const accepted = selection ? active.filter(firm => qualifiesForProspecting(firm, options)) : active;
        const saved = await upsertRegistry(accepted, 'CEIDG', false, false);
        if (selection) {
          selection.qualified += await addProspects(job.id, saved, selection.target - selection.qualified, options);
          selection.checked += ids.length; selection.excluded += ids.length - saved.filter(firm => qualifiesForProspecting(firm, options)).length;
        }
        job.pending = job.pending.slice(ids.length); job.processed += ids.length; job.saved += saved.length; job.skipped += ids.length - saved.length;
        job.withWebsite += saved.filter(f => f.website).length; job.withEmail += saved.filter(f => f.email).length; job.withPhone += saved.filter(f => f.phone).length;
        job.retries = 0; job.message = ''; job.nextRunAt = 0;
        if (!job.pending.length) { if (job.nextPage === null) job.state = 'complete'; else job.page = job.nextPage; }
        if (selection) {
          if (selection.qualified >= selection.target) { job.state = 'complete'; selection.stopReason = 'target'; job.message = 'Zebrano docelową kolejkę firm. Pobieranie zakończone.'; }
          else if (selection.checked >= selection.maxChecks) { job.state = 'complete'; selection.stopReason = 'budget'; job.message = 'Osiągnięto limit sprawdzanych wpisów. Kolejka zawiera tylko znalezione dopasowania; nie osiągnięto celu.'; }
          else if (job.state === 'complete') { selection.stopReason = 'exhausted'; job.message = 'Przejrzano dostępną listę CEIDG. Zebrano tylko znalezione dopasowania.'; }
          if (job.state === 'complete' && job.yearly) advanceYear(job, selection.stopReason!);
        }
        const writes = [saveStatement(job)];
        if (job.state === 'complete') writes.push({ sql: 'INSERT INTO imports(source,count,createdAt) VALUES (?,?,?)', args: ['CEIDG — import automatyczny', job.saved, new Date().toISOString()] });
        await batch(writes);
      });
    }
  } catch (error) {
    await transaction(async () => {
      const job = await bulkStatus(); if (!samePosition(job, initial)) return;
      const registryError = error instanceof RegistryError ? error : null;
      // Production can impose a smaller detail limit than its published examples.
      // Reduce only on the explicit identifier-count error; never skip pending entries.
      if (registryError?.upstreamStatus === 400 && /Maksymalna ilość identyfikatorów wpisów/i.test(registryError.message) && initial.pending.length > 1) {
        const attempted = Math.min(initial.detailBatchSize || 25, initial.pending.length);
        if (attempted > 1) {
          job.detailBatchSize = Math.max(1, Math.floor(attempted / 2));
          job.nextRunAt = Date.now() + 4000; job.retries = 0;
          job.message = `CEIDG ogranicza liczbę szczegółów w zapytaniu. Import będzie kontynuowany w partiach do ${job.detailBatchSize} firm.`;
          await batch([saveStatement(job)]); return;
        }
      }
      const temporary = registryError && (registryError.status === 429 || (registryError.status === 502 && (!registryError.upstreamStatus || registryError.upstreamStatus >= 500)));
      job.retries += 1; job.message = registryError?.message || 'Nie udało się zapisać partii. Sprawdź bazę lub konflikt identyfikatorów; postęp zachowany.';
      if (temporary && job.retries <= 10) job.nextRunAt = Date.now() + (registryError.status === 429 ? retryDelay(registryError.retryAfter) : Math.min(600000, 10000 * 2 ** job.retries));
      else if (job.state === 'running') job.state = 'failed';
      await batch([saveStatement(job)]);
    });
  }
}
