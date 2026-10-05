# Firmy CRM

Lokalny CRM z rzeczywistymi danymi rejestrowymi. Pusta baza przy pierwszym uruchomieniu; tabela firm i panel pracy zamiast dashboardu z kartami.

## Uruchomienie

Wymagany Node.js 24.14 lub nowszy (lokalna baza korzysta z `node:sqlite`).

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Otwórz http://localhost:3000. Serwer nasłuchuje tylko na 127.0.0.1. Aplikacja przeznaczona jest do pracy lokalnej jednego użytkownika, bez logowania. Nie wystawiaj jej publicznie bez dodania autoryzacji.

Nie nadpisuj istniejącego `.env`. Dane zapisują się w `data/crm.sqlite`; wykonuj kopie całego katalogu `data` przy zatrzymanym serwerze. SQLite jest rzeczywistym magazynem aplikacji. Model Prisma/PostgreSQL pozostaje projektem przyszłej migracji, obecnie nie obsługuje interfejsu.

## CEIDG API v3

Dokumentację sprawdzono 05.10.2026 na https://akademia.biznes.gov.pl/portal/004856. Aktualnie podlinkowany pakiet: https://pliki.biznes.gov.pl/akademia/20260422/Dokumentacja_dla_integratorow_API_HD_v3.7z — PDF v1.4 z 27.11.2025 oraz OpenAPI JSON.

