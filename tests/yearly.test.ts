import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeTestDatabase, query } from '../lib/database';
import { companyPage, upsertRegistry, updateCrm } from '../lib/store';
import { controlBulk, bulkStatus, bulkStep } from '../lib/bulk';
import { normalizeCeidg, ceidgActivePage } from '../lib/registries';
const entry = (id: string, date?: string, extra = {}) => ({ id, nazwa: id, status: 'AKTYWNY', dataRozpoczecia: date, telefon: '123', rokPkd: '2007', pkdGlowny: { kod: '62.01.Z', nazwa: 'Oprogramowanie' }, ...extra });
test('Yearly campaign bounds upstream dates, independent quotas, existing CRM, paging, pause and exhaustion', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'crm-years-'));
  process.env.CRM_TEST_DB_PATH = path.join(directory, 'test.sqlite'); process.env.CEIDG_API_TOKEN = 'fixture-token';
  const originalFetch = globalThis.fetch;
  const clearRate = () => query('DELETE FROM api_requests');
  const today = new Date().toISOString().slice(0,10), thisYear = Number(today.slice(0,4));
  try {
    const saved = await upsertRegistry([normalizeCeidg(entry('existing-current', today)), normalizeCeidg(entry('blocked', '2020-01-01')), normalizeCeidg(entry('no-date')), normalizeCeidg(entry('future', `${thisYear + 1}-01-01`))], 'CEIDG');
    await updateCrm(saved[0].id, { crmRevision: '0', note: 'Keep this note', tags: ['Tadeusz'] });
    await updateCrm(saved[1].id, { crmRevision: '0', status: 'Nie kontaktować' });
    const legacy = await controlBulk('focus', 1);
    assert.equal(legacy.selection?.qualified, 1);
    const campaign = await controlBulk('yearly', 2, 2020, thisYear);
    assert.equal(campaign.yearly!.years.length, thisYear - 2020 + 1);
    assert.equal(campaign.yearly!.years.at(-1)!.qualified, 1, 'Existing members count without duplicate company rows');
    assert.equal(campaign.yearly!.years[0].qualified, 0);
    assert.equal(campaign.yearly!.years.at(-1)!.maxStartedAt, today);
    await assert.rejects(controlBulk('yearly', 2, 2020, thisYear), /Wstrzymaj/);
    await assert.rejects(controlBulk('yearly', 2, 2020, thisYear + 1), /zakres/);
    const requests: URL[] = [];
    globalThis.fetch = async url => {
      const parsed = new URL(String(url)); requests.push(parsed);
      if (parsed.pathname.endsWith('/firmy')) {
        const year = parsed.searchParams.get('dataod')!.slice(0,4);
        assert.equal(parsed.searchParams.get('dataod'), `${year}-01-01`);
        assert.equal(parsed.searchParams.get('datado'), Number(year) === thisYear ? today : `${year}-12-31`);
        const page = Number(parsed.searchParams.get('page'));
        if (year === '2020' && page === 0) return Response.json({ firmy: [{id:'2020-first'}, {id:'wrong-year'}, {id:'missing-date'}, {id:'blocked'}], links: { next: parsed.origin + parsed.pathname + '?status=AKTYWNY&limit=25&page=1' } });
        if (year === '2020') return Response.json({ firmy: [{id:'2020-second'}], links:{next:null} });
        if (year === '2021') return Response.json({firmy:[], links:{next:null}});
        return Response.json({firmy:[{id:`${year}-a`},{id:`${year}-b`}], links:{next:null}});
      }
      return Response.json({firma:parsed.searchParams.getAll('ids').map(id => entry(id, id === 'wrong-year' ? `${thisYear}-01-01` : id === 'missing-date' ? undefined : id === 'blocked' ? '2020-01-01' : `${id.slice(0,4)}-06-01`))});
    };
    await clearRate(); await bulkStep(); await clearRate(); await bulkStep();
    let current = (await bulkStatus())!;
    assert.equal(current.yearly!.years[0].qualified, 1); assert.equal(current.page,1);
    assert.equal((await companyPage('wrong-year')).total,0); assert.equal((await companyPage('missing-date')).total,0);
    await controlBulk('pause'); const pausedPage = (await bulkStatus())!.page;
    const before = requests.length; await clearRate(); await bulkStep(); assert.equal(requests.length,before);
    const resumed = await controlBulk('resume'); assert.equal(resumed.page,pausedPage);
    await bulkStep(campaign.id,campaign.generation); assert.equal(requests.length,before);
    for (let round=0;round<40;round++) { await clearRate(); await bulkStep(); if ((await bulkStatus())!.state==='complete') break; }
    current=(await bulkStatus())!;
    assert.equal(current.state,'complete'); assert.equal(current.yearly!.years[0].qualified,2);
    assert.equal(current.yearly!.years[1].stopReason,'exhausted'); assert.equal(current.yearly!.years[1].qualified,0);
    assert.ok(current.yearly!.years.filter(year => year.year !== 2021).every(year => year.qualified===2 && year.stopReason==='target'));
    assert.match(current.message,/mniej/);
    const allYears = await companyPage('', 'Wszystkie', 'Wszystkie', 0, 'all', 'prospects', '', '', 'yearAsc');
    assert.equal(allYears.companies[0].startedAt!.slice(0,4),'2020');
    const filtered = await companyPage('', 'Wszystkie', 'Wszystkie', 0, 'phone', 'prospects', '', '', 'yearAsc','2020');
    assert.equal(filtered.total,2); assert.ok(filtered.companies.every(firm => firm.startedAt!.startsWith('2020')));
    assert.ok(filtered.yearCounts.some(row => row.year === String(thisYear) && row.count>=2), 'Year strip ignores selected year, keeps other active filters');
    assert.equal((await companyPage('', 'Wszystkie', 'Wszystkie', 0, 'all', 'all', '', '', 'yearAsc','unknown')).total,1);
    assert.equal((await companyPage('existing-current')).companies[0].note,'Keep this note');
    assert.equal((await companyPage('existing-current')).companies[0].tags[0],'Tadeusz');
    assert.equal((await query('SELECT count(*) AS n FROM companies WHERE registryId=?',['existing-current'])).rows[0].n,1);
    assert.equal((await companyPage('', 'Wszystkie', 'Wszystkie', 0, 'all', 'all', '', '', 'fit', "2020' OR 1=1")).total,(await companyPage()).total);
    await clearRate(); globalThis.fetch = async () => Response.json({firmy:[{id:'bad'}],links:{next:'https://dane.biznes.gov.pl/api/ceidg/v3/firmy?status=AKTYWNY&dataod=2026-01-01&page=1'}});
    await assert.rejects(ceidgActivePage(0,{minStartedAt:'2020-01-01',maxStartedAt:'2020-12-31'}),/odsyłacz/);
  } finally { globalThis.fetch = originalFetch; closeTestDatabase(); rmSync(directory, {recursive:true,force:true}); }
});
