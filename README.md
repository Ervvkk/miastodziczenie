# miastodziczenie — baza danych

Prosta, statyczna baza zdjęć dla Nowego Teatru. Zdjęcia same układają się na mapie Warszawy według współrzędnych GPS zapisanych w plikach JPG. Użytkownik filtruje zbiór, zaznaczając i odznaczając tagi.

Strona nie potrzebuje bazy danych, PHP ani serwera aplikacji. To zwykłe pliki HTML/CSS/JS i JSON. Docelowy adres: `https://nowyteatr.org/pl/miastodziczenie`.

---

## Struktura

```
index.html            strona
assets/app.js         logika (mapa, filtry, podgląd)
assets/style.css      wygląd
config.json           ← tytuł, styl i zasięg mapy, nazwy tagów
zdjecia/              ← tu wrzucamy zdjęcia .jpg i opisy .txt
scripts/build.py      skrypt, który tworzy bazę na podstawie folderu zdjecia/
data/                 (generowane automatycznie: zdjecia.json, miniatury, podglądy)
.github/workflows/    automat GitHuba: odświeża data/ po każdym wgraniu zdjęć
```

---

## Dla zespołu projektu: jak dodawać zdjęcia

### 1. Nazwa pliku = tagi

```
nazwa_146.jpeg
```

- przed ostatnim podkreślnikiem `_` jest nazwa zdjęcia (bez spacji i polskich znaków),
- po nim są cyfry tagów pisane jedna za drugą, a każda cyfra to jeden tag (0–9).

Przykład: `IMG2197_256.jpeg` to zdjęcie z tagami 2, 5 i 6.

Część po ostatnim `_` jest zawsze czytana jako tagi. Dlatego nazwa zdjęcia nie powinna sama kończyć się na `_liczba`: zamiast `IMG_2197_256` pisz `IMG2197_256`. Zdjęcie bez tagów to po prostu `nazwa.jpeg`.

Zdjęcie musi mieć w metadanych lokalizację GPS (iPhone/Android zapisują ją, jeśli w aparacie włączona jest lokalizacja). Pliki bez GPS są pomijane, a skrypt wypisuje ich listę.

### 2. Opis = plik .txt o tej samej nazwie

```
IMG2197_256.jpeg
IMG2197_256.txt     ← zwykły tekst, kodowanie UTF-8
```

Opis może też nazywać się samym identyfikatorem (`IMG2197.txt`). Wtedy przy zmianie tagów wystarczy przemianować sam plik JPG.

### 3. Nazwy tagów są w `config.json`

```json
"tagi": {
  "0": { "nazwa": "przedept",      "kolor": "#F6C6C7" },
  "1": { "nazwa": "dekonstrukcja", "kolor": "#FAD9B8" },
  ...
}
```

Kod (lewa strona, jedna cyfra 0–9) występuje w nazwach plików. `nazwa` wyświetla się na stronie, a `kolor` (dowolny kolor CSS) to kolor przycisku tagu. Nazwy można zmieniać w dowolnej chwili bez ruszania plików. Kolejność w `config.json` to kolejność przycisków na stronie.

### 4. Wgranie na GitHub

**Najprościej, przez przeglądarkę:** w repozytorium na GitHubie otwórz folder `zdjecia`, wybierz *Add file → Upload files*, przeciągnij JPG-i i TXT-y, a potem kliknij *Commit changes*. Po 1–2 minutach automat (zakładka *Actions*) sam odświeży bazę, tagi i miniatury, a potem opublikuje stronę.

**Co musi spełniać każde zdjęcie:**
- format **JPG/JPEG**. Zdjęcia HEIC z iPhone'a trzeba najpierw wyeksportować do JPG (np. w aplikacji Zdjęcia na Macu: *Plik → Eksportuj*),
- **lokalizacja GPS w metadanych**. Uwaga: WhatsApp, Messenger, Instagram i część maili usuwają lokalizację, a przy AirDropie i udostępnianiu z iPhone'a trzeba ją włączyć w *Opcjach*. Najpewniej przesyłać pliki oryginalne (kabel, iCloud, Dysk Google),
- nazwa w formacie `nazwa_146.jpeg` oraz opcjonalny `nazwa_146.txt`.

Zdjęcia bez GPS nie pojawią się na mapie. Ich listę widać w zakładce *Actions* w logu kroku „Zbuduj bazę zdjęć”.

Przez przeglądarkę GitHub przyjmuje do 100 plików naraz i pliki do 25 MB.

