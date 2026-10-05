import { krsByNumber } from '../lib/registries';
import { upsertRegistry } from '../lib/store';
async function main() {
  const krs = process.argv[2]; if (!krs) throw new Error('Podaj KRS: npm run import:krs -- NUMER_KRS');
  const companies = await krsByNumber(krs); await upsertRegistry(companies, 'KRS'); console.log(`Zapisano ${companies.length} firm.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
