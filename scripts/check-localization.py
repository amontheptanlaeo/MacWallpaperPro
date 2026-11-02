#!/usr/bin/env python3
"""Check the macOS app's translations (Localization/<code>.json) against the code.

Every string passed to tr("...") in Sources/MacWallpaperPro/*.swift must exist in every language
file, no file may have unused keys, and printf placeholders (%@, %d, %1$@ ...) must match.

Usage: scripts/check-localization.py [code ...]   (default: every Localization/*.json)
Exit code 1 on any problem. Used by CI (.github/workflows/ci.yml).
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LANGS = ["en", "th", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "it", "pt-BR", "ru", "tr", "id", "vi", "hi", "ar"]
TR = re.compile(r'\btr\(\s*"((?:[^"\\]|\\.)*)"')
PH = re.compile(r"%(?:\d+\$)?[@d]")


def code_keys():
    keys, ok = set(), True
    for f in sorted(glob.glob(os.path.join(ROOT, "Sources/MacWallpaperPro/*.swift"))):
        src = open(f, encoding="utf-8").read()
        for m in TR.finditer(src):
            k = m.group(1)
            if "\\(" in k:
                print(f"INTERPOLATION IN KEY {os.path.relpath(f, ROOT)}: {k}")
                ok = False
                continue
            keys.add(json.loads('"' + k + '"'))
    return keys, ok


def main(argv):
    keys, ok = code_keys()
    files = {os.path.basename(p)[:-5] for p in glob.glob(os.path.join(ROOT, "Localization/*.json"))}
    for code in LANGS:
        if code not in files:
            print(f"MISSING FILE Localization/{code}.json")
            ok = False
    for code in sorted(files - set(LANGS)):
        print(f"UNEXPECTED FILE Localization/{code}.json")
        ok = False
    for code in argv or sorted(files & set(LANGS)):
        d = json.load(open(os.path.join(ROOT, f"Localization/{code}.json"), encoding="utf-8"))
        missing = sorted(keys - d.keys())
        unused = sorted(d.keys() - keys)
        empty = sorted(k for k in keys & d.keys() if not str(d[k]).strip())
        badph = sorted(k for k in keys & d.keys() if sorted(PH.findall(k)) != sorted(PH.findall(d[k])))
        print(f"{code}: code keys={len(keys)} json keys={len(d)} missing={len(missing)} unused={len(unused)} empty={len(empty)} placeholder-mismatch={len(badph)}")
        for k in missing:
            print("  MISSING", k)
        for k in unused:
            print("  UNUSED", k)
        for k in empty:
            print("  EMPTY", k)
        for k in badph:
            print("  PLACEHOLDER", k, "->", d[k])
        ok &= not (missing or unused or empty or badph)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
