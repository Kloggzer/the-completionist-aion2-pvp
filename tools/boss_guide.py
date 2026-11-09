"""
Boss guide skeleton for the boss helper (web/public/bossguide.json): per dungeon boss with a timeline (bossmods.json)
its Frenzy time, phases and mechanics, prepared from aion2data.com (web/public/bosses.json via fetch_bosses.py) and the
phase skills found in the fights. The guide is edited by hand afterwards: what to do (kind), callout text, phase names,
the boss's skill ids per mechanic. Entries with "todo": true are guesses / placeholders waiting for real values.

Running it again only ADDS bosses, phases and mechanics that are missing; nothing written by hand is changed.

Usage:  python tools/boss_guide.py
"""

import json
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "web", "public")
GUIDE = os.path.join(ROOT, "bossguide.json")
# aion2data's reaction -> the boss helper's kind (web/src/features/bossmod/logic.ts KINDS)
KIND = {"spread": "spread", "stack": "stack", "in": "in", "out": "out", "stagger": "interrupt", "break": "interrupt", "stop": "interrupt",
        "dodge": "dodge", "jump": "dodge", "lane": "dodge", "behind": "dodge", "tank": "tank", "block": "tank"}


def main():
    mods = json.load(open(os.path.join(ROOT, "bossmods.json"), encoding="utf-8"))["bosses"]
    a2d = json.load(open(os.path.join(ROOT, "bosses.json"), encoding="utf-8"))["dungeons"]
    by_name = {b["boss"]: (d, b) for d, v in a2d.items() for b in v["bosses"]}
    guide = json.load(open(GUIDE, encoding="utf-8")) if os.path.exists(GUIDE) else {}
    guide.setdefault("_info", "Boss helper guide (tools/boss_guide.py, then by hand). kind: dodge|out|in|move|stack|spread|interrupt|tank|info; "
                              "skills: the boss's skill ids (Boss-Helfer page / recordings); todo: placeholder, real values follow.")
    bosses = guide.setdefault("bosses", {})
    for npc, m in sorted(mods.items()):
        g = bosses.setdefault(npc, {"name": m["name"]})
        d, a = by_name.get(m["name"], (None, None))
        if d and "dungeon" not in g:
            g["dungeon"] = d
        if a and a["enrage"] and "frenzy" not in g:
            g["frenzy"] = max(s for s, _ in a["enrage"])
        # phases: the skills boss_timeline.py marks as phase skills ("phase": HP %); placeholders it no longer confirms go
        found = {int(sk): s["phase"] for sk, s in m["skills"].items() if "phase" in s and not s.get("common")}
        phases = g["phases"] = [p for p in g.get("phases", []) if not p.get("todo") or p.get("skill") in found]
        for sk, hp in found.items():
            if not any(p.get("skill") == sk for p in phases):
                phases.append({"hp": hp, "name": "Phase", "skill": sk, "todo": True})
        phases.sort(key=lambda p: -p["hp"])
        for i, p in enumerate(phases):  # placeholder names follow the HP order (phase 1 = the pull)
            if p.get("todo") and p["name"].startswith("Phase "):
                p["name"] = f"Phase {i + 2}"
        mech = g.setdefault("mechanics", [])
        have = {x["name"] for x in mech}
        for name, cast, cd, action, hint in (a or {}).get("mech", []):
            hint = hint.replace(", kru!", "").replace(" kru!", "").replace("kru!", "").strip(" ,")
            name = name or (hint[:40] + ("…" if len(hint) > 40 else "")) or f"Mechanik {len(mech) + 1}"
            if name in have:
                continue
            x = {"name": name, "skills": [], "todo": True}
            if KIND.get(action):
                x["kind"] = KIND[action]
            if cast:
                x["cast"] = cast
            if hint:
                x["hint"] = hint
            mech.append(x)
            have.add(name)
        for note in (a or {}).get("notes", []):
            if note not in have:
                mech.append({"name": note, "skills": [], "todo": True})
                have.add(note)
    with open(GUIDE, "w", encoding="utf-8") as f:
        json.dump(guide, f, ensure_ascii=False, indent=1)
    n = sum(len(b["mechanics"]) for b in bosses.values())
    print(f"{len(bosses)} bosses, {sum(len(b['phases']) for b in bosses.values())} phases, {n} mechanics -> {os.path.abspath(GUIDE)}")


if __name__ == "__main__":
    main()
