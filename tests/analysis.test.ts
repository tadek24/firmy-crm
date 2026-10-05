import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCompany } from '../lib/analysis';
import type { Company } from '../lib/types';
const fixture: Company = { id: 'fixture', registryId: 'fixture', name: 'Fixture', source: 'CEIDG', registryStatus: 'AKTYWNY', nip: '', city: 'Gdańsk', voivodeship: '', pkdMain: '62.01.Z', pkdName: 'Działalność związana z oprogramowaniem', pkdYear: '2007', category: '', status: 'Nowy', tags: [], online: [] };
test('Service suggestions distinguish undeclared WWW from actual absence; no unsupported marketplace lead', () => {
  const analysis = analyzeCompany(fixture);
  assert.deepEqual(analysis.opportunities.map(item => item.channel), ['Strona WWW']);
  assert.ok(analysis.issues.some(issue => /może mieć stronę/.test(issue)));
  assert.equal(analyzeCompany({ ...fixture, website: 'https://example.org' }).opportunities.length, 0);
  assert.equal(analyzeCompany({ ...fixture, pkdMain: '', pkdName: '' }).priority, 'Brak podstaw');
  assert.equal(analyzeCompany({ ...fixture, registryStatus: 'ZAWIESZONY' }).opportunities.length, 0);
});
test('Retail signals are conditional, and PKD 2025 intermediaries and restricted goods are excluded', () => {
  const retail = { ...fixture, pkdMain: '47.71.Z', pkdName: 'Sprzedaż detaliczna odzieży', email: 'fixture@example.org' };
  const analysis = analyzeCompany(retail);
  assert.deepEqual(analysis.opportunities.map(item => item.channel), ['Strona WWW', 'Allegro', 'Amazon / eBay']);
  assert.equal(analysis.priority, 'Sprawdź wcześniej');
  assert.match(analysis.opportunities[2].reason, /nie potwierdza eksportu/);
  assert.equal(analyzeCompany({ ...retail, pkdName: 'Sprzedaż detaliczna paliw' }).opportunities.length, 1);
  assert.equal(analyzeCompany({ ...retail, pkdMain: '47.91.Z', pkdYear: '2025', pkdName: 'Pośrednictwo w sprzedaży detalicznej niewyspecjalizowanej' }).opportunities.length, 1);
  assert.equal(analyzeCompany({ ...retail, pkdMain: '47.91.Z', pkdYear: '2007', pkdName: 'Sprzedaż detaliczna przez Internet' }).opportunities.length, 3);
  assert.equal(analyzeCompany({ ...retail, pkdMain: '47.91.Z', pkdYear: undefined }).opportunities.length, 1);
});
