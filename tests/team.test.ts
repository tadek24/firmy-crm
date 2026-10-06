import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeTestDatabase, query } from '../lib/database';
import { companyPage, updateCrm, upsertRegistry, CrmConflictError } from '../lib/store';
import { normalizeCeidg } from '../lib/registries';
import { canCall } from '../lib/team';

test('Shared ownership, exact labels, stale claims and edits, import preservation and filtered pagination', async () => {
  const directory = mkdtempSync(path.join(tmpdir(),'crm-team-'));
  process.env.CRM_TEST_DB_PATH = path.join(directory,'test.sqlite');
  const fixture = normalizeCeidg({ id:'team-one',nazwa:'Usługi',status:'AKTYWNY',telefon:'123456789',rokPkd:'2007',pkdGlowny:{kod:'62.01.Z',nazwa:'Oprogramowanie'} });
  try {
    const original = (await upsertRegistry([fixture],'CEIDG'))[0];
    // First generation rows remain readable and must reject clients without a revision.
    await query("UPDATE companies SET crm=json_remove(crm,'$.crmRevision','$.assignee') WHERE id=?",[original.id]);
    const legacy = (await companyPage()).companies[0];
    assert.equal(legacy.crmRevision,'0'); assert.equal(legacy.assignee,'');
    await assert.rejects(updateCrm(original.id,{assignee:'Basia'}),CrmConflictError);
    const claimed = await updateCrm(original.id,{assignee:' Tadeusz ',tags:[' Pilne ','pilne','Allegro'],crmRevision:legacy.crmRevision});
    assert.equal(claimed.assignee,'Tadeusz'); assert.deepEqual(claimed.tags,['pilne','Allegro']);
    assert.equal(canCall(claimed,'Tadeusz'),true); assert.equal(canCall(claimed,'Basia'),false); assert.equal(canCall(legacy,'Tadeusz'),false);
    await assert.rejects(updateCrm(original.id,{assignee:'Basia',crmRevision:legacy.crmRevision}),CrmConflictError);
    const called = await updateCrm(original.id,{status:'Kontakt wykonany',note:'Rozmowa zakończona',crmRevision:claimed.crmRevision});
    assert.ok(called.lastContact); assert.notEqual(called.crmRevision,claimed.crmRevision);
    await assert.rejects(updateCrm(original.id,{note:'Stary szkic',tags:[],crmRevision:claimed.crmRevision}),CrmConflictError);
    const refreshed = (await upsertRegistry([{...fixture,name:'Odświeżona'}],'CEIDG'))[0];
    assert.equal(refreshed.assignee,'Tadeusz'); assert.equal(refreshed.crmRevision,called.crmRevision); assert.equal(refreshed.note,'Rozmowa zakończona'); assert.deepEqual(refreshed.tags,called.tags);
    const page = (...extra: [string,string]) => companyPage('','Wszystkie','Wszystkie',0,'all','all',...extra);
    assert.equal((await page('unassigned','')).total,0); assert.equal((await page('person:Tadeusz','Allegro')).total,1); assert.equal((await page('person:Basia','')).total,0);
    assert.equal((await page('person:Tadeusz',"Allegro' OR 1=1 --")).total,0); assert.equal((await page('person:Tadeusz','Alleg')).total,0);
    const reassigned = await updateCrm(original.id,{assignee:'Basia',tags:['Do sprawdzenia'],crmRevision:called.crmRevision});
    assert.equal((await page('person:Tadeusz','')).total,0); assert.equal((await page('person:Basia','Do sprawdzenia')).total,1);
    const options = await page('',''); assert.deepEqual(options.assignees,['Basia']); assert.deepEqual(options.tags,['Do sprawdzenia']);
    assert.equal(canCall(reassigned,'Tadeusz'),false);
    await assert.rejects(updateCrm(original.id,{assignee:123,crmRevision:reassigned.crmRevision}),/osoba/);
    await assert.rejects(updateCrm(original.id,{assignee:'A\nB',crmRevision:reassigned.crmRevision}),/osoba/);
    const batch = await upsertRegistry(Array.from({length:105},(_,i)=>({...fixture,registryId:`team-${i+2}`})),'CEIDG');
    await query("UPDATE companies SET crm=json_set(crm,'$.assignee','Tadeusz','$.tags',json('[\"Allegro\"]')) WHERE id!=?",[original.id]);
    assert.equal(batch.length,105);
    assert.equal((await companyPage('','Wszystkie','Wszystkie',0,'phone','all','person:Tadeusz','Allegro')).companies.length,100);
    assert.equal((await companyPage('','Wszystkie','Wszystkie',1,'phone','all','person:Tadeusz','Allegro')).companies.length,5);
    assert.equal((await companyPage('','Kontakt wykonany','Wszystkie',0,'phone','all','person:Tadeusz','Allegro')).total,0);
    const empty = await updateCrm(original.id,{assignee:'',tags:[],crmRevision:reassigned.crmRevision});
    assert.equal((await page('unassigned','')).total,1); assert.equal(canCall(empty,'Basia'),false);
  } finally { closeTestDatabase(); delete process.env.CRM_TEST_DB_PATH; rmSync(directory,{recursive:true,force:true}); }
});
