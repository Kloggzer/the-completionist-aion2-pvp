"""
Arcana card data for the Arcana tab (web/src/features/arcana) from aion2data.com's dataset read from the game client
(free to use with a link): https://aion2data.com/raw/arcana-skills.json – per class and skill the card kind whose list
holds it and the chance one binding of a Common / Rare / Epic / Unique card gives it (also on the Chalice, which holds
every skill), the levels the skill still needs after skill points and Daevanion; per card kind its list size, skills
per binding, highest enhance level, main effects and where it drops; the drop chance per clear per Transcendence stage;
Transmute's cost and picks.

Output web/public/arcana.json:
  { "date", "client", "cards": { kind: { "n", "line", "per": {grade: n}, "top": {grade: n}, "main": [..], "drops": [..] } },
    "classes": { class: [[skill, id, "A"|"P", kind, [c, r, e, u], [chalice c, r, e, u], levels still needed]] },
    "drops": [[dungeon, stage, kind, grade, % per clear]], "transmute": {...} }

Usage:  python fetch_arcana.py [--out ../web/public/arcana.json]
"""

import argparse
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
GRADES = ["Common", "Rare", "Epic", "Unique"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "arcana.json"))
    a = ap.parse_args()
    req = urllib.request.Request("https://aion2data.com/raw/arcana-skills.json", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.loads(r.read().decode("utf-8"))
    cards, classes, drops, transmute = {}, {}, [], None
    for x in d["records"]:
        k = x["kind"]
        if k == "card":
            cards[x["card"]] = {"n": x["listSize"], "line": x.get("gameLine") or "", "per": x["skillsAtBinding"], "top": x["topEnhance"],
                                "main": x.get("mainEffects") or [], "drops": x.get("dropsIn") or []}
        elif k == "skill":
            classes.setdefault(x["class"], []).append([x["skill"], x["skillId"], "A" if x["skillType"] == "Active" else "P", x["card"],
                                                       [round(x["chance"][g], 2) for g in GRADES], [round(x["onChalice"][g], 2) for g in GRADES],
                                                       x.get("levelsStillNeeded") or 0])
        elif k == "drop":
            drops.append([x["dungeon"], x["stage"], x["card"], x["grade"], round(x["chancePerClear"], 2)])
        elif k == "transmute":
            transmute = {"grade": x["grade"], "material": x["material"], "n": x["materialCount"], "kinah": x["kinah"], "picks": x["picks"], "extra": x.get("extraPerPick")}
    res = {"source": "aion2data.com", "date": d.get("readOn"), "client": d.get("clientVersion"), "cards": cards, "classes": classes, "drops": drops, "transmute": transmute}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", a.out, len(classes), "classes", len(cards), "cards", os.path.getsize(a.out), "bytes")


if __name__ == "__main__":
    main()
