import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, transaction, batch, closeTestDatabase, bindParameters } from '../lib/database';
import { normalizeCeidg } from '../lib/registries';
import { companyPage, upsertRegistry, updateCrm } from '../lib/store';

test('PostgreSQL: rollback, contacts, deduplication, membership and CRM preservation', async () => {
  process.env.CRM_TEST_DB_PATH='cloud-fixture';
  try {
    assert.equal((await companyPage()).total, 0);
    const fixture = normalizeCeidg({ id: 'firm-one', nazwa: 'Łódź', status: 'AKTYWNY', wlasciciel: { nip: '1234567890' }, www: 'example.org', email: 'a@example.org', telefon: '123456789' });
    const saved = (await upsertRegistry([fixture], 'CEIDG'))[0];
    await updateCrm(saved.id, { crmRevision: saved.crmRevision || '0', note: 'Keep note', status: 'Do kontaktu', tags: ['Łódź'] });
    await upsertRegistry([{ ...fixture, name: 'Changed' }], 'CEIDG');
    const page = await companyPage('łódź');
    assert.equal(page.total, 1); assert.equal(page.companies[0].note, 'Keep note');
    assert.equal(page.stats.phone, 1); assert.equal(page.stats.toContact, 1);
    const other = { ...fixture, registryId: 'firm-two', nip: '9999999999', regon: '999999999' };
    await upsertRegistry([other], 'CEIDG');
    await assert.rejects(upsertRegistry([{ ...fixture, regon: '999999999' }], 'CEIDG'), /Konflikt/);
    await assert.rejects(transaction(async () => {
      await query('UPDATE companies SET nip=? WHERE id=?', ['5555555555', saved.id]);
      await batch([{ sql: 'INVALID SQL' }]);
    }));
    assert.equal((await query('SELECT nip FROM companies WHERE id=?', [saved.id])).rows[0].nip, '1234567890');
    assert.equal((await companyPage('%')).total, 0);
    await upsertRegistry(Array.from({ length: 105 }, (_, i) => ({ ...fixture, registryId: `firm-${i + 3}`, nip: '', regon: undefined })), 'CEIDG');
    assert.equal((await companyPage()).companies.length, 100);
    assert.equal((await companyPage('', 'Wszystkie', 'Wszystkie', 1)).companies.length, 7);
    const ids = (await query('SELECT id FROM companies ORDER BY rowid')).rows.map(row => String(row.id));
    await batch(ids.slice(0, 100).map(id => ({sql:'INSERT INTO prospect_members VALUES (?,?)',args:['legacy',id]})));
    await batch(ids.slice(0, 8).map(id => ({sql:'INSERT INTO prospect_members VALUES (?,?)',args:['latest',id]})));
    const legacy = await companyPage('', 'Wszystkie', 'Wszystkie', 0, 'all', 'prospects');
    assert.equal(legacy.total, 100, 'Membership in two jobs must not duplicate a company');
    assert.equal(legacy.companies.length, 100);
    await query('INSERT INTO bulk_jobs(id,state,data) VALUES (?,?,?)',['latest','paused',JSON.stringify({yearly:{}})]);
    const yearly = await companyPage('', 'Wszystkie', 'Wszystkie', 0, 'all', 'prospects');
    assert.equal(yearly.total, 8, 'Yearly view must still restrict membership to the current campaign');
    const metrics=(await query('SELECT * FROM metrics WHERE id=1')).rows[0];
    assert.equal(metrics.total,107);
    await query('DELETE FROM companies WHERE id=?',[saved.id]);
    assert.equal((await query('SELECT total FROM metrics WHERE id=1')).rows[0].total,106);
    assert.equal((await query('SELECT current_schema() AS schema')).rows[0].schema,'crm');
    assert.equal(bindParameters("SELECT '?' AS literal, ? AS value, 'it''s ?' AS quoted"),"SELECT '?' AS literal, $1 AS value, 'it''s ?' AS quoted");
  } finally { await closeTestDatabase(); delete process.env.CRM_TEST_DB_PATH; }
});
