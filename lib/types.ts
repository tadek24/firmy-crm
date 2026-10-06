export type LeadStatus =
  | "Nowy"
  | "Do sprawdzenia"
  | "Do kontaktu"
  | "Kontakt wykonany"
  | "Zainteresowany"
  | "Oferta wysłana"
  | "Negocjacje"
  | "Klient"
  | "Nie zainteresowany"
  | "Nie kontaktować";

export type LeadAnalysis = {
  version: number;
  checkedAt?: string;
  priority: 'Sprawdź wcześniej' | 'Standardowy' | 'Brak podstaw';
  sector: 'Usługi' | 'Handel' | 'Pozostałe';
  fitScore: number;
  fitReasons: { points: number; label: string }[];
  opportunities: { channel: 'Strona WWW' | 'Allegro' | 'Amazon / eBay'; reason: string; confidence: 'Niska' | 'Umiarkowana'; offer: string; benefit: string; questions: string[] }[];
  issues: string[];
  nextSteps: string[];
};

export type Company = {
  id: string;
  registryId: string;
  registryStatus?: string;
  syncedAt?: string;
  pkdYear?: string;
  name: string;
  source: "CEIDG" | "KRS";
  nip: string;
  regon?: string;
  krs?: string;
  city: string;
  voivodeship: string;
  pkdMain: string;
  pkdName: string;
  category: string;
  website?: string;
  analysis?: LeadAnalysis;
  phone?: string;
  email?: string;
  status: LeadStatus;
  assignee?: string;
  crmRevision?: string;
  crmUpdatedAt?: string;
  tags: string[];
  online: string[];
  lastContact?: string;
  note?: string;
};
