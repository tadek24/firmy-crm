import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeTestDatabase, query } from '../lib/database';
import { companyPage, upsertRegistry, updateCrm } from '../lib/store';
import { acquireWorker, bulkStatus, bulkStep, controlBulk, releaseWorker, retryDelay } from '../lib/bulk';
import { normalizeCeidg } from '../lib/registries';

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
        assert.equal(parsed.searchParams.get('status'), 'AKTYWNY'); assert.equal(parsed.searchParams.has('dataod'), false);
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
  } finally { globalThis.fetch = originalFetch; closeTestDatabase(); rmSync(directory, { recursive: true, force: true }); }
});
