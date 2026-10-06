import type { Company } from './types';

export function canCall(company: Pick<Company, 'assignee'>, person: string) {
  return Boolean(person.trim() && company.assignee && company.assignee === person.trim());
}
