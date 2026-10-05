import { ceidgByNip } from '../lib/registries';
import { upsertRegistry } from '../lib/store';
async function main() {
  const nip = process.argv[2]; if (!nip) throw new Error('Podaj NIP: npm run import:ceidg -- NUMER_NIP');
  const companies = await ceidgByNip(nip); upsertRegistry(companies, 'CEIDG'); console.log(`Zapisano ${companies.length} firm.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
