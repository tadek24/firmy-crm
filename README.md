# Firmy CRM na Vercel

CRM z rzeczywistymi danymi CEIDG i KRS, trwałą bazą Turso i importem w tle obsługiwanym przez Vercel Workflow. Przeglądarka ani komputer użytkownika nie muszą pozostawać włączone.

## Konfiguracja

1. W projekcie Vercel otwórz Storage, utwórz bazę Turso i połącz ją z projektem. Integracja ustawia `TURSO_DATABASE_URL` oraz `TURSO_AUTH_TOKEN`.
2. W Settings → Environment Variables dodaj `CEIDG_API_TOKEN`, `CRM_PASSWORD` (minimum 12 znaków) i `CRM_SESSION_SECRET` (losowy sekret minimum 32 znaki). Wybierz Production oraz używane środowisko Preview.
3. Wykonaj ponowne wdrożenie. Istniejące wdrożenia nie otrzymują nowych zmiennych automatycznie.
4. Zaloguj się do CRM i wybierz Rejestry i import. Import pojedynczej firmy sprawdza token online; obecność konfiguracji sama nie potwierdza jego ważności.

Sekrety przechowuj wyłącznie w Vercel lub lokalnym `.env`. Nie wpisuj ich do `.env.example`, kodu, opisu PR ani GitHub. Baza tworzy tabele przy pierwszym połączeniu. Publiczne API CRM wymaga podpisanej sesji, hasło i tokeny pozostają na serwerze. Sesja trwa 12 godzin, cookie jest HttpOnly i SameSite=Strict, na Vercel także Secure. Próby logowania mają współdzielony limit 15 na 5 minut. Zmiana hasła lub sekretu sesji jest operacją administracyjną w panelu Vercel; zmiana samego hasła nie unieważnia wcześniejszych sesji — w tym celu zmień też CRM_SESSION_SECRET.

## Import automatyczny

Import obejmuje wszystkie aktywne wpisy CEIDG, bez ograniczenia daty rozpoczęcia działalności. Lista `/firmy?status=AKTYWNY&limit=25&page=…` jest uzupełniana szczegółami `/firma?ids=…` w partiach do 25. Zapis firmy i pozycji kolejki odbywa się w jednej transakcji. Wznowienie zachowuje postęp. Pauza unieważnia poprzednią generację zadania: odpowiedź rozpoczętego wcześniej zapytania nie przesuwa już kursora. Notatki, etykiety i status handlowy są zachowywane przy odświeżaniu danych.

Workflow wykonuje krótkie serie pobrań, a następnie usypia w chmurze. Co 100 serii uruchamia kolejny przebieg od trwałego punktu zapisu, aby nie przekraczać limitów liczby zdarzeń jednego Workflow. Blokada w bazie zapobiega jednoczesnemu przetwarzaniu przez dwa procesy. Limit aplikacji to maksymalnie 1000 zapytań na godzinę z odstępem minimum 3,6 sekundy; pętla czeka minimum 4 sekundy. Inne aplikacje z tym samym tokenem współdzielą limit CEIDG. HTTP 429 respektuje Retry-After, błędy przejściowe mają do 10 ponowień, odrzucony token i konflikt danych zatrzymują import. Awaria Workflow pozostawia punkt zapisu; można wstrzymać i wznowić import w interfejsie, po sprawdzeniu błędu w panelu Workflows na Vercel.

Ogólnopolski import może trwać wiele dni i podlega limitom pojemności, operacji oraz zasobów wybranego planu Turso/Vercel. Przekroczenie limitów bezpłatnego planu wymaga odczekania lub świadomej zmiany planu; aplikacja nie kupuje abonamentów. Postęp i firmy pozostają w bazie. Rejestr zmienia się w czasie pobierania, więc nie jest to zamrożony obraz danych. Nieaktywne lub nieudostępnione szczegóły są pomijane. WWW, e-mail i telefon są opcjonalne i zapisujemy wyłącznie kontakty udostępnione przez przedsiębiorcę. Nie dopowiadamy adresów i nie przeszukujemy stron WWW.

