# Firmy CRM na Vercel

CRM z rzeczywistymi danymi CEIDG i KRS, trwałą bazą Turso i importem w tle obsługiwanym przez Vercel Workflow. Przeglądarka ani komputer użytkownika nie muszą pozostawać włączone.

## Konfiguracja

1. W projekcie Vercel otwórz Storage, utwórz bazę Turso i połącz ją z projektem. Integracja ustawia `TURSO_DATABASE_URL` oraz `TURSO_AUTH_TOKEN`.
2. W Settings → Environment Variables dodaj `CEIDG_API_TOKEN`, `CRM_PASSWORD` (minimum 12 znaków) i `CRM_SESSION_SECRET` (losowy sekret minimum 32 znaki). Wybierz Production oraz używane środowisko Preview.
3. Wykonaj ponowne wdrożenie. Istniejące wdrożenia nie otrzymują nowych zmiennych automatycznie.
4. Zaloguj się do CRM i wybierz Rejestry i import. Import pojedynczej firmy sprawdza token online; obecność konfiguracji sama nie potwierdza jego ważności.

Sekrety przechowuj wyłącznie w Vercel lub lokalnym `.env`. Nie wpisuj ich do `.env.example`, kodu, opisu PR ani GitHub. Baza tworzy tabele przy pierwszym połączeniu. Publiczne API CRM wymaga podpisanej sesji, hasło i tokeny pozostają na serwerze. Sesja trwa 12 godzin, cookie jest HttpOnly i SameSite=Strict, na Vercel także Secure. Próby logowania mają współdzielony limit 15 na 5 minut. Zmiana hasła lub sekretu sesji jest operacją administracyjną w panelu Vercel; zmiana samego hasła nie unieważnia wcześniejszych sesji — w tym celu zmień też CRM_SESSION_SECRET.

## Mechanizm importu i pozycja zapisu (szerszy zakres archiwalny)

Bieżący import zbiera po 1000 dopasowanych firm na każdy rok rozpoczęcia, domyślnie od 2020 do bieżącego roku włącznie. CEIDG otrzymuje osobne parametry `dataod=YYYY-01-01` i `datado=YYYY-12-31` dla każdego rocznika; górna granica bieżącego roku to dzisiaj. Data jest ponownie sprawdzana po pobraniu szczegółów. Lista `/firmy?status=AKTYWNY&dataod=…&datado=…&limit=25&page=…` jest uzupełniana szczegółami `/firma?ids=…` w partiach do 25. Zapis firmy i pozycji kolejki odbywa się w jednej transakcji. Wznowienie zachowuje postęp. Pauza unieważnia poprzednią generację zadania: odpowiedź rozpoczętego wcześniej zapytania nie przesuwa już kursora. Notatki, etykiety i status handlowy są zachowywane przy odświeżaniu danych.

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

## Filtrowanie kontaktów
W bazie firm filtr Dane kontaktowe pozwala wybrać firmy z e-mailem, telefonem, WWW, dowolnym z tych pól, e-mailem lub telefonem oraz bez wszystkich trzech danych. Filtr łączy się z wyszukiwaniem, statusem i PKD. Wyniki i ich liczba są filtrowane w bazie przed podziałem na strony, a nie tylko na aktualnych 100 wpisach. Obecność kontaktu nie potwierdza jego aktualności. Nowe wpisy są uwzględniane przy odświeżaniu. Filtr wykonuje tylko odczyt firm; nie zmienia kolejki, blokad ani punktu zapisu importu. Wdrożenie dodaje indeksy kontaktów bez usuwania danych.

## Kolejka dopasowanych firm
Selekcja roczników obejmuje aktywne CEIDG, główną działalność usługową lub handlową, telefon lub e-mail i przynajmniej jeden sygnał WWW/marketplace. Każdy rok ma osobny cel 1000 firm oraz limit 100 000 sprawdzeń. Wykorzystujemy również pasujące firmy z wcześniejszych kolejek, bez duplikowania firm w CRM. Roczniki uzupełniamy od najstarszego; osiągnięcie celu, limitu sprawdzeń lub końca listy rozpoczyna następny rok. Niedobór nie jest prezentowany jako osiągnięty cel. Pauza i wznowienie zachowują rok, stronę i oczekujące identyfikatory. Stary import należy wstrzymać przed rozpoczęciem kampanii. Firmy bez daty lub z przyszłą datą nie kwalifikują się. Import nie uruchamia płatnych analiz AI.

