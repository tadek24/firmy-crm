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
  phone?: string;
  email?: string;
  status: LeadStatus;
  tags: string[];
  online: string[];
  lastContact?: string;
  note?: string;
};
