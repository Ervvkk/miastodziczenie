#!/usr/bin/env python3
"""
miastodziczenie — generator bazy zdjęć.

Skanuje folder `zdjecia/`, odczytuje z plików JPG współrzędne GPS (EXIF),
tagi (z nazwy pliku) i opisy (z plików .txt), a potem zapisuje wszystko
do `data/zdjecia.json`, z którego korzysta strona.

Konwencja nazw:
    nazwa_146.jpeg   ->  tagi: 1, 4, 6  (każda cyfra po ostatnim „_” to jeden tag)
    nazwa_146.txt    ->  opis zdjęcia (zwykły tekst, UTF-8)
    (opis może też nazywać się po prostu nazwa.txt)

Uruchomienie (z głównego folderu projektu):
    python3 scripts/build.py

Skrypt działa na czystym Pythonie 3. Jeśli zainstalowany jest Pillow
(`pip install pillow`) albo skrypt działa na macOS (narzędzie `sips`),
dodatkowo tworzy lżejsze wersje zdjęć do strony (miniatury i podglądy).
"""

import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "zdjecia"
OUT_JSON = ROOT / "data" / "zdjecia.json"
THUMB_DIR = ROOT / "data" / "miniatury"
MEDIUM_DIR = ROOT / "data" / "podglady"
CONFIG = ROOT / "config.json"

THUMB_SIZE = 240     # px, dłuższy bok — znacznik na mapie
MEDIUM_SIZE = 1600   # px, dłuższy bok — podgląd po kliknięciu
JPG_EXT = {".jpg", ".jpeg"}
TAG_SEP = "_"


# --------------------------------------------------------------------------
# EXIF (bez zewnętrznych bibliotek)
# --------------------------------------------------------------------------

def _read_exif_block(path):
    """Zwraca surowy blok TIFF z segmentu APP1/Exif albo None."""
    with open(path, "rb") as f:
        if f.read(2) != b"\xff\xd8":
            return None
        while True:
            b = f.read(1)
            while b and b != b"\xff":
                b = f.read(1)
            while b == b"\xff":
                b = f.read(1)
            if not b:
                return None
            marker = b[0]
            if marker in (0xD9, 0xDA):  # koniec obrazu / początek danych
                return None
            size = struct.unpack(">H", f.read(2))[0]
            data = f.read(size - 2)
            if marker == 0xE1 and data[:6] == b"Exif\x00\x00":
                return data[6:]


def _parse_ifd(tiff, offset, endian):
    entries = {}
    if offset + 2 > len(tiff):
        return entries
    count = struct.unpack(endian + "H", tiff[offset:offset + 2])[0]
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}
    for i in range(count):
        e = offset + 2 + i * 12
        if e + 12 > len(tiff):
            break
        tag, typ, n = struct.unpack(endian + "HHI", tiff[e:e + 8])
        size = sizes.get(typ, 1) * n
        if size <= 4:
            raw = tiff[e + 8:e + 8 + size]
        else:
            ptr = struct.unpack(endian + "I", tiff[e + 8:e + 12])[0]
            raw = tiff[ptr:ptr + size]
        if typ == 2:
            val = raw.split(b"\x00")[0].decode("ascii", "ignore")
        elif typ == 3:
            val = list(struct.unpack(endian + "H" * n, raw[:2 * n]))
        elif typ == 4:
            val = list(struct.unpack(endian + "I" * n, raw[:4 * n]))
        elif typ in (5, 10):
            fmt = "I" if typ == 5 else "i"
            nums = struct.unpack(endian + fmt * (2 * n), raw[:8 * n])
            val = [nums[j] / nums[j + 1] if nums[j + 1] else 0 for j in range(0, 2 * n, 2)]
        else:
            val = raw
        entries[tag] = val
    return entries


def read_exif(path):
    """Zwraca dict: lat, lon, data (lub None, gdy brak)."""
    tiff = _read_exif_block(path)
    if not tiff or len(tiff) < 8:
        return {}
    endian = "<" if tiff[:2] == b"II" else ">"
    ifd0 = _parse_ifd(tiff, struct.unpack(endian + "I", tiff[4:8])[0], endian)
    out = {}

    gps_ptr = ifd0.get(0x8825)
    if gps_ptr:
        gps = _parse_ifd(tiff, gps_ptr[0], endian)
        if 2 in gps and 4 in gps:
            def dms(v):
                return v[0] + v[1] / 60 + v[2] / 3600
            lat, lon = dms(gps[2]), dms(gps[4])
            if str(gps.get(1, "N")).upper().startswith("S"):
                lat = -lat
            if str(gps.get(3, "E")).upper().startswith("W"):
                lon = -lon
            out["lat"], out["lon"] = round(lat, 6), round(lon, 6)

    exif_ptr = ifd0.get(0x8769)
    if exif_ptr:
        ex = _parse_ifd(tiff, exif_ptr[0], endian)
        dt = ex.get(0x9003) or ex.get(0x9004)
        if dt:
            try:
                out["data"] = datetime.strptime(dt.strip(), "%Y:%m:%d %H:%M:%S").strftime("%Y-%m-%d")
            except ValueError:
                pass
    return out


