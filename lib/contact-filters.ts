export const contactFilters = [
  { value: 'all', label: 'Wszystkie kontakty' },
  { value: 'direct', label: 'Ma e-mail lub telefon' },
  { value: 'email', label: 'Ma e-mail' },
  { value: 'phone', label: 'Ma telefon' },
  { value: 'website', label: 'Ma stronę WWW' },
  { value: 'any', label: 'Ma e-mail, telefon lub WWW' },
  { value: 'none', label: 'Brak e-maila, telefonu i WWW' },
] as const;
export type ContactFilter = typeof contactFilters[number]['value'];
export function parseContactFilter(value: string | null): ContactFilter {
  return contactFilters.find(option => option.value === value)?.value || 'all';
}
