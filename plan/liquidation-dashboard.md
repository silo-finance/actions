Musimy zaplanować wdrożenie funkcjonalności, która pozwoli nam monitorować i mieć pogląd na wszystkie markety, wszystkie aktywne markety w silo oraz wszystkie pozycje w marketach, żeby sprawdzać ich stan. Czy są zdrowe, czy wymagają likwidacji? W pierwszej kolejności, pierwszym krokiem powinno być wylistowanie. Czekaj, najpierw musimy się dowiedzieć, ogólnie w jaki sposób możemy to zrobić. 

https://api-v3.silo.finance/ 

czy jestes w stanie zapoznac sie ze schematem w/w the graph?

resources: https://app.silo.finance/api/earn-silos  Ten endpoint zwraca nam adresy silo, które nas interesują, i tylko te będziemy monitorować oraz wspierać. Przeanalizuj ten endpoint. Prawdopodobnie trzeba będzie tu utworzyć jakąś strukturę tego endpointu, żebyśmy wiedzieli, jakie dane on nam dostarcza.

przyklad zapytania:
<code>
POST: https://app.silo.finance/api/earn-silos

{
  "siloIds": [],
  "search": null,
  "riskProfiles": [],
  "chainKeys": [],
  "minTotalSupplyUsd": null,
  "sort": null,
  "limit": 1000,
  "offset": 0
}
</code>

response:

