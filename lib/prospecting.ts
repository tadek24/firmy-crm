import { analyzeCompany } from './analysis';
import { businessSector } from './pkd';
import type { Company } from './types';
type ProspectingOptions = { minStartedAt?: string; maxStartedAt?: string };
export function qualifiesForProspecting(company: Pick<Company, 'source' | 'registryStatus' | 'pkdMain' | 'pkdName' | 'pkdYear' | 'syncedAt' | 'city' | 'website' | 'email' | 'phone' | 'startedAt'> & { status?: Company['status'] }, options: ProspectingOptions = {}) {
  if (company.source !== 'CEIDG' || company.registryStatus !== 'AKTYWNY' || !((company.email || '').trim() || (company.phone || '').trim())) return false;
  if (options.minStartedAt && (!company.startedAt || company.startedAt < options.minStartedAt)) return false;
  if (options.maxStartedAt && (!company.startedAt || company.startedAt > options.maxStartedAt)) return false;
  if (company.status && ['Nie kontaktować', 'Nie zainteresowany', 'Klient'].includes(company.status)) return false;
  return businessSector(company.pkdMain) !== 'Pozostałe' && analyzeCompany(company).opportunities.length > 0;
}