# --------------------------------------------------------------------------
# Lżejsze wersje zdjęć
# --------------------------------------------------------------------------

try:
    from PIL import Image, ImageOps  # type: ignore
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False
HAVE_SIPS = shutil.which("sips") is not None


def fingerprint(path):
    """Krótki skrót zawartości pliku — zmienia się, gdy zdjęcie zostanie podmienione."""
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:10]


def make_resized(src, dst, size, fresh):
    """Tworzy pomniejszoną kopię. Zwraca True, jeśli plik istnieje.
    `fresh` = miniatura pochodzi z tej samej wersji zdjęcia (wg skrótu), więc można ją zostawić."""
    if fresh and dst.exists():
        return True
    dst.parent.mkdir(parents=True, exist_ok=True)
    if HAVE_PIL:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail((size, size))
            im.save(dst, "JPEG", quality=82, optimize=True, progressive=True)
        return True
    if HAVE_SIPS:
        r = subprocess.run(
            ["sips", "-Z", str(size), "-s", "format", "jpeg",
             "-s", "formatOptions", "80", str(src), "--out", str(dst)],
            capture_output=True)
        return r.returncode == 0 and dst.exists()
    return False


# --------------------------------------------------------------------------
# Główna część
# --------------------------------------------------------------------------

def rel(p):
    return p.relative_to(ROOT).as_posix()


def parse_name(stem):
    """nazwa_146 -> ("nazwa", ["1", "4", "6"]). Tagi to cyfry po OSTATNIM podkreślniku."""
    name, sep, tagpart = stem.rpartition(TAG_SEP)
    if sep and name and tagpart.isdigit():
        tags = []
        for t in tagpart:
            if t not in tags:
                tags.append(t)
        return name, tags
    return stem, []


def find_description(jpg, name):
    for cand in (jpg.with_suffix(".txt"), jpg.with_name(name + ".txt")):
        if cand.exists():
            return cand.read_text(encoding="utf-8").strip()
    return ""


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    known_tags = set((config.get("tagi") or {}).keys())

    # wersje zdjęć z poprzedniego uruchomienia (do wykrywania podmienionych plików)
    previous = {}
    if OUT_JSON.exists():
        try:
            for it in json.loads(OUT_JSON.read_text(encoding="utf-8")).get("zdjecia", []):
                previous[it.get("plik")] = it.get("wersja")
        except (ValueError, AttributeError):
            pass

    photos, no_gps, unknown = [], [], set()
    used_generated = set()

    jpgs = sorted(p for p in SRC.iterdir() if p.suffix.lower() in JPG_EXT and not p.name.startswith("."))
    for jpg in jpgs:
        name, tags = parse_name(jpg.stem)
        exif = read_exif(jpg)
        if "lat" not in exif:
            no_gps.append(jpg.name)
            continue
        unknown.update(t for t in tags if known_tags and t not in known_tags)

        item = {
            "id": name,
            "plik": rel(jpg),
            "tagi": tags,
            "opis": find_description(jpg, name),
            "lat": exif["lat"],
            "lon": exif["lon"],
        }
        if "data" in exif:
            item["data"] = exif["data"]

        version = fingerprint(jpg)
        fresh = previous.get(item["plik"]) == version
        item["wersja"] = version
        thumb = THUMB_DIR / (jpg.stem + ".jpg")
        medium = MEDIUM_DIR / (jpg.stem + ".jpg")
        # ?v=… sprawia, że przeglądarka nie pokaże starej miniatury z pamięci podręcznej
        v = "?v=" + version
        item["miniatura"] = rel(thumb) + v if make_resized(jpg, thumb, THUMB_SIZE, fresh) else item["plik"] + v
        item["podglad"] = rel(medium) + v if make_resized(jpg, medium, MEDIUM_SIZE, fresh) else item["plik"] + v
        used_generated.update({thumb, medium})
        photos.append(item)

    # sprzątanie po usuniętych / przemianowanych zdjęciach
    for d in (THUMB_DIR, MEDIUM_DIR):
        if d.exists():
            for f in d.iterdir():
                if f not in used_generated:
                    f.unlink()

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps({
        "wygenerowano": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "zdjecia": photos,
        "bez_gps": no_gps,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"✓ {len(photos)} zdjęć zapisanych do {rel(OUT_JSON)}")
    if not (HAVE_PIL or HAVE_SIPS):
        print("! Brak Pillow/sips — strona użyje oryginalnych (ciężkich) plików. "
              "Zainstaluj: pip install pillow")
    if no_gps:
        print(f"! {len(no_gps)} plików bez GPS (pominięte): " + ", ".join(no_gps))
    if unknown:
        print("! Tagi bez nazwy w config.json: " + ", ".join(sorted(unknown)))


if __name__ == "__main__":
    sys.exit(main())