Nowe wpisy bez dopasowania nie są zapisywane. Kolejka deduplikuje firmy po identyfikatorze CRM; ręczne notatki i status pozostają zachowane. Statusy Klient, Nie zainteresowany i Nie kontaktować wykluczają firmę z kolejki. Widok Kolejka dopasowanych firm pokazuje tylko członków aktualnej selekcji, domyślnie podzielonych na roczniki od najstarszych, z dopasowaniem wewnątrz roku. Pasek lat filtruje wyniki w bazie, łącząc się z pozostałymi filtrami i paginacją; jego liczniki uwzględniają pozostałe filtry, ale obejmują wszystkie lata. Brak daty jest osobną kategorią. Nadwyżki wcześniejszych importów pozostają w widoku wszystkich zapisanych firm. Wszystkie zapisane firmy pozostają dostępne w drugim widoku.

Analiza v2 pokazuje sektor, dopasowanie punktowe, składniki oceny, propozycję usługi, możliwą korzyść i pytania do rozpoznania. Punkty opisują dopasowanie do oferty, nie prawdopodobieństwo zakupu; reguły opierają się wyłącznie na rejestrze. Nie wykonują audytu WWW, nie weryfikują kont marketplace ani nie dopowiadają zainteresowania.

## Wspólna praca i oznaczenia
Imię w nagłówku pochodzi z zalogowanego konta. Przejmij kontakt zapisuje osobę połączoną z kontem. Listę osób utrzymuje administrator w panelu Zespół i dostęp. Link Zadzwoń jest dostępny dla osoby prowadzącej firmę; telefonu widocznego w rejestrze nie blokujemy poza aplikacją. Przekazanie firmy wykonuje administrator.

Oznaczenia można dodawać, edytować i usuwać przy firmie, a następnie filtrować po dokładnym oznaczeniu. Zmiana nazwy dotyczy tej firmy, nie zmienia oznaczeń w całej bazie. Oznaczenia i przypisania zachowują się przy ponownym imporcie. Filtry łączą się z PKD, statusem, wyszukiwaniem i kontaktami oraz obejmują całą bazę przed paginacją.

Każdy zapis CRM wymaga crmRevision z odczytanej firmy. Porównanie i zapis odbywają się w jednej transakcji; nieaktualna wersja otrzymuje HTTP 409 i nie nadpisuje danych. Po konflikcie użytkownik zachowuje szkic i może wczytać aktualne dane, świadomie zastępując szkic. Starsze otwarte wersje interfejsu muszą odświeżyć stronę. Zmiana statusu na Kontakt wykonany zapisuje datę oznaczenia kontaktu; aplikacja nie wykrywa faktycznego połączenia. Lista odświeża się co 10 sekund.

Analizuj szerzej — OpenAI uruchamia Responses API (gpt-5.4-mini) z maksymalnie 12 użyciami narzędzia web_search łącznie, kontekstem medium i maksymalnie 8000 tokenów wyjścia. Otwarcia stron również mieszczą się w tym limicie; rozliczenie pokazuje liczbę faktycznych wyszukiwań. Jedno żądanie ma limit 240 sekund i nie jest automatycznie ponawiane. Szerszy zakres kosztuje więcej niż poprzedni wariant 3 użyć; faktyczny koszt zależy od tokenów i wyszukiwań. Zadanie działa jako Vercel Workflow i zapisuje raport w Turso; zamknięcie karty nie zatrzymuje analizy.

Raport rozszerzony (wersja 2) zawiera obecność na Facebooku, Instagramie, LinkedIn, Allegro Polska, Amazon, eBay, zagranicznych rynkach Allegro i pozostałej dopasowanej platformie. Każdy kanał ma status: potwierdzono, nie znaleziono, niedostępne albo nie sprawdzono. Potwierdzenie wymaga użytych źródeł profilu i dowodu dopasowania firmy; URL musi należeć do wskazanej platformy. Nie znaleziono wymaga zwróconego przez API zapytania dotyczącego kanału; brak metadanych oznacza nie sprawdzono. Brak wyniku nie dowodzi braku konta.

Zakres WWW pokazuje do 6 podstron: otwarte narzędziem, opisane jedynie w wynikach wyszukiwania, niedostępne lub niesprawdzone. Status sprawdzono treść wymaga potwierdzonej tożsamości strony, URL z tej samej domeny i metadanych otwarcia/find-in-page. Nie ma automatycznego crawlowania całej witryny. Raport podaje do 5 usług według priorytetu, powód, korzyść, fakt/hipotezę, źródło i pytanie do rozmowy; obejmuje również dopasowanie polskich i zagranicznych marketplace. To analiza treści, nie pomiar szybkości/SEO technicznego, wyglądu mobilnego, test formularza/zamówienia ani dowód zamiaru zakupu. Fakty bez użytego źródła są usuwane lub oznaczane jako hipotezy. Starsze raporty pozostają zapisane; płatne odświeżenie na kliknięcie wykonuje nowy zakres. Błędy wcześniejszych prób pokazują ich dostawcę oddzielnie od dostawcy następnego uruchomienia.

