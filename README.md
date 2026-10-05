# Firmy CRM

Pierwsza wersja CRM do prospectingu firm z CEIDG i KRS.

## Co już działa

- dashboard z podsumowaniem,
- lista firm,
- wyszukiwanie po nazwie, NIP, mieście, PKD i etykietach,
- filtrowanie po kategorii PKD i statusie,
- karta firmy,
- zmiana statusu leada,
- dodawanie/usuwanie etykiet,
- notatki,
- link do strony WWW i telefonu,
- podgląd wykrytej obecności online,
- zapis zmian demonstracyjnych w `localStorage`,
- model danych Prisma przygotowany pod PostgreSQL,
- Docker Compose z PostgreSQL,
- szkielety importerów CEIDG i KRS.

## Uruchomienie wersji demonstracyjnej

Wymagany jest współczesny Node.js (zalecany Node 24 LTS).

```bash
npm install
npm run dev
```

Następnie otwórz:

```text
http://localhost:3000
```

Wersja demonstracyjna nie wymaga uruchamiania bazy danych.

## PostgreSQL

Gdy będziemy podłączać backend:

```bash
docker compose up -d
```

Skopiuj `.env.example` do `.env`:

```bash
copy .env.example .env
```

Następnie będzie można wygenerować klienta Prisma:

```bash
npm run db:generate
npm run db:validate
```

## Struktura

```text
app/
  layout.tsx
  page.tsx
  globals.css

components/
  crm-app.tsx

lib/
  mock-data.ts
  pkd.ts
  types.ts

prisma/
  schema.prisma

scripts/
  import-ceidg.ts
  import-krs.ts
```

## Architektura danych

Dane rejestrowe są rozdzielone logicznie od danych handlowych. Import lub synchronizacja CEIDG/KRS nie może usuwać:

- statusu leada,
- etykiet,
- historii kontaktów,
- notatek,
- zadań,
- informacji o zgodach/sprzeciwach marketingowych.

Model `Company` przechowuje bieżące dane firmy, natomiast dane CRM są utrzymywane w osobnych relacjach.

## Kolejny etap

1. podpięcie PostgreSQL do interfejsu,
2. API CRUD firm/tagów/notatek/kontaktów,
3. właściwy importer CEIDG,
4. właściwy importer KRS,
5. deduplikacja po NIP/REGON/KRS,
6. pełna tabela kodów PKD i mapowanie kategorii,
7. worker analizujący strony WWW i e-commerce,
8. kolejka follow-upów i historia telefonów.

## Bezpieczeństwo

Nie commituj kluczy API ani haseł. Plik `.env` jest ignorowany przez Git.
