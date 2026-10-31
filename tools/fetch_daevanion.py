"""
Download the Daevanion boards of every class from NCSOFT's public character website (aion2.plaync.com) into
web/public/daevanion.json (served to the UI, see web/src/features/daevanion/).

The website shows any character's boards; the board layout itself does not depend on the character, only on the
board id (class * 10 + slot). One reference character (any level-45 hit of the public search) is enough.
English and German names come from two requests per board (lang=en-US / de-DE).

Output, per class: name (en/de), skill names (en/de) and per board the nodes as
  [row, col, grade, kind, ref]   grade 0 None 1 Common 2 Rare 3 Legend 4 Unique (= point cost, 0 for Start)
                                 kind  0 Start 1 Stat 2 Skill;  ref = index into stats (kind 1) / skills (kind 2)
Stats are shared: key (English effect name), en/de label, percent flag; a stat node lists [statIdx, value] pairs.

The Ariel board (slot 5, own points, the same for every class) is not on the plaync website yet; it comes from
aion2data.com's datasets read from the game client (https://aion2data.com/raw/daevanion.json, free to use with a link),
together with the skill levels at which active skills gain a specialization (https://aion2data.com/raw/skill-levels.json):
per skill "spec": {level: [what opens]} -> the default breakpoints of that skill in the app.

Polite: one request per 0.4 s, browser User-Agent.

Usage:  python fetch_daevanion.py [--region eu] [--out ../web/public/daevanion.json]
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
SEARCH = "https://api-search.plaync.com/aion2global/search/v2/character"
DETAIL = "https://aion2.plaync.com/api/character/daevanion/detail"
CLASSES = {1: "Gladiator", 2: "Templar", 3: "Ranger", 4: "Assassin", 5: "Spiritmaster", 6: "Sorcerer", 7: "Cleric", 8: "Chanter", 9: "Brawler"}
CLASSES_DE = {1: "Gladiator", 2: "Templer", 3: "Waldläufer", 4: "Assassine", 5: "Beschwörer", 6: "Magier", 7: "Kleriker", 8: "Kantor", 9: "Brawler"}
# slot -> (name, unlock level, point pool). Slot 5 (Ariel) is not on the global servers yet.
SLOTS = {1: ("Nezekan", 12, "pve"), 2: ("Zikel", 20, "pve"), 3: ("Vaizel", 30, "pve"), 4: ("Triniel", 40, "pve"), 6: ("Azphel", 45, "pvp")}
GRADE = {"None": 0, "Common": 1, "Rare": 2, "Legend": 3, "Unique": 4}
A2D = "https://aion2data.com/raw/"
# aion2data stat names -> the keys the plaync boards use; German labels for stats plaync does not show yet (Ariel)
A2D_KEY = {"Max HP": "HP", "Max MP": "MP", "Attack": "Attack Bonus", "Defense": "Defense Bonus"}
A2D_DE = {"PvE Attack": "Angriffskraft (PvE)", "PvE Defense": "Verteidigung (PvE)", "PvE Accuracy": "Präzision (PvE)",
          "PvE Evasion": "Ausweichen (PvE)", "PvE Damage Boost": "Schadensverstärkung (PvE)",
          "PvE Damage Tolerance": "Schadensresistenz (PvE)", "Boss Attack": "Angriffskraft (Boss)",
          "Boss Defense": "Verteidigung (Boss)", "Boss Damage Boost": "Schadensverstärkung (Boss)",
          "Boss Damage Tolerance": "Schadensresistenz (Boss)"}
_last = 0.0


def get(url):
    global _last
    for attempt in range(4):
        time.sleep(max(0.0, _last + 0.4 - time.time()))
        _last = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"  {url}: {e} - retry", file=sys.stderr)
            time.sleep(2 ** attempt)
    raise RuntimeError("giving up on " + url)


def reference(region):
    for kw in ("Mar", "Ka", "Lu"):
        q = urllib.parse.urlencode({"keyword": kw, "region": region, "localeInfo": "en-US", "size": 40})
        for h in get(f"{SEARCH}?{q}").get("list") or []:
            if h.get("level") == 45:
                return h["characterId"], h["serverId"]
    raise RuntimeError("no level-45 reference character found")


def skill_name(n):
    e = (n["effectList"] or [{"desc": ""}])[0]["desc"].rsplit(" +", 1)[0].strip()
    return e or re.split(r"\s[-–]\s", n["name"], maxsplit=1)[-1].strip()


EFFECT = re.compile(r"^(.*?)\s*([+-][\d.]+)(%?)$")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="eu")
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "daevanion.json"))
    a = ap.parse_args()
    cid, sid = reference(a.region)
    stats, stat_idx = [], {}
    classes = {}
    for c, cname in CLASSES.items():
        skills, skill_idx, boards = [], {}, {}
        for slot, (bname, level, pool) in SLOTS.items():
            bid = c * 10 + slot
            res = {}
            for lang in ("en-US", "de-DE"):
                q = f"lang={lang}&characterId={cid}&serverId={sid}&region={a.region}&boardId={bid}"
                res[lang] = {(n["row"], n["col"]): n for n in get(f"{DETAIL}?{q}")["nodeList"]}
            nodes = []
            for pos, n in sorted(res["en-US"].items()):
                de = res["de-DE"].get(pos, n)
                g = GRADE.get(n["grade"], 0)
                if n["type"] == "Start":
                    nodes.append([*pos, 0, 0, 0])
                elif n["type"] == "Stat":
                    eff = []
                    for e, ed in zip(n["effectList"], de["effectList"]):
                        m, md = EFFECT.match(e["desc"]), EFFECT.match(ed["desc"])
                        key = m.group(1)
                        if key not in stat_idx:
                            stat_idx[key] = len(stats)
                            stats.append({"key": key, "en": key, "de": md.group(1).rstrip(" −-") if md else key, "pct": m.group(3) == "%"})
                        eff.append([stat_idx[key], float(m.group(2))])
                    nodes.append([*pos, g, 1, eff])
                elif n["type"] == "SkillLevel":
                    # the effect names the skill as the skill window does ("Skill Level Up - X" can differ); Brawler
                    # boards have an empty effect name, then the node name after the dash
                    en, dn = skill_name(n), skill_name(de)
                    if en not in skill_idx:
                        skill_idx[en] = len(skills)
                        skills.append({"en": en, "de": dn, "active": g == 3})
                    nodes.append([*pos, g, 2, skill_idx[en]])
            boards[slot] = {"name": bname, "level": level, "pool": pool, "nodes": nodes}
            print(f"{cname} {bname}: {len(nodes)} nodes, cost {sum(x[2] for x in nodes)}")
        classes[c] = {"en": cname, "de": CLASSES_DE[c], "skills": skills, "boards": boards}
    add_aion2data(classes, stats, stat_idx)
    out = {"source": "aion2.plaync.com, aion2data.com", "date": time.strftime("%Y-%m-%d"), "stats": stats, "classes": classes}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", a.out, os.path.getsize(a.out), "bytes")


A2D_EFFECT = re.compile(r"^(.*?)\s+([\d.]+)(%?)$")


def add_aion2data(classes, stats, stat_idx):
    """Ariel board (slot 5) for every class and the specialization levels of active skills, from aion2data.com."""
    boards = get(A2D + "daevanion.json")["records"]
    by_name = {v["en"]: k for k, v in classes.items()}
    for r in boards:
        c = by_name.get(r["class"])
        if r["board"] != "Ariel" or c is None:
            continue
        nodes = []
        for n in sorted(r["nodes"], key=lambda n: (n["row"], n["col"])):
            eff = n.get("effects") or []
            if not eff:
                nodes.append([n["row"], n["col"], 0, 0, 0])
                continue
            out = []
            for e in eff:
                m = A2D_EFFECT.match(e)
                key = A2D_KEY.get(m.group(1), m.group(1))
                if key not in stat_idx:
                    stat_idx[key] = len(stats)
                    stats.append({"key": key, "en": key, "de": A2D_DE.get(key, key), "pct": m.group(3) == "%"})
                out.append([stat_idx[key], float(m.group(2))])
            nodes.append([n["row"], n["col"], n["cost"], 1, out])
        classes[c]["boards"][5] = {"name": "Ariel", "level": r["level"], "pool": "ariel", "nodes": nodes, "source": "aion2data.com"}
        print(f"{r['class']} Ariel (aion2data): {len(nodes)} nodes, cost {sum(x[2] for x in nodes)}")
    for r in get(A2D + "skill-levels.json")["records"]:
        c = by_name.get(r["class"])
        sk = c and next((x for x in classes[c]["skills"] if x["en"] == r["skill"]), None)
        if sk:
            sk["spec"] = {k.replace("level ", ""): v for k, v in r["specializations"].items()}


if __name__ == "__main__":
    main()