</response>
"silos": [
        {
            "_tag": "silo",
            "siloAddress": "0xEd5EF6Ee1139Dbc3d48B1e5336B4A9f1C240Fb6F",
            "chainKey": "arbitrum",
            "link": "/markets/arbitrum-0x41A631Bb5c86262b7C0F79556334f0FCAB360eFD?asset=0",
            "tokenAddress": "0x5979D7b546E38E414F7E9822514be443A4800529",
            "tokenSymbol": "wstETH",
            "tokenLogos": {
                "small": "https://2jx65fja6ptaxjit.public.blob.vercel-storage.com/logo/wstETH-64x64.png",
                "large": "https://2jx65fja6ptaxjit.public.blob.vercel-storage.com/logo/wstETH.png"
            },
            "tokenColor": "#4dbef4",
            "underlyingApy": "26362019526903424",
            "collateralTokenAddress": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            "collateralTokenSymbol": "ETH",
            "collateralTokenLogos": {
                "small": "https://2jx65fja6ptaxjit.public.blob.vercel-storage.com/logo/ETH.svg",
                "large": "https://2jx65fja6ptaxjit.public.blob.vercel-storage.com/logo/ETH.svg"
            },
            "supplyBaseApr": "41319557445",
            "supplyRewards": [],
            "supplyApr": "26362060846460869",
            "supplyApr7d": "26362060846460869",
            "totalSupplyUsd": "9490861930",
            "riskProfile": "low",
            "siloId": "arbitrum-0xEd5EF6Ee1139Dbc3d48B1e5336B4A9f1C240Fb6F",
            "tokenId": "arbitrum-0x5979D7b546E38E414F7E9822514be443A4800529",
            "collateralTokenId": "arbitrum-0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
        },
</response>

Małe wyjaśnienie niektórych rekordów, które prawdopodobnie będziemy używać w implementacji:

"_tag": "To jest po prostu typ rekordu. W naszym przypadku, ponieważ pobieramy silo, to będzie zawsze silo.",
            "siloAddress": "To jest adres silo w postaci heksadecymalnej.",
            "chainKey": "To jest nazwa blockchainu, na którym ten silo jest zdeployowany. I ta nazwa też jest używana jako przedrostek tutaj, w innych polach.",
            "link": "To jest akurat link do UI, które mamy, ale nam nie będzie to potrzebne.",
            "tokenAddress": "To jest adres asetu, który jest podłączony do naszego silosu. Silo w ogóle jest woltem, więc każde silo ma jeden aset podłączony.",
            "tokenSymbol": "To jest symbol naszego tokena.",
            "tokenLogos": {
                "small": "To jest ikonka dla naszego tokena. mala",
                "large": "To jest URL do dużej ikonki, do tokena."
            },
            "tokenColor": "To jest przypisany kolor do tokena. Możemy go gdzieś tam użyć. Będziemy już projektować UI.",
            
Z danych dodatkowych, które na pewno będziemy potrzebowali, to jest siloid, które możemy pobrać z siloconfig.

Jedną z rzeczy, na którą trzeba się zastanowić, to jest to czy pobierać zawsze dane z API, z Query. Niektóre dane po prostu są stałe. Nie zmieniamy ich, więc czy warto tracić czas na Query? Czy może lepiej jest podczas np. deploymentu ustawić chociażby w CI jakąś akcję? Jakiś skrypt, który. Pobierze nam wszystkie dane i zapisze do naszej wewnętrznej bazy danych. I teraz ta baza danych raczej będzie musiała być w plikach. Z uwagi na to, że to jest tylko UI nie mamy tutaj dostępu do niczego, więc te pliki będą musiały być w taki sposób przechowane, żeby ta UI się deployowała z nimi. Więc tutaj potrzebujemy znaleźć profesjonalne rozwiązanie, które nam to umożliwi. Na pewno te dane będą musiały być podane per blockchain, czyli już nie jeden plik tylko kilka plików. Chyba tak będzie najlepiej sklasyfikować. Ale to jest do zastanowienia się i może są jakieś gotowe rozwiązania. Które wymuszą nam sposób przechowania tych danych w UI. Bo niektóre dane moglibyśmy po prostu automatycznie od razu pokazać i oczywiście wtedy kiedy mamy nowe dane to moglibyśmy tylko pokazać taki znacznik, jakieś pulsujące kółko, alert wyraźny gdzieś, że dostępne są nowe silo i wtedy moglibyśmy dać link do akcji na githubie, którą należało by wykonać czyli kliknąć tylko i ta akcja pobrałaby ponownie wszystkie silo zobaczyłaby jakich silo nam brakuje. I dla tych brakujących silo pobrała dane które są niezmienne i otworzyła PR ze zmienionymi danymi plus oczywiście zmiana wersji w package json jedno zdanie dosłownie jedno zdanie w change logu że dodaliśmy nowe silo i listę tych silo dodanych powiedzmy i wtedy takie PR się otworzy ktoś z dostępem je zaakceptuje i automatyczny redeployment się zrobi ale akurat redeployment już mamy więc w ten sposób będziemy mogli aktualizować silo i nie używać RPC calls ani żadnych API calls. Tych silo będzie niedużo, kilkadziesiąt, może nawet kilkaset. Nie są to na tyle duże dane, żeby w jakiś sposób tutaj wpływały na efektywność UI, podejrzewam. Więc sprawdźmy, jakie są rozwiązania, i tutaj będzie trzeba je zastosować.


Musimy mieć też jasną sekcję w dokumentacji, jakie dane są hardcoded. I tutaj, podczas pisania planu, utwórz taką sekcję, do której będę mógł ewentualnie dodać jakieś dane, jeżeli uznam, że trzeba je dodatkowo pobrać i przechowywać.

Z rzeczy, które teraz na szybko mi przychodzą do głowy, które są stałe, niezmienne, i chcemy je cashować lokalnie to jest tak: - silo config adres, - silo adres, - asset symbol, - silo id, - ikonki, asset decimals (pobrac z graph query).

Nasze REST API nie ma wszystkich danych, natomiast mamy też query dla **the graph**, którego możemy użyć. Pamiętajmy zawsze, żeby ograniczać te query do adresów, które nas interesują, bo **the graph** ma absolutnie wszystkie silos, łącznie z testowymi, z nieprawidłowymi itd. A my chcemy tutaj widzieć tylko i wyłącznie adresy, które zwraca nam API.

Dodatkowo musimy mieć opcję, i to chyba będzie opcja w CI, żeby manualnie dodać albo usunąć silo. Może się zdarzyć tak, że nie chcemy już obserwować danego silo, nie chcemy, żeby nam się pokazywało, ale jednocześnie API zwraca, albo odwrotnie: API nie zwraca, ale my chcemy je obserwować. Więc wtedy musimy odpalić CI i podać adres silo. Jeżeli nie ma… jeżeli API nie zwraca danych o danym silo, no to wszystkie dane musimy pobrać z naszego query grafa i dodajemy, oczywiście, je zapisujemy do naszej lokalnej bazy danych.



Tutaj podział dashboardu będzie wyglądał w ten sposób, że pierwsza strona będzie listą naszych marketów. Wydaje mi się, że ponieważ mamy wszystkie markety cachowane, to wyświetlmy całość od razu. Całość od razu z podziałem na networks na blockchainy. Czyli będzie w zasadzie taka troszkę tabelaryczna forma i na pewno będziemy chcieli mieć możliwość sortowania po danych numerycznych. Domyślne sortowanie po wejściu na stronę będzie po silo ID malejąco, czyli najnowsze na początku. To będą bez względu na sieć; sieć to będzie jednym z atrybutów w naszej tabeli. Na pewno też będziemy chcieli mieć jakiś taki szybki filtr, czyli np. silo ID wpisać w filtrze, żeby nam się pojawiło, albo nazwę tokena, symbol tokena. W zasadzie wtedy nam się pokazują tylko te markety z tokenem.

I teraz dane, które w tej tabeli będą musiały być pobrane, czyli aktualne. Oczywiście pamiętamy o Multicol. To jest tak: Total Assets, ale przeanalizuj tutaj Interface silo, bo mamy Total Assets Storage i to nas interesuje. Czyli to jest tak jakby bez odsetek wartość asetów, które są zdeponowane. A total assets z Interfaces VAULT czyli silo jest VAULTem podaje nam asety z odsetkami Więc te dwie dane będą nam potrzebne. Na podstawie tego obliczy my sobie obecną wartość niezapłaconych odsetek i tutaj możemy pokazać tą wartość czyli na przykład INTEREST i tutaj wartość tych odsetek liczbowo a w nawiasie mamy tylko liczbę INTEREST kolejna kolumna to będzie LIQUIDITY i tutaj mamy też GETTER do tego.

Wszystkie query muszą być też od razu zapisane w planie, czyli w specyfikacji, żebym mógł je przetestować, czyli zobaczyć, czy są poprawne, czy poprawnie ich używasz. Więc przy generowaniu planu dla każdego rodzaju funkcjonalności napisz, z jakiego query używasz, a ja wtedy się przejrzę i najwyżej będziemy dostosowywać.

Jedną z kolumn, widoczną od razu, ma być taki sanity check, który sprawdzi total dead i ilość borrowers, czyli pozycji w zasadzie. Total dead oczywiście pobierzemy sobie bezpośrednio z silo, natomiast positions pobierzemy sobie z grafu. Jeżeli graf zwróci zero pozycji, to jakiś czerwony error ma się wyświetlić do tego silo. Czyli wyobrażamy sobie to tak: jak mamy listy, tabele tych silo, to pod danym silo, na przykład, alerty będą. Pod wierszem mamy jakiś czerwony alert i informację, że graf zwraca zero pozycji, mimo że mamy dług.

Tak więc tutaj kolejna trudność do rozwiązania jest taka, że jak pobrać pozycję? A pozycja to jest pozycją nazywamy dług po prostu, czyli ktoś dał kolateral i pożyczył token i to jest nasza pozycja i graf nam ma zwrócić tutaj tę pozycję. Do celów testowych użyjmy limitujmy ilość odpowiedzi z grafem, żeby nam to jakoś wszystko ładnie działało. Może lokalnie po prostu dajmy argumenty, czyli w INV lokalnym będziemy mieli wskazany silo adres, ewentualnie 1, 2, 3. Możemy podać wiele adresów. I to będzie nasz limit, nasz ogranicznik. Dodatkowo drugim ogranicznikiem jest limit pozycji. Limit nie tyle pozycji, czyli ten limit query do grafu. Czyli jak głosujemy 100 to każde nasze query ma być limitowane 100. I tutaj no i tyle. I bez pagination tutaj właśnie prawdopodobnie potrzebowalibyśmy jakieś pagination obsługiwane. Tak byśmy potrzebowali później ustalimy jaki ma być domyślnie to będzie jakaś wartość konfiguracyjna gdzieś w jakimś takim naszym pliku konfiguracyjnym trzeba ją umieścić żebyśmy widzieli więc pliku konfiguracyjnym mamy zdefiniowaną ilość rekordów na zapytanie i paginacje natomiast jeżeli w lokalnym ENV mamy ustawiony limit na przykład 10 to nie mamy już w ogóle paginacji. W żadnym zapytaniu po prostu pobieramy 10 rekordów to służy do tego że to ma być testowane i może warto te wszystkie zmienny ENV nazywać z przedrostkiem test podkreślnik i nazwa zmiennej wtedy po pierwsze łatwo je będzie znaleźć w kodzie no i też będą jasne i klarowne do czego służą. więc tak: mamy limitowane silo zarówno dla API nie limitujemy. Nie! też mamy limit w API więc jak najbardziej limitujemy. I w grafie też limitujemy. W grafie to jest nasz market id. To jest nasze silo adres.

Teraz każdy wiersz w tym silo jest klikalny, czyli możemy zobaczyć pozycje. Klikamy na dane silo i tutaj, ale zróbmy jakiś taki sprytny sposób bez przeładowania strony. W momencie, kiedy chcemy wrócić, to żeby nie pobierać tych danych ponownie, znowu tylko jakiś sprytny refresh UI czy coś w tym stylu. To mechanizmy UI po prostu tutaj zastosujmy, które pozwolą nam przełączać się między widokami, jednocześnie zachowując unikalność strony. Czyli URL musi się zmienić i wtedy, jak komuś wysyłamy ten URL, no to ma widzieć dokładnie ten widok, który my. Czyli po kliknięciu w silo pojawia nam się lista pozycji dla danego silo. Pierwszym krokiem będzie pokazanie adresu borrowera i LTV tej pozycji. Na tym się na razie zatrzymajmy. Te dane też z grafu będziemy pobierać. Więc to, tak jak gdzieś tam wcześniej już pytałem, to jest potrzebna analiza tego grafu. Myślę, że będzie też potrzebna analiza może trochę naszych kontraktów. Mogę tutaj przesłać link do repozytorium do kontraktów silo-vault. Chociaż tak naprawdę my mamy standardowo każdy silo ma standardowy interfejs VAULT'a. Czyli możemy przebić. Myślę, że jak zasięgnie się informacji, co to jest VAULT w DeFi, to będzie wystarczające do zrozumienia, co to jest silo i jak to działa. To jest po prostu lending protocol.