Po rejestracji w Hurtowni Danych (https://dane.biznes.gov.pl) otrzymujesz klucz API. Wpisz go samodzielnie w `.env` jako `CEIDG_API_TOKEN`, następnie uruchom ponownie serwer. Token nigdy nie jest zwracany do przeglądarki. UI pokazuje jedynie obecność konfiguracji, nie potwierdza ważności klucza.

Pobieranie szczegółów po NIP: `GET https://dane.biznes.gov.pl/api/ceidg/v3/firma?nip=…`, nagłówek `Authorization: Bearer JWT`. Odpowiedź zawiera tablicę `firma`. Endpoint `/firmy` zwraca listę skróconą; bieżący import celowo korzysta z `/firma`, aby pobrać PKD i dostępne kontakty jednym zapytaniem. PDF v1.4 podaje limit 1000 żądań / 60 minut. Lokalny licznik zapisany w SQLite ogranicza tę aplikację do 1000 żądań na godzinę i odstępu 3,6 s. Inne aplikacje używające tego samego tokenu współdzielą limit dostawcy. HTTP 429 jest przekazywany z Retry-After; nie wykonujemy automatycznych ponowień.

## KRS

Oficjalna dokumentacja: https://prs.ms.gov.pl/krs/openApi.
`GET https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr=P&format=json` nie wymaga tokenu. Numer jest uzupełniany zerami do 10 cyfr. Import obejmuje rejestr przedsiębiorców P, nie rejestr stowarzyszeń S. Publiczne API odpisów nie wyszukuje numeru KRS na podstawie NIP lub nazwy. API udostępnia także odpis pełny i biuletyny zmian; harmonogram i import masowy nie są częścią tej wersji.

## Trwałość i synchronizacja

`GET /api/companies`, `POST /api/import` (source, identifier), `PATCH /api/companies/{id}` (status, tags, note).
Zapisy są transakcyjne. Ponowne pobranie dopasowuje rekord po identyfikatorze rejestru, NIP, REGON lub KRS i zachowuje status leada, etykiety, notatkę. Konflikt między kilkoma rekordami blokuje cały zapis. Brak kontaktu w rejestrze pozostaje pusty — nie generujemy danych ani domniemanej obecności online. Stan działalności w CEIDG jest oddzielny od statusu handlowego. Kategoria PKD jest przybliżonym grupowaniem działów; nie jest pełnym słownikiem PKD 2007/2025.

## Weryfikacja i import z terminala

```powershell
npm run lint
npm run build
npm run test:integrations
npm run import:krs -- 0000000000
npm run import:ceidg -- 0000000000
```

Importery pojedynczych firm wymagają numeru. Import automatyczny CEIDG nie wymaga NIP-u ani daty założenia. `.env` i lokalna baza są ignorowane przez Git. Testy używają osobnej bazy tymczasowej i kontrolowanych odpowiedzi API; nie zasilają bazy CRM. Pełny test CEIDG online wymaga własnego tokenu użytkownika.

## Automatyczny import wszystkich aktywnych firm CEIDG

W zakładce **Rejestry i import** użyj **Pobierz wszystkie aktywne firmy**. Przycisk wymaga tokenu w `.env`. Zakres to cała Polska, wszystkie daty rozpoczęcia działalności i status `AKTYWNY`. Nie obejmuje spółek zarejestrowanych wyłącznie w KRS. Publiczne API KRS nie udostępnia równoważnego przeglądania całego rejestru według statusu; biuletyny zmian nie są pełną bazą wszystkich istniejących spółek.

Importer pobiera strony `/firmy?status=AKTYWNY&limit=50&page=…`, a następnie szczegóły przez `/firma?ids=…&ids=…` w partiach do 25 identyfikatorów. Parametr `ids` jest powtarzany bez nawiasów, zgodnie z dokumentacją v1.4. Nie pobieramy listy skróconej jako substytutu pełnych danych kontaktowych. W rejestrze kontakty są opcjonalne; importer nie gwarantuje ich dostępności i nie przeszukuje stron WWW w poszukiwaniu brakujących kontaktów.

Proces działa oddzielnie od żądań przeglądarki, z ukrytym oknem na Windows. Można zamknąć kartę; komputer i proces muszą pozostać uruchomione. Pauza kończy rozpoczętą partię, następnie zatrzymuje pobieranie. Po wyłączeniu komputera otwarcie zakładki importu wznowi zadanie w stanie `running` od zapisanej pozycji po wygaśnięciu blokady workera (maksymalnie 60 s). Zadania `paused` i `failed` wymagają przycisku **Wznów**.

Pozycja kolejki i dane firmy zapisują się w jednej transakcji. Błąd zapisu zachowuje partię do ponowienia. Tylko jeden worker ma aktywną blokadę w SQLite. Odstęp między wywołaniami wynosi co najmniej 4 s; limit godzinowy i `Retry-After` powodują oczekiwanie. Błędy przejściowe są ponawiane z rosnącą przerwą, do 10 prób. Błędny token i konflikty danych zatrzymują zadanie do sprawdzenia. Nie ustawiamy automatycznego harmonogramu ponownych pełnych importów; po zakończeniu można uruchomić nowy przebieg przyciskiem.

Stan aktywności może zmienić się między pobraniem listy i szczegółów; nieaktywne oraz nieudostępnione szczegóły są pomijane i liczone. API listy nie zapewnia zamrożonego obrazu całego rejestru: import trwający wiele dni jest przebiegiem po zmieniających się danych, a nie gwarantowanym snapshotem. Licznik zapisanych wpisów obejmuje aktualizacje i jest odrębny od liczby unikalnych firm w CRM. Zachowujemy pełny zestaw kontaktów udostępniony w bieżącej odpowiedzi; braki nie są uzupełniane domysłami.

Tabela CRM korzysta z paginacji po 100 rekordów, wyszukiwania i filtrów po stronie serwera. Liczniki całości i kontaktów są aktualizowane transakcyjnie przez SQLite. Nie przesyłamy całej bazy do przeglądarki.

Ręczne uruchomienie procesu kolejki (np. do diagnostyki):

```powershell
npm run import:worker
```

Proces odczytuje zapisane zadanie; nie tworzy nowego zadania samodzielnie. Kompletna lokalna instalacja musi zawierać `tsx` (`npm ci` bez `--omit=dev`). `GET /api/import/bulk` pokazuje postęp, `POST /api/import/bulk` przyjmuje `action`: `start`, `pause`, `resume`. Nowy przebieg nie usuwa istniejących firm ani danych CRM. Przy ponownym pobraniu nieaktywnego wpisu stare dane w CRM nie są automatycznie kasowane.

Kontrola zależności wykazała 9 ostrzeżeń wysokiego poziomu w zależnościach narzędzi developerskich Prisma i ESLint. Nie dotyczą zależności uruchomieniowych aplikacji; automatyczna naprawa proponuje cofnięcie głównych wersji i wymaga osobnej migracji. Nie wykonano `audit fix --force`.
