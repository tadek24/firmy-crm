export function categorizePkd(code: string): string {
  const normalized = code.replace(/\s/g, "").toUpperCase();
  const division = Number.parseInt(normalized.slice(0, 2), 10);

  if (Number.isNaN(division)) return "Inne";

  if (division >= 10 && division <= 33) return "Produkcja";
  if (division >= 41 && division <= 43) return "Budownictwo";
  if (division >= 45 && division <= 47) return "Handel";
  if (division >= 49 && division <= 53) return "Transport i logistyka";
  if (division >= 55 && division <= 56) return "Hotelarstwo i gastronomia";
  if (division >= 58 && division <= 63) return "IT, media i komunikacja";
  if (division >= 64 && division <= 66) return "Finanse i ubezpieczenia";
  if (division === 68) return "Nieruchomości";
  if (division >= 69 && division <= 75) return "Usługi profesjonalne";
  if (division >= 77 && division <= 82) return "Usługi dla biznesu";
  if (division === 85) return "Edukacja";
  if (division >= 86 && division <= 88) return "Zdrowie i opieka";
  if (division >= 90 && division <= 96) return "Pozostałe usługi";

  return "Inne";
}
export function businessSector(pkd: string): 'Usługi' | 'Handel' | 'Pozostałe' {
  const n = Number.parseInt(pkd.slice(0, 2), 10);
  if (n >= 45 && n <= 47) return 'Handel';
  if ((n >= 41 && n <= 43) || (n >= 49 && n <= 53) || (n >= 55 && n <= 56) || (n >= 58 && n <= 66) || (n >= 68 && n <= 75) || (n >= 77 && n <= 82) || (n >= 85 && n <= 88) || (n >= 90 && n <= 96)) return 'Usługi';
  return 'Pozostałe';
}

