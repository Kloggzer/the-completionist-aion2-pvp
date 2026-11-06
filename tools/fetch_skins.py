"""
Skins for the Markt page (web/src/features/market): the skin unlock items that can be traded on the market (not
"(Bound)"), with what they give: aion2data.com's skin dataset (https://aion2data.com/raw/skins.json, use with a link).

A skin unlocked for the first time gives its category collection points by grade (Common 1, Rare 2, Epic 3, Unique 4,
Heroic 5); every point is +0.1 % of that category's stat (statPerPoint), at most 500 points per category; it counts
while owned, it does not have to be worn. The unlock item is used up.

Output web/public/skins.json: { "source", "client", "total": number of skins, "items": [ { "item": unlock item id
(= aion2.exchange item_key), "skin": skin id, "name", "cat", "grade", "pts", "stat" } ] }

Usage:  python tools/fetch_skins.py
"""

import json
import os
import re
import urllib.request

URL = "https://aion2data.com/raw/skins.json"
OUT = os.path.join(os.path.dirname(__file__), "..", "web", "public", "skins.json")


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (TheCompletionist skins)"})
    d = json.load(urllib.request.urlopen(req, timeout=60))
    records = d.get("records") or d.get("skins") or []
    items = []
    for s in records:
        for u in s.get("unlockedBy") or []:
            if "(Bound)" in (u.get("name") or ""):
                continue
            name = re.sub(r"\s*\(Skin: [^)]*\)\s*$", "", u["name"]).strip()
            items.append({"item": u["id"], "skin": s["id"], "name": name, "cat": s.get("category") or "", "grade": s.get("grade") or "",
                          "pts": s.get("collectionPoints") or 0, "stat": (s.get("statPerPoint") or [""])[0]})
    items.sort(key=lambda x: (x["cat"], -x["pts"], x["name"]))
    out = {"source": "aion2data.com (" + URL + ")", "client": d.get("clientVersion"), "total": len(records), "items": items}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{len(records)} skins, {len(items)} tradeable unlock items -> {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