**Lokalnie:** po dodaniu, podmianie, przemianowaniu lub usunięciu zdjęć albo opisów uruchom skrypt. Sam folder nie jest „obserwowany”. Skrypt tworzy miniatury tylko dla nowych lub zmienionych zdjęć (rozpoznaje je po zawartości, nie po dacie), a miniatury usuniętych zdjęć kasuje.

```bash
python3 scripts/build.py      # odświeża data/
python3 -m http.server        # podgląd na http://localhost:8000
```

Strony nie da się otworzyć dwuklikiem w `index.html` (przeglądarka blokuje wtedy wczytanie danych), dlatego potrzebny jest lokalny serwer z polecenia powyżej.

> Jeśli bazę budujesz lokalnie i jednocześnie działa automat GitHuba, przed `git push` zrób `git pull`, bo automat też zapisuje do `data/`.

---

## Mapa

Podkład to wektorowa mapa OpenStreetMap w stylu **Positron** z [OpenFreeMap](https://openfreemap.org). Jest darmowa, nie wymaga klucza API i wyświetla ją biblioteka MapLibre GL. Po wejściu na stronę mapa automatycznie pokazuje całą Warszawę.

Ustawienia w `config.json`:

```json
"mapa": {
  "styl": "https://tiles.openfreemap.org/styles/positron",
  "granice": [[20.85, 52.095], [21.275, 52.37]]
}
```

- `styl`: adres stylu mapy. Można go zamienić np. na `https://tiles.openfreemap.org/styles/bright` albo `…/liberty`.
- `granice`: obszar widoczny na starcie, zapisany jako `[długość, szerokość]` lewego dolnego i prawego górnego rogu. Mapy nie da się odsunąć daleko poza ten obszar.

---

## Dla administratora nowyteatr.org

To w pełni statyczna strona i wszystkie ścieżki w niej są względne. Są dwie proste drogi.

### A) GitHub Pages + iframe (najszybciej)

1. W repozytorium wybierz *Settings → Pages → Build and deployment → Source:* **GitHub Actions**. Publikacją zajmuje się automat z `.github/workflows/build.yml`.
2. Strona będzie dostępna pod `https://<konto>.github.io/<repozytorium>/`.
3. Na podstronie `/pl/miastodziczenie` w CMS-ie wstaw:

```html
<iframe src="https://<konto>.github.io/<repozytorium>/"
        style="width:100%;height:90vh;border:0;display:block"
        title="miastodziczenie — baza danych" loading="lazy"></iframe>
```

Każde wgranie zdjęć do repozytorium aktualizuje stronę automatycznie i nie wymaga żadnych zmian po stronie teatru.

### B) Pliki na serwerze teatru

Skopiuj całe repozytorium (bez `.github/`) do katalogu obsługiwanego pod `/pl/miastodziczenie/`. Działa od razu, bo nie ma żadnego budowania po stronie serwera. Przy aktualizacjach trzeba ponownie skopiować `data/` i `zdjecia/` (np. przez `git pull` w tym katalogu).

### Osadzenie bezpośrednio w szablonie CMS (bez iframe)

Cała aplikacja siedzi w `<div id="miastodziczenie" class="md">…</div>`, a style są zawężone do klasy `.md`, więc nie kolidują ze stylami teatru. Wystarczy wstawić ten blok z `index.html` i dołączyć:

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css">
<link rel="stylesheet" href="…/miastodziczenie/assets/style.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js"></script>
<script src="…/miastodziczenie/assets/app.js"></script>
```

Skrypt odnajduje `config.json` i `data/` względem własnego adresu (`assets/app.js` → katalog wyżej). Na stronie teatru tekst automatycznie przyjmie krój ReaderPro.

---

## Funkcje

- miniatury zdjęć na mapie z przybliżaniem i przesuwaniem (MapLibre GL + OpenFreeMap Positron),
- zdjęcia zrobione w tym samym miejscu (do ok. 60 m) rozsuwają się w kółko,
- filtr tagów w dwóch trybach: zdjęcia z **dowolnym** z zaznaczonych tagów albo ze **wszystkimi**,
- podgląd po kliknięciu: zdjęcie, tagi, opis, data i współrzędne; strzałki ← → przełączają zdjęcia, Esc zamyka,
- po wejściu zaznaczone są wszystkie tagi w trybie „dowolny”, czyli widać wszystkie zdjęcia,
- link do konkretnego zdjęcia, np. `…/#foto=IMG2376`,
- wersja na telefon (filtry zwijane przyciskiem „Tagi”).