## CEIDG i KRS

CEIDG: API v3, nagłówek `Authorization: Bearer JWT`, dokumentacja https://akademia.biznes.gov.pl/portal/004856 i pakiet https://pliki.biznes.gov.pl/akademia/20260422/Dokumentacja_dla_integratorow_API_HD_v3.7z (PDF v1.4 z 27.11.2025). Szczegóły po NIP: `/api/ceidg/v3/firma?nip=…`.

KRS: https://prs.ms.gov.pl/krs/openApi, `/api/krs/OdpisAktualny/{krs}?rejestr=P&format=json`, bez tokenu. Numer KRS jest uzupełniany do 10 cyfr. Import ogólnopolski CEIDG nie obejmuje spółek wpisanych wyłącznie do KRS; import KRS wymaga konkretnego numeru.

## Weryfikacja i rozwój

Node.js 24.14+. `npm install`, `npm run lint`, `npm run test:integrations`, `npm run build`. Vercel instaluje bibliotekę Workflow i generuje wewnętrzne trasy `.well-known/workflow` podczas budowania. Generowane trasy są ignorowane przez Git. Testy używają kontrolowanych odpowiedzi rejestrów oraz osobnej bazy tymczasowej; sprawdzają także oficjalny protokół Turso HTTP, transakcje, kontakty, deduplikację, sesje i przerwanie zadania podczas zapytania. Nie zapisują danych demonstracyjnych w CRM.

Archiwalne pliki Prisma i docker-compose nie obsługują tej aplikacji. Magazyn produkcyjny korzysta z Turso przez SQL over HTTP: https://docs.turso.tech/sdk/http/reference. Checkpointy, limiter i blokady są wspólne dla wszystkich instancji Vercel, a nie zapisywane na dysku funkcji. Testowy SQLite może być włączony przez CRM_TEST_DB_PATH tylko poza Vercel.

## Automatyczna analiza firm
Każdy import CEIDG i KRS zapisuje analizę z danych rejestrowych. Tabela pokazuje priorytet sprawdzenia, możliwe kanały (WWW, Allegro, Amazon / eBay) i liczbę uwag do danych. Szczegóły zawierają uzasadnienia, ograniczenia, datę źródła oraz listę rzeczy do potwierdzenia przed ofertą. Ponowny import przelicza analizę i zachowuje ręczne dane CRM; stare wpisy otrzymują bieżącą analizę przy odczycie.

Reguły wykorzystują wyłącznie główny PKD, jego opis i wersję, stan wpisu oraz deklarowane kontakty. Nie sprawdzają faktycznej strony, kont marketplace, asortymentu ani zamiaru zakupu usług. Brak WWW oznacza brak wpisu w rejestrze. Brak podstaw do wskazania nie oznacza braku potrzeb. Kanały sprzedaży to hipotezy; pewność jest niska lub umiarkowana. Wersja PKD 2025 nie pozwala utożsamiać 47.91 z internetowym sklepem (zob. https://bip.stat.gov.pl/dzialalnosc-statystyki-publicznej/rejestr-regon/faq-czeste-pytania/). Towary regulowane i pośrednictwo są wykluczone z automatycznego dopasowania marketplace. Gotowość zagraniczna wymaga sprawdzenia produktów, logistyki i obsługi językowej; źródła: https://help.allegro.com/pl/marketplaces i https://sell.amazon.pl/programy/sprzedawaj-w-calej-europie.

Lista CEIDG używa limit=25, zgodnie z odpowiedzią walidacji produkcyjnego API (starszy przykład dokumentacji podaje 50).

Gdy API odrzuci partię szczegółów z powodu maksymalnej liczby identyfikatorów, importer zmniejsza partię o połowę i ponawia ją od tego samego punktu. Wielkość zapisuje w zadaniu; nie pomija firm. Inne błędy walidacji zatrzymują import.

Sprzedaż zagraniczna eBay: https://www.ebay.com/help/selling/getting-started-selling/selling-internationally?id=4132. Konkretne wymagania i dostępność zależą od rynku i produktów.
