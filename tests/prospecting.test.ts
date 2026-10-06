import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeTestDatabase, query } from '../lib/database';
import { companyPage, upsertRegistry, updateCrm } from '../lib/store';
import { controlBulk, bulkStatus, bulkStep } from '../lib/bulk';
import { normalizeCeidg } from '../lib/registries';
import { qualifiesForProspecting } from '../lib/prospecting';
import { parseContactFilter } from '../lib/contact-filters';
const entry = (id: string, extra = {}) => ({ id, nazwa: id, status: 'AKTYWNY', rokPkd: '2007', adresDzialalnosci: { miasto: 'Łódź' }, pkdGlowny: { kod: '62.01.Z', nazwa: 'Oprogramowanie' }, ...extra });
test('Contact filters combine with paging; focused import preserves cursor, excludes opt-outs, caps queue and checking budget', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'crm-prospects-'));
  process.env.CRM_TEST_DB_PATH = path.join(directory, 'test.sqlite'); process.env.CEIDG_API_TOKEN = 'fixture-token';
  const originalFetch = globalThis.fetch;
  const clearRate = () => query('DELETE FROM api_requests');
  try {
    const fixtures = [entry('service', { email: 's@example.org' }), entry('trade', { telefon: '123', pkdGlowny: { kod: '47.71.Z', nazwa: 'Odzież' } }), entry('missing'), entry('production', { email: 'p@example.org', pkdGlowny: { kod: '14.12.Z', nazwa: 'Produkcja odzieży' } }), entry('has-web', { www: 'example.org', email: 'w@example.org' }), entry('blocked', { telefon: '456' }), entry('web-only', { www: 'example.org' }), entry('empty', { www: '', telefon: '', email: '' })];
    const saved = await upsertRegistry(fixtures.map(normalizeCeidg), 'CEIDG');
    await updateCrm(saved[5].id, { crmRevision: saved[5].crmRevision || '0', status: 'Nie kontaktować', note: 'Preserve exclusion' });
    const counts = { direct: 5, email: 3, phone: 2, website: 2, any: 6, none: 2 };
    for (const [filter, count] of Object.entries(counts)) assert.equal((await companyPage('', 'Wszystkie', 'Wszystkie', 0, filter)).total, count);
    assert.equal(parseContactFilter("email' OR 1=1"), 'all');
    assert.equal((await companyPage('service', 'Wszystkie', 'Wszystkie', 0, 'phone')).total, 0);
    assert.equal((await companyPage('', 'Nie kontaktować', 'Wszystkie', 0, 'phone')).total, 1);
    assert.equal(qualifiesForProspecting(saved[3]), false);
    const old = await controlBulk('start'); old.page = 7; old.pending = ['new-fit', 'new-missing', 'blocked', 'new-fit2', 'new-fit3']; old.detailBatchSize = 3; old.nextPage = 8;
    await query('UPDATE bulk_jobs SET data=? WHERE id=?', [JSON.stringify(old), old.id]); await controlBulk('pause');
    const focused = await controlBulk('focus', 4);
    assert.equal(focused.id, old.id); assert.equal(focused.page, 7); assert.deepEqual(focused.pending, old.pending);
    assert.equal(focused.selection?.qualified, 2); assert.equal(focused.selection?.maxChecks, 40);
    let calls = 0;
    globalThis.fetch = async url => {
      calls++; const ids = new URL(String(url)).searchParams.getAll('ids');
      return Response.json({ firma: ids.map(id => entry(id, id === 'new-missing' ? {} : { telefon: '123' })) });
    };
    await bulkStep(old.id, old.generation); assert.equal(calls, 0);
    await bulkStep(focused.id, focused.generation); assert.equal((await bulkStatus())?.selection?.qualified, 3);
    await clearRate(); await bulkStep();
    const completed = (await bulkStatus())!;
    assert.equal(completed.state, 'complete'); assert.equal(completed.selection?.stopReason, 'target'); assert.equal(completed.selection?.qualified, 4);
    const queue = await companyPage('', 'Wszystkie', 'Wszystkie', 0, 'all', 'prospects');
    assert.equal(queue.total, 4); assert.equal(queue.companies.some(company => company.registryId === 'blocked'), false);
    assert.equal((await companyPage('blocked')).companies[0].note, 'Preserve exclusion');
    assert.equal((await companyPage('new-missing')).total, 0, 'Rejected new entries should not be saved');
    // Stop at an exact checking budget without presenting it as a reached target.
    const budget = await controlBulk('focus', 100); budget.selection!.maxChecks = 1; budget.pending = ['last-unfit']; budget.nextPage = 9;
    await query('UPDATE bulk_jobs SET data=? WHERE id=?', [JSON.stringify(budget), budget.id]); await clearRate();
    globalThis.fetch = async () => Response.json({ firma: [entry('last-unfit')] }); await bulkStep();
    assert.equal((await bulkStatus())?.selection?.checked, 1); assert.equal((await bulkStatus())?.selection?.stopReason, 'budget');
    await upsertRegistry(Array.from({ length: 105 }, (_,i) => normalizeCeidg(entry(`Batch-${i}`, { email: 'fixture@example.org' }))), 'CEIDG');
    assert.equal((await companyPage('batch', 'Wszystkie', 'Wszystkie', 0, 'email')).companies.length, 100);
    assert.equal((await companyPage('batch', 'Wszystkie', 'Wszystkie', 1, 'email')).companies.length, 5);
    assert.equal((await companyPage('batch', 'Wszystkie', 'Wszystkie', 0, 'phone')).total, 0);
  } finally { globalThis.fetch = originalFetch; closeTestDatabase(); rmSync(directory, { recursive: true, force: true }); }
});
