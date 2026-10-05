import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { db, companyPage, listCompanies, updateCrm, upsertRegistry } from '../lib/store';
import { acquireWorker, bulkStatus, bulkStep, controlBulk, releaseWorker, retryDelay } from '../lib/bulk';
import { normalizeCeidg } from '../lib/registries';

test('Bulk import checkpoints, pause/resume, leases, retries, contacts and server pagination', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'crm-bulk-'));
  process.env.CRM_DB_PATH = path.join(directory, 'bulk.sqlite');
  const fetchBefore = globalThis.fetch, tokenBefore = process.env.CEIDG_API_TOKEN;
  process.env.CEIDG_API_TOKEN = 'test-token';
  let requests = 0;
  const fixture = (id: string, status = 'AKTYWNY') => ({ id, nazwa: `Łódź ${id}`, status, wlasciciel: { nip: id === 'active-1' ? '1234567890' : '' }, www: 'example.org', email: 'info@example.org', telefon: '+48 123456789' });
  const clearRate = () => db().exec('DELETE FROM api_requests');
  try {
    assert.equal(bulkStatus(), null);
    assert.equal(acquireWorker('first'), true);
    assert.equal(acquireWorker('second'), false);
    releaseWorker('first'); assert.equal(acquireWorker('second'), true); releaseWorker('second');
    assert.equal(retryDelay('60'), 60000);
    assert.equal(retryDelay(new Date(Date.now() + 60000).toUTCString()) > 50000, true);
    const existing = upsertRegistry([normalizeCeidg(fixture('active-1'))], 'CEIDG')[0];
    updateCrm(existing.id, { note: 'CRM must survive', tags: ['Łódź'], status: 'Do kontaktu' });
    const job = controlBulk('start'); assert.equal(job.page, 0);
    assert.throws(() => controlBulk('start'), /istnieje/);
    globalThis.fetch = async url => {
      requests++; const query = new URL(String(url));
      if (query.pathname.endsWith('/firmy')) {
        assert.equal(query.searchParams.get('status'), 'AKTYWNY');
        assert.equal(query.searchParams.has('dataod'), false);
        return Response.json({ firmy: [{ id: 'active-1' }, { id: 'closed-2' }], count: 2, links: { next: null } });
      }
      assert.deepEqual(query.searchParams.getAll('ids'), ['active-1', 'closed-2']);
      return Response.json({ firma: [fixture('active-1'), fixture('closed-2', 'WYKRESLONY')] });
    };
    await bulkStep(); assert.equal(bulkStatus()?.pending.length, 2);
    controlBulk('pause'); clearRate(); await bulkStep(); assert.equal(requests, 1);
    controlBulk('resume'); await bulkStep();
    assert.equal(bulkStatus()?.state, 'complete'); assert.equal(bulkStatus()?.saved, 1); assert.equal(bulkStatus()?.skipped, 1);
    assert.equal(bulkStatus()?.withPhone, 1); assert.equal(bulkStatus()?.withEmail, 1); assert.equal(bulkStatus()?.withWebsite, 1);
    assert.equal(listCompanies().length, 1); assert.equal(listCompanies()[0].note, 'CRM must survive');
    assert.equal(companyPage('łódź').total, 1); assert.equal((companyPage().stats as { toContact: number }).toContact, 1);
    upsertRegistry([normalizeCeidg({ ...fixture('active-1'), www: undefined, email: undefined, telefon: undefined })], 'CEIDG');
    assert.equal((companyPage().stats as { website: number }).website, 0);
    const fixtures = Array.from({ length: 105 }, (_, index) => normalizeCeidg(fixture(`other-${index}`)));
    upsertRegistry(fixtures, 'CEIDG'); assert.equal(companyPage().companies.length, 100); assert.equal(companyPage('', 'Wszystkie', 'Wszystkie', 1).companies.length, 6);
    assert.equal(companyPage('%').total, 0);
    clearRate(); controlBulk('start');
    globalThis.fetch = async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
    await bulkStep(); assert.equal(bulkStatus()?.state, 'running'); assert.ok((bulkStatus()?.nextRunAt || 0) > Date.now() + 55000);
    const before = bulkStatus()?.nextRunAt; controlBulk('pause'); controlBulk('resume'); assert.equal(bulkStatus()?.nextRunAt, before);
    await bulkStep(); assert.equal(bulkStatus()?.processed, 0);
    const waiting = bulkStatus()!; waiting.nextRunAt = 0; db().prepare('UPDATE bulk_jobs SET data=? WHERE id=?').run(JSON.stringify(waiting), waiting.id);
    clearRate(); globalThis.fetch = async () => new Response(null, { status: 401 });
    await bulkStep(); assert.equal(bulkStatus()?.state, 'failed'); assert.match(bulkStatus()?.message || '', /token/);
    // A failed save must leave the cursor and all registry rows unchanged.
    const conflictJob = bulkStatus()!; conflictJob.state = 'running'; conflictJob.pending = ['active-1']; conflictJob.nextRunAt = 0;
    db().prepare('UPDATE bulk_jobs SET state=?,data=? WHERE id=?').run('running', JSON.stringify(conflictJob), conflictJob.id);
    const other = listCompanies().find(company => company.registryId === 'other-0')!;
    db().prepare('UPDATE companies SET regon=? WHERE id=?').run('999999999', other.id);
    clearRate(); globalThis.fetch = async () => Response.json({ firma: [{ ...fixture('active-1'), wlasciciel: { nip: '1234567890', regon: '999999999' } }] });
    await bulkStep(); assert.equal(bulkStatus()?.state, 'failed'); assert.deepEqual(bulkStatus()?.pending, ['active-1']); assert.equal(listCompanies().length, 106);
  } finally {
    globalThis.fetch = fetchBefore; if (tokenBefore === undefined) delete process.env.CEIDG_API_TOKEN; else process.env.CEIDG_API_TOKEN = tokenBefore;
    db().close(); rmSync(directory, { recursive: true, force: true });
  }
});
