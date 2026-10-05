import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueSession, validPassword, validSession } from '../lib/auth';
import { checkLocalMutation } from '../lib/http';
import { normalizeCeidg, normalizeKrs, safeWebsite } from '../lib/registries';

test('Session expiry, forgery rejection, server-only password and HTTPS origin on Vercel', () => {
  process.env.CRM_PASSWORD = 'fixture-password-123'; process.env.CRM_SESSION_SECRET = 'a'.repeat(64);
  const now = Date.now(); const token = issueSession(now);
  assert.equal(validPassword('wrong'), false); assert.equal(validPassword('fixture-password-123'), true);
  assert.equal(validSession(token, now), true); assert.equal(validSession(token, now + 43200001), false);
  assert.equal(validSession(`${token}x`, now), false); assert.equal(validSession(), false);
  const previous = process.env.VERCEL; process.env.VERCEL = '1';
  const request = new Request('http://internal/api/import', { method: 'POST', headers: { host: 'firmy-crm.vercel.app', origin: 'https://firmy-crm.vercel.app', 'content-type': 'application/json' } });
  assert.doesNotThrow(() => checkLocalMutation(request));
  assert.throws(() => checkLocalMutation(new Request(request, { headers: { host: 'firmy-crm.vercel.app', origin: 'https://other.example', 'content-type': 'application/json' } })), /źródło/);
  if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
});
test('CEIDG and KRS normalization and contact safety', () => {
  const firm = normalizeCeidg({ id: 'fixture', nazwa: 'Firma', wlasciciel: { nip: '1234567890' }, www: 'example.org', email: 'mail@example.org', telefon: '+48 123456789', status: 'AKTYWNY' });
  assert.equal(firm.website, 'https://example.org/'); assert.equal(firm.phone, '+48 123456789'); assert.equal(firm.email, 'mail@example.org');
  assert.equal(safeWebsite('javascript:alert(1)'), undefined);
  const krs = { odpis: { naglowekA: { numerKRS: '0000000001' }, dane: { dzial1: { danePodmiotu: { nazwa: 'Spółka' }, siedzibaIAdres: { siedziba: { miejscowosc: 'Gdańsk' }, adresPocztyElektronicznej: 'krs@example.org' } } } } };
  assert.equal(normalizeKrs(krs, '0000000001').email, 'krs@example.org');
  assert.throws(() => normalizeKrs(krs, '0000000002'));
});
