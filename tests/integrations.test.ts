import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeCeidg, normalizeKrs, ceidgByNip, krsByNumber, safeWebsite } from '../lib/registries';
import { db, listCompanies, upsertRegistry, updateCrm } from '../lib/store';
import { checkLocalMutation } from '../lib/http';

test('Browser origin is checked against incoming host, including loopback aliases', () => {
  const request = new Request('http://localhost:3219/api/import', { method: 'POST', headers: { host: '127.0.0.1:3219', origin: 'http://127.0.0.1:3219', 'content-type': 'application/json' } });
  assert.doesNotThrow(() => checkLocalMutation(request));
  assert.throws(() => checkLocalMutation(new Request(request, { headers: { host: '127.0.0.1:3219', origin: 'https://another.example', 'content-type': 'application/json' } })), /źródło/);
});

test('Registry import, persistence, deduplication, CRM preservation and error handling', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'crm-test-'));
  process.env.CRM_DB_PATH = path.join(directory, 'test.sqlite');
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.CEIDG_API_TOKEN;
  try {
    assert.equal(listCompanies().length, 0);
    const fixture = { id: 'fixture-id', nazwa: 'Fixture', wlasciciel: { nip: '1234567890', regon: '123456789' }, adresDzialalnosci: { miasto: 'Warszawa' }, pkdGlowny: { kod: '6201Z', nazwa: 'Programowanie' }, www: 'example.org', rokPkd: '2007', status: 'AKTYWNY' };
    const normalized = normalizeCeidg(fixture);
    assert.equal(normalized.website, 'https://example.org/');
    assert.equal(normalized.pkdMain, '6201Z');
    const saved = upsertRegistry([normalized], 'CEIDG')[0];
    updateCrm(saved.id, { note: 'Keep this note', tags: ['Prospekt'], status: 'Do kontaktu' });
    upsertRegistry([normalizeCeidg({ ...fixture, nazwa: 'Changed registry name' })], 'CEIDG');
    assert.equal(listCompanies().length, 1);
    assert.equal(listCompanies()[0].note, 'Keep this note');
    assert.equal(listCompanies()[0].status, 'Do kontaktu');
    assert.equal(listCompanies()[0].name, 'Changed registry name');
    assert.throws(() => updateCrm(saved.id, { source: 'KRS' }));
    assert.throws(() => updateCrm(saved.id, { status: 'Invalid' }));
    const second = normalizeCeidg({ ...fixture, id: 'second-id', wlasciciel: { nip: '9999999999', regon: '999999999' } });
    upsertRegistry([second], 'CEIDG');
    assert.throws(() => upsertRegistry([{ ...normalized, regon: '999999999' }], 'CEIDG'), /Konflikt/);
    assert.equal(listCompanies().length, 2);
    assert.equal(safeWebsite('javascript:alert(1)'), undefined);
    const krsFixture = { odpis: { naglowekA: { numerKRS: '0000000001' }, dane: { dzial1: { danePodmiotu: { nazwa: 'KRS fixture', identyfikatory: { nip: '1234567890' } }, siedzibaIAdres: { siedziba: { miejscowosc: 'Gdańsk' } } }, dzial3: { przedmiotDzialalnosci: { przedmiotPrzewazajacejDzialalnosci: [{ kodDzial: '62', kodKlasa: '01', kodPodklasa: 'Z', opis: 'Programowanie' }] } } } } };
    const krs = normalizeKrs(krsFixture, '0000000001');
    upsertRegistry([krs], 'KRS');
    assert.equal(listCompanies().length, 2);
    assert.equal(listCompanies().find(c => c.id === saved.id)?.note, 'Keep this note');
    assert.throws(() => normalizeKrs(krsFixture, '0000000002'));
    delete process.env.CEIDG_API_TOKEN;
    await assert.rejects(ceidgByNip('1234567890'), /CEIDG_API_TOKEN/);
    await assert.rejects(krsByNumber('not-a-number'), /KRS/);
    process.env.CEIDG_API_TOKEN = 'test-token';
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(String(url)).pathname, '/api/ceidg/v3/firma');
      assert.equal(new URL(String(url)).searchParams.get('nip'), '1234567890');
      assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer test-token');
      return Response.json({ firma: [fixture] });
    };
    assert.equal((await ceidgByNip('1234567890')).length, 1);
    await assert.rejects(ceidgByNip('1234567890'), /Limit CEIDG/);
    db().exec('DELETE FROM api_requests');
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.deepEqual(await ceidgByNip('1234567890'), []);
    db().exec('DELETE FROM api_requests');
    globalThis.fetch = async () => new Response(null, { status: 401 });
    await assert.rejects(ceidgByNip('1234567890'), /odrzucił token/);
    globalThis.fetch = async url => { assert.match(String(url), /OdpisAktualny\/0000000001\?rejestr=P&format=json/); return Response.json(krsFixture); };
    assert.equal((await krsByNumber('1'))[0].krs, '0000000001');
    globalThis.fetch = async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
    await assert.rejects(krsByNumber('1'), (error: unknown) => (error as { retryAfter: string }).retryAfter === '60');
    globalThis.fetch = async () => new Response('invalid-json', { status: 200 });
    await assert.rejects(krsByNumber('1'), /format/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.CEIDG_API_TOKEN; else process.env.CEIDG_API_TOKEN = originalToken;
    db().close(); rmSync(directory, { recursive: true, force: true });
  }
});
