import type { Company } from './types';
export type TeamPerson = { id: string; name: string; active: boolean };
export type TeamUser = { id: string; login: string; name: string; role: 'admin' | 'member'; active: boolean; personId: string; revision: string };
export type CurrentUser = TeamUser & { person: string };

export function canCall(company: Pick<Company, 'assignee'>, person: string) {
  return Boolean(person.trim() && company.assignee && company.assignee === person.trim());
}
