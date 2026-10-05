import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeTestDatabase, query } from '../lib/database';
import { companyPage, upsertRegistry, updateCrm } from '../lib/store';
import { acquireWorker, bulkStatus, bulkStep, controlBulk, releaseWorker, retryDelay } from '../lib/bulk';
import { ceidgActivePage, normalizeCeidg } from '../lib/registries';

test('Cloud import checkpoints, retries, leases, pause during API response, resume and atomic rollback', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'crm-cloud-'));
  process.env.CRM_TEST_DB_PATH = path.join(directory, 'test.sqlite'); process.env.CEIDG_API_TOKEN = 'fixture-token';
  const originalFetch = globalThis.fetch;
  const fixture = (id: string, status = 'AKTYWNY') => ({ id, nazwa: id, status, wlasciciel: { nip: id === 'active-1' ? '1234567890' : '' }, www: 'example.org', email: 'mail@example.org', telefon: '123456789' });
  const clearRate = () => query('DELETE FROM api_requests');
  let requests = 0;
  try {
    assert.equal(await bulkStatus(), null);
    assert.equal(await acquireWorker('one'), true); assert.equal(await acquireWorker('two'), false);
    await releaseWorker('one'); assert.equal(await acquireWorker('two'), true); await releaseWorker('two');
    assert.equal(retryDelay('60'), 60000);
    const existing = (await upsertRegistry([normalizeCeidg(fixture('active-1'))], 'CEIDG'))[0];
    await updateCrm(existing.id, { note: 'Preserve CRM', status: 'Do kontaktu' });
    const job = await controlBulk('start');
    await assert.rejects(controlBulk('start'), /istnieje/);
    globalThis.fetch = async url => {
      requests++; const parsed = new URL(String(url));
      assert.equal(parsed.hostname, 'dane.biznes.gov.pl');
      if (parsed.pathname.endsWith('/firmy')) {
        assert.equal(parsed.searchParams.get('status'), 'AKTYWNY'); assert.equal(parsed.searchParams.get('limit'), '25'); assert.equal(parsed.searchParams.has('dataod'), false);
        return Response.json({ firmy: [{ id: 'active-1' }, { id: 'closed-2' }], count: 2, links: { next: null } });
      }
      assert.deepEqual(parsed.searchParams.getAll('ids'), ['active-1','closed-2']);
      return Response.json({ firma: [fixture('active-1'), fixture('closed-2','WYKRESLONY')] });
    };
    await bulkStep(job.id, job.generation); assert.equal((await bulkStatus())?.pending.length, 2);
    await controlBulk('pause'); await clearRate(); await bulkStep(); assert.equal(requests, 1);
    const resumed = await controlBulk('resume');
    await bulkStep(job.id, job.generation); assert.equal(requests, 1, 'Stale workflows must not make API calls');
    await bulkStep(resumed.id, resumed.generation);
    const completed = await bulkStatus(); assert.equal(completed?.state, 'complete'); assert.equal(completed?.saved, 1); assert.equal(completed?.skipped, 1);
    assert.equal(completed?.withPhone, 1); assert.equal(completed?.withEmail, 1); assert.equal(completed?.withWebsite, 1);
    assert.equal((await companyPage()).companies[0].note, 'Preserve CRM');
    assert.equal((await companyPage()).companies[0].analysis?.version, 1);
    assert.ok(JSON.parse(String((await query('SELECT registry FROM companies WHERE id=?', [existing.id])).rows[0].registry)).analysis);
    await clearRate(); await controlBulk('start');
    globalThis.fetch = async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
    await bulkStep(); const waiting = await bulkStatus(); assert.ok(waiting!.nextRunAt > Date.now() + 55000);
    await controlBulk('pause'); await controlBulk('resume'); assert.equal((await bulkStatus())!.nextRunAt, waiting!.nextRunAt);
    const retry = (await bulkStatus())!; retry.nextRunAt = 0;
    await query('UPDATE bulk_jobs SET data=? WHERE id=?', [JSON.stringify(retry), retry.id]); await clearRate();
    globalThis.fetch = async () => new Response(null, { status: 401 }); await bulkStep();
    assert.equal((await bulkStatus())!.state, 'failed'); assert.match((await bulkStatus())!.message, /token/);
    // Pause while the registry request is in flight: its old response must not move the checkpoint.
    const beforeRace = await controlBulk('resume'); await clearRate();
    globalThis.fetch = async () => { await controlBulk('pause'); return Response.json({ firmy: [{ id: 'new-3' }], count: 1, links: { next: null } }); };
    await bulkStep(beforeRace.id, beforeRace.generation);
    assert.equal((await bulkStatus())!.pending.length, 0); assert.equal((await bulkStatus())!.state, 'paused');
    // A conflicting registry batch must roll back both data and cursor.
    await upsertRegistry([normalizeCeidg({ ...fixture('other-4'), wlasciciel: { regon: '999999999' } })], 'CEIDG');
    const conflict = await controlBulk('resume'); conflict.pending = ['active-1'];
    await query('UPDATE bulk_jobs SET data=? WHERE id=?', [JSON.stringify(conflict), conflict.id]); await clearRate();
    globalThis.fetch = async () => Response.json({ firma: [{ ...fixture('active-1'), wlasciciel: { nip: '1234567890', regon: '999999999' } }] });
    await bulkStep(); assert.equal((await bulkStatus())!.state, 'failed'); assert.deepEqual((await bulkStatus())!.pending, ['active-1']);
    assert.equal((await companyPage()).total, 2);
    // A changing detail limit reduces the request without losing its queue/checkpoint.
    const adaptive = await controlBulk('resume'); adaptive.pending = ['new-5', 'new-6']; adaptive.nextPage = null;
    await query('UPDATE bulk_jobs SET data=? WHERE id=?', [JSON.stringify(adaptive), adaptive.id]); await clearRate();
    globalThis.fetch = async () => Response.json({ message: 'Niepoprawne wywołanie metody firma. Maksymalna ilość identyfikatorów wpisów to' }, { status: 400 });
    await bulkStep(); const reduced = (await bulkStatus())!;
    assert.equal(reduced.state, 'running'); assert.equal(reduced.detailBatchSize, 1);
    assert.deepEqual(reduced.pending, ['new-5', 'new-6']); assert.equal(reduced.processed, adaptive.processed);
    reduced.nextRunAt = 0;
    await query('UPDATE bulk_jobs SET data=? WHERE id=?', [JSON.stringify(reduced), reduced.id]); await clearRate();
    globalThis.fetch = async url => {
      const ids = new URL(String(url)).searchParams.getAll('ids'); assert.equal(ids.length, 1);
      return Response.json({ firma: ids.map(id => fixture(id)) });
    };
    await bulkStep(); await clearRate(); await bulkStep();
    assert.equal((await bulkStatus())!.state, 'complete');
    assert.equal((await bulkStatus())!.processed, adaptive.processed + 2);
    // Production CEIDG rejects limit >25; fallback pagination must use the same size.
    await clearRate();
    globalThis.fetch = async () => Response.json({ firmy: Array.from({length:25}, (_,i) => ({id: 'page-' + i})), count: 51, links: { next: 'https://dane.biznes.gov.pl/api/ceidg/v3/firmy?status=AKTYWNY&limit=25&page=0' } });
    assert.equal((await ceidgActivePage(0)).nextPage, 1);
    await clearRate();
    globalThis.fetch = async () => Response.json({ message: 'Rozmiar strony powinien być z zakresu 1-25 fixture-token' }, { status:400 });
    await assert.rejects(ceidgActivePage(0), error => error instanceof Error && error.message.includes('1-25') && !error.message.includes('fixture-token'));
  } finally { globalThis.fetch = originalFetch; closeTestDatabase(); rmSync(directory, { recursive: true, force: true }); }
});
