"""
Game icons for the web UI (web/src/components/kit.tsx GameIcon): a fixed list of AION 2 icons, downloaded once,
shrunk and saved as WebP into web/public/icons/<key>.webp (bundled into the exe like the rest of web/public).

Sources:
  - NCSOFT's public asset CDN (the same files the plaync character website uses):
      https://assets.playnccdn.com/static-aion2-gamedata/resources/<Name>.png   (256 px, arcana cards 512 px)
  - fallback mirror with the client's file names (aion2data.com, free to use with a link):
      https://aion2data.com/game/<folder>/<Name>.webp
Game icons and art (c) NCSOFT (AION 2); the file names were looked up on aion2data.com.

Map markers and class emblems are white line art: they get a dark round plate ("plate") so they read on the light
theme too; markers with a lot of empty canvas are cropped to their content first ("crop").

Polite: one request per 0.4 s, browser User-Agent. Needs Pillow (pip install pillow).

Usage:  python fetch_icons.py [--out ../web/public/icons] [--only key,key]
"""

import argparse
import io
import os
import sys
import time
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
CDN = "https://assets.playnccdn.com/static-aion2-gamedata/resources/{}.png"
MIRROR = "https://aion2data.com/game/{}/{}.webp"
PLATE = (34, 31, 46, 255)  # dark plate behind white line art (the game's own UI colour)

# key -> (file name, size px, options); options: crop = cut to the content, plate = dark round plate,
# mirror = aion2data folder for the fallback
ICONS = {
    # charges
    "shugo": ("Icon_Item_Currency_Treasure_Key_Legend_004", 64, {"mirror": "items/usable"}),
    "invasion": ("Icon_Item_Currency_Treasure_Key_A_s_001", 64, {"mirror": "items/usable"}),
    "odyle": ("Icon_Item_Odenergy_A_001", 64, {"mirror": "items/usable"}),
    "nightmare": ("Icon_Ticket_Entrance_BossChallenge_001", 64, {"mirror": "items/usable"}),
    # checklist
    "ascension": ("Icon_Ticket_Entrance_Awaken_001", 64, {"mirror": "items/usable"}),
    "dungeon": ("Icon_Item_Dungeon_Reward_Tickt_A_01", 64, {"mirror": "items/usable"}),
    "arena": ("ICON_Abnormal_RankingReward_ArenaSingle", 64, {"mirror": "abnormal"}),
    "coop-arena": ("ICON_Abnormal_RankingReward_ArenaTeam", 64, {"mirror": "abnormal"}),
    "duty": ("UT_NP_QuestObj_Duty", 64, {"crop": True, "plate": True, "mirror": "ui"}),
    "duty-commands": ("Icon_Item_QuestScroll_A_001", 64, {"mirror": "items/usable"}),
    "ludra": ("UT_256_MOB_Durbati_01_V01", 64, {"mirror": "mobs"}),
    "odyle-craft": ("UT_Marker_Alchemist", 64, {"crop": True, "plate": True, "mirror": "ui"}),
    # currencies
    "kinah": ("Icon_gold", 64, {"mirror": "items/currency"}),
    "abyss": ("Icon_abysspoint", 64, {"mirror": "items/currency"}),
    # classes (key = the class's English name in daevanion.json, lower case)
    **{"class-" + k: ("UT_Class_%s_Large" % f, 128, {"crop": True, "plate": True, "mirror": "classes"}) for k, f in [
        ("gladiator", "Gladiator"), ("templar", "Templar"), ("ranger", "Ranger"), ("assassin", "Assassin"),
        ("sorcerer", "Sorcerer"), ("spiritmaster", "Elementalist"), ("cleric", "Cleric"), ("chanter", "Chanter"),
        ("brawler", "Fighter")]},
    # arcana card art: one picture per kind and set, the same for every grade
    **{"arcana-%s-%s" % (k, s.lower()): ("Icon_Arcana_Card_%s_u_%s" % (f, s), 128, {"mirror": "items/arcana"}) for k, f in [
        ("chalice", "Grail"), ("parchment", "Parchment"), ("compass", "Compass"), ("bell", "Bell"), ("mirror", "Mirror")]
       for s in ("PveSet2", "DefenceSet2")},
}

_last = 0.0


def get(url):
    global _last
    time.sleep(max(0.0, _last + 0.4 - time.time()))
    _last = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            return r.read()
    except Exception as e:  # 404 or offline: the caller tries the next source
        print("  ", url, "->", e)
        return None


def shape(raw, size, opt):
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    if opt.get("crop"):
        box = im.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
        if box:
            im = im.crop(box)
    # square canvas, centred
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    if not opt.get("plate"):
        return sq.resize((size, size), Image.LANCZOS)
    # white art on a dark disc: the art at 64 % of the disc (supersampled for a smooth edge)
    big = size * 4
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(out).ellipse((0, 0, big - 1, big - 1), fill=PLATE)
    art = sq.resize((int(big * 0.64), int(big * 0.64)), Image.LANCZOS)
    out.alpha_composite(art, ((big - art.width) // 2, (big - art.height) // 2))
    return out.resize((size, size), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "public", "icons"))
    ap.add_argument("--only", default="", help="comma-separated keys")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    only = {k for k in a.only.split(",") if k}
    missing = []
    for key, (name, size, opt) in ICONS.items():
        if only and key not in only:
            continue
        raw = get(CDN.format(name)) or get(MIRROR.format(opt.get("mirror", "items"), name))
        if not raw:
            missing.append(key)
            continue
        path = os.path.join(a.out, key + ".webp")
        shape(raw, size, opt).save(path, "WEBP", quality=88, method=6)
        print(key, "<-", name, os.path.getsize(path), "bytes")
    print("wrote", a.out, "missing:", ", ".join(missing) or "none")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
