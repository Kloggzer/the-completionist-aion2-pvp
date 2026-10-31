"""
Group dungeon data for the PvP window's dungeon panel (web/src/features/pvp/dungeon.ts) from aion2data.com's datasets
read from the game client (free to use with a link) into web/public/bosses.json:
  - https://aion2data.com/raw/boss-mechanics.json: per boss the Frenzy time per mode and the mechanics (skill, cast and
    cooldown seconds, the reaction, the guide's line) and players' note titles
  - https://aion2data.com/raw/monsters.json: the boss's level range and its named skills by damage type
    (HP and combat stats are not in the client)
  - https://aion2data.com/raw/drop-rates.json: what a clear of the dungeon gives per mode (items whose best source is
    that dungeon mode), with the chance per clear
  - https://aion2data.com/raw/items.json: item id -> name, grade into web/public/itemnames.json (the own loot, read
    from the inventory updates, carries only the id)

Output: { "dungeons": { name: { "bosses": [ { "boss", "enrage": [[s, mode]], "mech": [[skill, cast, cd, action, guide]],
  "notes": [title], "lv": [min, max], "dmg": {type: n} } ], "loot": { mode: { "n": items, "top": [[item, grade, chance %]] } } } } }

Usage:  python fetch_bosses.py [--out ../web/public/bosses.json]
"""

import argparse
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
GRADE = {"Unique": 5, "Epic": 4, "Legend": 4, "Heroic": 3, "Rare": 2, "Special": 1, "Common": 0}


def get(name):
    with urllib.request.urlopen(urllib.request.Request("https://aion2data.com/raw/" + name, headers={"User-Agent": UA}), timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "bosses.json"))
    a = ap.parse_args()
    mech = get("boss-mechanics.json")
    out = {}
    for x in mech["records"]:
        if x["kind"] not in ("mechanic", "note") or not x.get("boss"):
            continue
        bosses = out.setdefault(x["dungeon"], {"bosses": [], "loot": {}})["bosses"]
        b = next((y for y in bosses if y["boss"] == x["boss"]), None)
        if b is None:
            b = {"boss": x["boss"], "enrage": [], "mech": [], "notes": []}
            bosses.append(b)
        if x["kind"] == "note":
            if x.get("title"):
                b["notes"].append(x["title"])
        elif x.get("enrageSeconds"):
            b["enrage"] = x["enrageSeconds"]
        elif x.get("skill") or x.get("guide"):
            b["mech"].append([x.get("skill") or "", x.get("castSeconds") or 0, x.get("cooldownSeconds") or 0, x.get("action") or "", x.get("guide") or ""])
    mons = {m["name"]: m for m in get("monsters.json")["records"] if m.get("boss")}
    for d in out.values():
        for b in d["bosses"]:
            m = mons.get(b["boss"])
            if not m:
                continue
            b["lv"] = m.get("level") or []
            dmg = {}
            for sk in m.get("skills") or []:
                if sk.get("damage"):
                    dmg[sk["damage"]] = dmg.get(sk["damage"], 0) + 1
            b["dmg"] = dmg
    for r in get("drop-rates.json")["records"]:
        if r.get("bestSourceKind") != "dungeon clear" or r.get("bestSource") not in out:
            continue
        mode = r.get("bestSourceDetail") or ""
        loot = out[r["bestSource"]]["loot"].setdefault(mode, {"n": 0, "items": []})
        loot["n"] += 1
        loot["items"].append([r.get("item") or "", r.get("grade") or "", round((r.get("chance") or 0) * 100, 2)])
    for d in out.values():
        for loot in d["loot"].values():
            # the best grades first, then the likeliest
            loot["top"] = sorted(loot.pop("items"), key=lambda i: (-GRADE.get(i[1], 0), -i[2]))[:4]
    res = {"source": "aion2data.com", "client": mech.get("clientVersion"), "dungeons": out}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", a.out, len(out), "dungeons", os.path.getsize(a.out), "bytes")
    names = {str(i["id"]): [i["name"], i.get("grade") or ""] for i in get("items.json")["records"] if i.get("name")}
    np = os.path.join(os.path.dirname(a.out), "itemnames.json")
    with open(np, "w", encoding="utf-8") as f:
        json.dump(names, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", np, len(names), "items", os.path.getsize(np), "bytes")


if __name__ == "__main__":
    main()
