import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeTestDatabase, query } from '../lib/database';
import { upsertRegistry } from '../lib/store';
import { normalizeCeidg } from '../lib/registries';
import { aiConfigured, aiStatus, performAnalysis, readGeminiReport, requestAnalysis } from '../lib/ai-analysis';

const url='https://firma.example/';
const raw={summary:'Hipotezy usług WWW',website:{url,identity:'potwierdzona',evidence:'NIP w treści',findings:[{statement:'Oferta usług',sourceUrl:url}],improvements:[]},marketplaces:[{channel:'Allegro',country:'Polska',potential:'wysoki',reason:'Wymaga sprawdzenia',offer:'Integracja',requirements:[],sourceUrl:'https://invented.example/'}],questions:[],limitations:[]};
const data=(success=true)=>({candidates:[{finishReason:'STOP',content:{parts:[{text:'Nie wyświetlaj rozumowania',thought:true},{text:JSON.stringify(raw)}]},urlContextMetadata:{urlMetadata:[{retrievedUrl:url,urlRetrievalStatus:success ? 'URL_RETRIEVAL_STATUS_SUCCESS' : 'URL_RETRIEVAL_STATUS_ERROR'}]}}],usageMetadata:{promptTokenCount:10,toolUsePromptTokenCount:20,candidatesTokenCount:30,thoughtsTokenCount:40}});
test('Gemini only accepts the requested successfully retrieved URL and complete reports',()=>{
  const report=readGeminiReport(data(),url);
  assert.equal(report.website.identity,'potwierdzona'); assert.equal(report.inputTokens,30); assert.equal(report.outputTokens,70);
  assert.equal(report.provider,'gemini'); assert.equal(report.estimatedUsd,null); assert.equal(report.searchCalls,0);
  assert.equal(report.marketplaces[0].potential,'brak danych');
  for(const report of [readGeminiReport(data(false),url),readGeminiReport(data(),''),readGeminiReport(data(),'https://other.example/')]) {assert.equal(report.sources.length,0); assert.equal(report.website.findings.length,0); assert.notEqual(report.website.identity,'potwierdzona');}
  assert.throws(()=>readGeminiReport({candidates:[{finishReason:'MAX_TOKENS'}]},url));
  assert.throws(()=>readGeminiReport({...data(),promptFeedback:{blockReason:'SAFETY'}},url));
});
test('Gemini requires free-tier confirmation, throttles shared requests and never falls back to OpenAI',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'crm-gemini-'));
  process.env.CRM_TEST_DB_PATH=path.join(directory,'test.sqlite'); process.env.CRM_AI_ENABLED='true'; process.env.CRM_AI_PROVIDER='gemini'; process.env.GEMINI_API_KEY='test-key'; process.env.OPENAI_API_KEY='unused-test-key';
  const originalFetch=globalThis.fetch; let calls=0;
  try {
    assert.equal(aiConfigured(),false);
    await assert.rejects(requestAnalysis('missing'),/FREE_TIER/);
    process.env.CRM_GEMINI_FREE_TIER_CONFIRMED='true'; assert.equal(aiConfigured(),true);
    const company=(await upsertRegistry([normalizeCeidg({id:'gemini-test',nazwa:'Testowa firma',status:'AKTYWNY',www:url})],'CEIDG'))[0];
    globalThis.fetch=async(endpoint,options)=>{
      calls++; assert.match(String(endpoint),/^https:\/\/generativelanguage\.googleapis\.com\//); assert.ok(!String(endpoint).includes('test-key'));
      assert.equal((options?.headers as Record<string,string>)['x-goog-api-key'],'test-key');
      const body=JSON.parse(String(options?.body)); assert.equal(body.store,false); assert.ok(!JSON.stringify(body).includes('google_search'));
      return Response.json(data());
    };
    const job=await requestAnalysis(company.id); await performAnalysis(company.id,job.task.taskId); await performAnalysis(company.id,job.task.taskId);
    assert.equal(calls,1); assert.equal((await aiStatus(company.id))?.state,'completed'); assert.equal((await requestAnalysis(company.id)).created,false);
    await assert.rejects(requestAnalysis(company.id,true),/12 sekund/);
    await query('UPDATE ai_requests SET createdAt=?',[new Date(Date.now()-20000).toISOString()]);
    const rerun=await requestAnalysis(company.id,true);
    globalThis.fetch=async()=>{calls++; return Response.json({secret:'never expose this'}, {status:429});};
    await performAnalysis(company.id,rerun.task.taskId);
    assert.equal(calls,2); assert.equal((await aiStatus(company.id))?.state,'failed'); assert.match((await aiStatus(company.id))?.error || '',/Nie przełączamy/);
    assert.ok(!(await aiStatus(company.id))?.error?.includes('never expose'));
  } finally {
    globalThis.fetch=originalFetch; closeTestDatabase();
    for(const key of ['CRM_TEST_DB_PATH','CRM_AI_ENABLED','CRM_AI_PROVIDER','GEMINI_API_KEY','OPENAI_API_KEY','CRM_GEMINI_FREE_TIER_CONFIRMED']) delete process.env[key];
    rmSync(directory,{recursive:true,force:true});
  }
});
