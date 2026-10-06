import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeTestDatabase } from '../lib/database';
import { upsertRegistry, updateCrm, getCompany } from '../lib/store';
import { normalizeCeidg } from '../lib/registries';
import { aiStatus, aiUsage, performAnalysis, publicProfile, publicUrl, readReport, requestAnalysis } from '../lib/ai-analysis';

const source = 'https://firma.example/oferta';
const report = { summary:'Dopasowanie usług WWW',website:{url:source,identity:'potwierdzona',evidence:'NIP w źródle',findings:[{statement:'Oferta usług',sourceUrl:source},{statement:'Niepoparty fakt',sourceUrl:'https://invented.example/'}],improvements:[{action:'Formularz zapytań',benefit:'Ułatwienie kontaktu',basis:'fakt',sourceUrl:'https://invented.example/'}]},marketplaces:[{channel:'Allegro',country:'Polska',potential:'wysoki',reason:'Hipoteza',offer:'Integracja',requirements:['Sprawdzić asortyment'],sourceUrl:'https://invented.example/'}],questions:['Jaki jest asortyment?'],limitations:['Nie mierzono wydajności'] };
const responseData = () => ({ status:'completed',output:[{type:'web_search_call',action:{type:'search',sources:[{title:'Oferta firmy',url:source}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(report)}]}],usage:{input_tokens:10000,output_tokens:2000} });

test('AI source validation removes unsupported facts and marks unsupported opportunities as unknown', () => {
  const result = readReport(responseData());
  assert.equal(result.website.findings.length,1); assert.equal(result.website.improvements[0].basis,'hipoteza');
  assert.equal(result.marketplaces[0].potential,'brak danych'); assert.equal(result.searchCalls,1);
  assert.ok(Math.abs((result.estimatedUsd || 0)-0.0265)<1e-10);
  assert.equal(publicUrl('http://127.0.0.1/test'),''); assert.equal(publicUrl('https://user:password@firma.example'),'');
  assert.throws(() => readReport({status:'incomplete'}));
  assert.throws(() => readReport({...responseData(),output:responseData().output.slice(1)}),/źródeł/);
});
test('AI budget reservation, repeated clicks, saved reports, privacy, failures and import preservation', async () => {
  const directory=mkdtempSync(path.join(tmpdir(),'crm-ai-')); process.env.CRM_TEST_DB_PATH=path.join(directory,'test.sqlite');
  process.env.CRM_AI_ENABLED='true'; process.env.OPENAI_API_KEY='test-only-not-a-real-key'; process.env.CRM_AI_DAILY_LIMIT='2';
  const originalFetch=globalThis.fetch; let calls=0;
  try {
    const fixture=normalizeCeidg({id:'ai-test',nazwa:'Usługi testowe',status:'AKTYWNY',telefon:'123456789',email:'private@example.com',rokPkd:'2007',pkdGlowny:{kod:'62.01.Z',nazwa:'Oprogramowanie'}});
    const company=(await upsertRegistry([fixture],'CEIDG'))[0];
    const edited=await updateCrm(company.id,{note:'Prywatne ustalenia',assignee:'Basia',tags:['Pilne'],crmRevision:company.crmRevision || '0'});
    const serialized=JSON.stringify(publicProfile(edited));
    for (const privateValue of ['Prywatne ustalenia','Basia','Pilne','private@example.com','123456789','test-only-not-a-real-key']) assert.ok(!serialized.includes(privateValue));
    globalThis.fetch=async (url,options) => {
      calls++; assert.equal(String(url),'https://api.openai.com/v1/responses');
      const body=JSON.parse(String(options?.body)); assert.equal(body.store,false); assert.equal(body.max_tool_calls,3);
      assert.equal(body.input,serialized);
      return Response.json(responseData());
    };
    const first=await requestAnalysis(company.id); const repeated=await requestAnalysis(company.id);
    assert.equal(first.created,true); assert.equal(repeated.created,false); assert.equal(first.task.taskId,repeated.task.taskId); assert.equal(await aiUsage(),1);
    await performAnalysis(company.id,first.task.taskId); await performAnalysis(company.id,first.task.taskId);
    assert.equal(calls,1); assert.equal((await aiStatus(company.id))?.state,'completed');
    assert.equal((await requestAnalysis(company.id)).created,false); assert.equal(await aiUsage(),1);
    await upsertRegistry([{...fixture,name:'Odświeżona firma'}],'CEIDG');
    assert.equal((await aiStatus(company.id))?.report?.summary,report.summary);
    const preserved=await getCompany(company.id); assert.equal(preserved?.note,edited.note); assert.equal(preserved?.crmRevision,edited.crmRevision);
    const refresh=await requestAnalysis(company.id,true); assert.equal(refresh.created,true); assert.equal(await aiUsage(),2);
    globalThis.fetch=async () => {calls++; return Response.json({error:'must not leak API response'}, {status:401});};
    await performAnalysis(company.id,refresh.task.taskId); await performAnalysis(company.id,refresh.task.taskId);
    const failed=await aiStatus(company.id); assert.equal(failed?.state,'failed'); assert.match(failed?.error || '',/klucz API/); assert.ok(!failed?.error?.includes('must not leak'));
    assert.equal(calls,2);
    await assert.rejects(requestAnalysis(company.id,true),/limit 2/);
    delete process.env.OPENAI_API_KEY; await assert.rejects(requestAnalysis(company.id),/OPENAI_API_KEY/);
  } finally {
    globalThis.fetch=originalFetch; closeTestDatabase();
    for(const key of ['CRM_TEST_DB_PATH','CRM_AI_ENABLED','OPENAI_API_KEY','CRM_AI_DAILY_LIMIT'])delete process.env[key];
    rmSync(directory,{recursive:true,force:true});
  }
});
