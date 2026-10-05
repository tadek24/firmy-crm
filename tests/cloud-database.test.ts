import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { query, transaction, batch } from '../lib/database';
import { normalizeCeidg } from '../lib/registries';
import { companyPage, upsertRegistry, updateCrm } from '../lib/store';

test('Turso HTTP protocol: authenticated queries, transaction rollback, contacts, deduplication and CRM preservation', async () => {
  process.env.TURSO_DATABASE_URL = 'libsql://database.turso.io'; process.env.TURSO_AUTH_TOKEN = 'fixture-db-token';
  delete process.env.CRM_TEST_DB_PATH;
  const database = new DatabaseSync(':memory:'); const originalFetch = globalThis.fetch;
  let open = false, requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++; assert.equal(String(url), 'https://database.turso.io/v2/pipeline');
    assert.equal((options?.headers as Record<string,string>).Authorization, 'Bearer fixture-db-token');
    const body = JSON.parse(String(options?.body));
    if (open) assert.equal(body.baton, 'transaction-baton');
    const results = body.requests.map((request: { type: string; stmt?: { sql: string; args: { type: string; value: string }[] } }) => {
      if (request.type === 'close') { open = false; return { type: 'ok', response: { type: 'close' } }; }
      try {
        const statement = request.stmt!;
        if (statement.sql.startsWith('BEGIN')) open = true;
        if (statement.sql === 'COMMIT' || statement.sql === 'ROLLBACK') open = false;
        const prepared = database.prepare(statement.sql);
        const args = (statement.args || []).map(value => value.type === 'null' ? null : value.type === 'integer' || value.type === 'float' ? Number(value.value) : value.value);
        const read = /^\s*(SELECT|WITH)/i.test(statement.sql);
        const rows = read ? prepared.all(...args) : [];
        const columns = read ? prepared.columns().map(column => ({ name: column.name })) : [];
        const changes = read ? 0 : Number(prepared.run(...args).changes);
        return { type: 'ok', response: { type: 'execute', result: { cols: columns, rows: rows.map(row => columns.map(column => { const value = row[column.name]; return value === null ? { type: 'null' } : { type: typeof value === 'number' || typeof value === 'bigint' ? 'integer' : 'text', value: String(value) }; })), affected_row_count: changes } } };
      } catch { return { type: 'error' }; }
    });
    return Response.json({ baton: open ? 'transaction-baton' : null, base_url: null, results });
  };
  try {
    assert.equal((await companyPage()).total, 0);
    const fixture = normalizeCeidg({ id: 'firm-one', nazwa: 'Łódź', status: 'AKTYWNY', wlasciciel: { nip: '1234567890' }, www: 'example.org', email: 'a@example.org', telefon: '123456789' });
    const saved = (await upsertRegistry([fixture], 'CEIDG'))[0];
    await updateCrm(saved.id, { note: 'Keep note', status: 'Do kontaktu', tags: ['Łódź'] });
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
    assert.ok(requests < 70, 'Batch operations must not make one network request per company');
    assert.equal(open, false);
  } finally { globalThis.fetch = originalFetch; database.close(); }
});
