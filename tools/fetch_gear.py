"""
Gear items for the Build tab (web/src/features/build/gear.ts) from aion2data.com's dataset read from the game client
(https://aion2data.com/raw/items.json, free to use with a link) into web/public/gear.json.

Kept: equipment from required level 40 with a soul binding pool. Per item:
  [id, name, category, grade, itemLevel, faction, fixed stats {name: number}, properties per binding,
   pool [[stat, low, high, chance %]]]

Usage:  python fetch_gear.py [--out ../web/public/gear.json]
"""

import argparse
import json
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
NUM = re.compile(r"-?[\d.]+")


def num(s):
    m = NUM.search(str(s).replace(",", ""))
    return float(m.group(0)) if m else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "gear.json"))
    a = ap.parse_args()
    with urllib.request.urlopen(urllib.request.Request("https://aion2data.com/raw/items.json", headers={"User-Agent": UA}), timeout=120) as r:
        d = json.loads(r.read().decode("utf-8"))
    out = []
    for x in d["records"]:
        if x.get("requiredLevel", 0) < 40 or not x.get("extraStats"):
            continue
        pool = []
        for s in x["extraStats"]:
            lo, _, hi = str(s["range"]).replace(",", "").partition("–")
            pool.append([s["stat"], num(lo), num(hi or lo), round(s.get("chance", 0), 2)])
        out.append([x["id"], x["name"], x["category"], x["grade"], x["itemLevel"], x["faction"],
                    {k: num(v) for k, v in x["stats"].items()}, x.get("soulBindProperties", 0), pool])
    res = {"source": "aion2data.com", "client": d.get("clientVersion"), "items": out}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", a.out, len(out), "items", os.path.getsize(a.out), "bytes")


if __name__ == "__main__":
    main()
