"""
German pet names for the UI (pet names follow the app language) from aion2.app's pet list (/de/db/pets, the page's
schema.org ItemList: name + url with the game pet id, the same ids as pets.json and petIds.json). A few list pages,
one request per second, browser User-Agent; /api/ is never touched (robots.txt).

Output web/src/features/pets/petNamesDe.json: { "<pet id>": "German name" }

Usage:  python fetch_petnames.py [--out ../web/src/features/pets/petNamesDe.json]
"""

import argparse
import html
import json
import os
import re
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
LIST = "https://aion2.app/de/db/pets?page={}"


def page(n):
    req = urllib.request.Request(LIST.format(n), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        h = r.read().decode("utf-8")
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        try:
            d = json.loads(block)
        except ValueError:
            continue
        for x in d if isinstance(d, list) else [d]:
            lst = x.get("mainEntity") if isinstance(x, dict) else None
            if isinstance(lst, dict) and lst.get("itemListElement"):
                return lst.get("numberOfItems") or 0, [(i["url"], i["name"]) for i in lst["itemListElement"]]
    return 0, []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "src", "features", "pets", "petNamesDe.json"))
    a = ap.parse_args()
    names, total, n = {}, None, 1
    while True:
        cnt, items = page(n)
        total = total or cnt
        for url, name in items:
            m = re.search(r"/db/pets/(\d+)", url)
            if m: names[m.group(1)] = html.unescape(name).strip()
        if not items or (total and len(names) >= total) or n >= 20: break
        n += 1
        time.sleep(1)
    out = dict(sorted(names.items(), key=lambda kv: int(kv[0])))
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
        f.write("\n")
    print("wrote", a.out, len(out), "of", total, "pets from", n, "pages")


if __name__ == "__main__":
    main()
