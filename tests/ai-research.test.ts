import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReport } from '../lib/ai-analysis';

const home='https://firma.example/',offer=home+'oferta',fb='https://www.facebook.com/firma';
function fixture() {
  const report={summary:'Oferta firmy',website:{url:home,identity:'potwierdzona',evidence:'Zgodny NIP',findings:[{statement:'Oferta',sourceUrl:home}],improvements:[]},marketplaces:[],questions:[],limitations:[],
    presence:[{channel:'Facebook',status:'potwierdzono',url:fb,evidence:'Publiczny profil',identityEvidence:'Link z firmowej strony',sourceUrl:home},{channel:'Instagram',status:'nie znaleziono',url:'',sourceUrl:'',evidence:'Brak wyniku',identityEvidence:''},{channel:'eBay',status:'nie znaleziono',url:'',sourceUrl:'',evidence:'Założenie modelu',identityEvidence:''}],
    websiteReview:{summary:'Wybrane strony',pages:[{name:'Główna',url:home,status:'sprawdzono treść',finding:'Oferta'},{name:'Oferta',url:offer,status:'sprawdzono treść',finding:'Dane z wyszukiwarki'},{name:'Zmyślona',url:home+'fake',status:'sprawdzono treść',finding:'Niepoparty fakt'}],notChecked:[]},
    offers:[{priority:'wysoki',service:'Rezerwacje',reason:'Hipoteza',benefit:'Kontakt',basis:'fakt',sourceUrl:'https://invented.example/',question:'Czy przyjmujecie rezerwacje?'}]};
  const data={status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',queries:['Firma Warszawa Instagram'],sources:[{title:'Firma',url:home},{title:'Oferta',url:offer},{title:'Profil',url:fb}]}},{type:'web_search_call',status:'completed',action:{type:'open_page',url:home}},{type:'message',content:[{type:'output_text',text:''}]}],usage:{input_tokens:1000,output_tokens:1000}};
  const response=()=>{data.output[2].content![0].text=JSON.stringify(report);return data;};
  return {report,data,response};
}
test('Research proves channel checks and page coverage from tool output, with missing channels explicit',()=>{
  const {response}=fixture(); const result=readReport(response(),true);
  assert.equal(result.analysisVersion,2); assert.equal(result.presence?.length,8);
  assert.equal(result.presence?.find(v=>v.channel==='Facebook')?.status,'potwierdzono');
  assert.equal(result.presence?.find(v=>v.channel==='Instagram')?.status,'nie znaleziono');
  assert.equal(result.presence?.find(v=>v.channel==='eBay')?.status,'nie sprawdzono');
  assert.equal(result.presence?.find(v=>v.channel==='Amazon')?.status,'nie sprawdzono');
  assert.deepEqual(result.websiteReview?.pages.map(v=>v.status),['sprawdzono treść','wynik wyszukiwania','nie sprawdzono']);
  assert.equal(result.websiteReview?.pages[2].url,''); assert.equal(result.offers?.[0].basis,'hipoteza');
  assert.equal(result.searchCalls,1); assert.equal(result.searchQueries?.length,1);
});
test('Research refuses invented or mismatched profile links and unconfirmed website findings',()=>{
  for(const change of [(r:ReturnType<typeof fixture>['report'])=>{r.presence[0].url='https://facebook.com.attacker.example/firma';},(r:ReturnType<typeof fixture>['report'])=>{r.presence[0].identityEvidence='';},(r:ReturnType<typeof fixture>['report'])=>{r.presence[0].url=home;}]) {
    const {report,data,response}=fixture(); change(report); data.output[0].action!.sources!.push({title:'Wrong URL',url:report.presence[0].url});
    const result=readReport(response(),true); assert.equal(result.presence?.[0].status,'nie sprawdzono'); assert.equal(result.presence?.[0].url,'');
  }
  const {report,response}=fixture(); report.website.identity='niepotwierdzona';
  const result=readReport(response(),true); assert.ok(result.websiteReview?.pages.every(v=>v.status==='nie sprawdzono'));
  assert.equal(result.website.findings.length,0);
});
test('Research rejects incomplete extended reports while legacy reports stay readable',()=>{
  const {report,response}=fixture(); delete (report as Partial<typeof report>).websiteReview;
  assert.throws(()=>readReport(response(),true),/rozszerzony raport/);
  delete (report as Partial<typeof report>).presence; delete (report as Partial<typeof report>).offers;
  assert.equal(readReport(response()).analysisVersion,undefined);
  assert.throws(()=>readReport(response(),true),/rozszerzony raport/);
});