Na Vercel ustaw CRM_AI_PROVIDER=openai, OPENAI_API_KEY jako sekret (wyłącznie Production), CRM_AI_ENABLED=true i CRM_AI_DAILY_LIMIT=50, a następnie wykonaj redeploy. Nie dodawaj klucza do .env.example, przeglądarki lub repozytorium. Klucz wymaga rozliczeń/środków na koncie OpenAI API. Domyślnie funkcja jest wyłączona. Wersje Preview nie mogą uruchamiać płatnych analiz.

Limit 50 dotyczy całego zespołu na dobę UTC i obejmuje próby zakończone błędem. Rezerwacja limitu jest transakcyjna. Wielokrotne kliknięcie nie tworzy drugiego zadania. Gotowy raport jest otwierany z bazy bez nowego żądania; jego płatne odświeżenie jest osobnym potwierdzanym działaniem. Zawieszone zadanie po 10 minutach wymaga sprawdzenia Workflow przed ponowieniem; nie ponawiamy automatycznie płatnego wywołania. Limitu liczby analiz nie należy traktować jako ścisłego limitu dolarowego.

Publiczny profil wysyłany do OpenAI obejmuje nazwę firmy, NIP, miasto, PKD i WWW. Nie obejmuje notatek CRM, przypisania pracownika, oznaczeń, e-maila ani telefonu. Parametr store:false ogranicza przechowywanie odpowiedzi API; obowiązują zasady retencji OpenAI. Raport pokazuje szacunkowy koszt na podstawie użycia tokenów i wyszukiwania; ostateczne koszty sprawdzaj w https://platform.openai.com/usage, saldo i doładowania w https://platform.openai.com/settings/organization/billing/overview.

## Konta i panel administratora

Login głównego administratora: admin. Hasło pozostaje w CRM_PASSWORD w Vercel; nie wpisuj sekretów do repozytorium. Dotychczasowa sesja administratora działa do jej wygaśnięcia. Panel „Zespół i dostęp” dodaje i edytuje osoby odpowiedzialne oraz konta z własnym loginem i hasłem (minimum 12 znaków). Nie tworzymy przykładowych osób; migracja zachowuje rzeczywiste dotychczasowe przypisania.

Każde konto może być powiązane z osobą odpowiedzialną. Imię w nagłówku i możliwość przejęcia kontaktu wynikają z sesji, a nie z wyboru w przeglądarce. Zwykły użytkownik nie może edytować firmy przypisanej do innej osoby ani zarządzać zespołem. Administrator może przekazywać firmy. Wyłączenie osoby zachowuje historię i blokuje nowe przypisania. Zmiana jej nazwy aktualizuje firmy i ich wersje, aby chronić przed nadpisaniem starego formularza.

Hasła kont są przechowywane jako scrypt z losową solą (N=131072,r=8,p=1). Sesje zawierają identyfikator i wersję konta; zablokowanie konta, zmiana hasła lub roli unieważnia stare sesje. API sprawdza aktywność i role przy każdym żądaniu. Panel nie zwraca skrótów haseł.

## Gemini — bezpłatny pilotaż

Na Vercel wybierz CRM_AI_PROVIDER=gemini, dodaj GEMINI_API_KEY z projektu Google AI Studio z planem Free tier BEZ Cloud Billing, a dopiero po sprawdzeniu planu ustaw CRM_GEMINI_FREE_TIER_CONFIRMED=true i CRM_AI_ENABLED=true. Zmienna potwierdzenia jest deklaracją administratora; API generacji nie potwierdza stanu rozliczeń. Włączenie płatnego planu w Google może powodować opłaty również dla tego klucza. CRM nie włącza rozliczeń, nie zmienia modelu automatycznie i nie korzysta z OpenAI po wybraniu Gemini.

Model gemini-3.8-flash korzysta z URL Context tylko dla WWW podanego w rejestrze. Nie korzysta z Google Search. Gdy WWW brakuje lub pobranie nie powiedzie się, raport zawiera wyłącznie hipotezy z rejestru, bez fikcyjnego audytu strony. Potencjał marketplace wymaga danych o asortymencie; brak źródeł oznacza brak danych. Wykorzystane źródła pochodzą wyłącznie z udanego pobrania dokładnie podanego URL. Limity konta Google sprawdzaj w AI Studio; 50 w CRM jest górnym limitem zespołu, a nie gwarantowaną liczbą analiz Google. Limit dzienny, odstęp minimum 12 sekund, zapis raportu i brak automatycznych ponowień ograniczają zużycie.

Dokumentacja: https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/generate-content/url-context, https://ai.google.dev/gemini-api/docs/generate-content/structured-output, https://ai.google.dev/api/generate-content, https://ai.google.dev/gemini-api/docs/billing. Wysyłamy tylko publiczny profil firmy opisany wyżej, bez notatek, kontaktów czy oznaczeń. store:false ogranicza logowanie żądania; obowiązują warunki Google.
