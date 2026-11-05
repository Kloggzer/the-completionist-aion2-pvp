"""
Boss timelines for the boss mod (web/src/features/bossmod) from captures made by capture_logger.py.

Per boss npc (0x4136 spawn: entity varint, 3 bytes, u32 NpcData id) every skill it starts (0x0238: caster varint, 00,
u32 skill, u8 cast counter, u8, target varint, f32 angle, x, y, z) and when that cast ends (0x0638: caster varint,
u32 skill, u8 cast counter, 00). A fight runs from the boss's first cast to its death (0x4236 reason 03) or the last
cast. The boss's HP % at each cast comes from the Abyss Logs fight file with the same boss entity, if there is one
(%USERPROFILE%\\.abyss-dps-meter\\segments: section 3 list 2 = { ms, entity, hp }).

Which npcs are bosses: dungeon bosses only = the bossMobCode of every Abyss Logs boss fight with a zoneId (field
bosses have none; summaries.json), plus --npc ids.

Usage:  python tools/boss_timeline.py <capture-dir | encounters-dir | export.zip> [...] [--npc 2343601 ...] [--out web/public/bossmods.json]
Every fight is kept in tools/boss_fights.cache.json (entity ids and skills only, not committed), so a new recording adds
to the earlier ones; the timelines are summarized over all cached fights. "aliases" maps the other modes' npc ids of a
boss (Abyss Logs fights with the same name and boss number, e.g. Atiel 2300601 / 2346601) to the one with a timeline.
Without Abyss Logs a recording's boss comes from its file name (<time>_<npc>.enc.gz) and the HP from 0x008d.
"""

import argparse
import collections
import datetime
import gzip
import json
import os
import statistics
import struct
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from analyze_capture import lz4_block, split_frames, tcp_segment  # noqa: E402

try:
    import lz4.block as _lz4

    def unlz4(src, size):
        return _lz4.decompress(src, uncompressed_size=size)
except ImportError:  # pure Python fallback: slow on big captures (pip install lz4)
    unlz4 = lz4_block

BOSS_HP = 2_000_000  # dungeon bosses have 9-18 M, trash ~0.3 M
CACHE = os.path.join(os.path.dirname(__file__), "boss_fights.cache.json")
SEGMENTS = os.path.join(os.path.expanduser("~"), ".abyss-dps-meter", "segments")


def varint(b, i):
    r = s = 0
    while i < len(b):
        c = b[i]; i += 1
        r |= (c & 0x7F) << s; s += 7
        if c < 0x80:
            return r, i
    return None, i


def expand(op, body, depth=0):
    if op == 0xFFFF and len(body) >= 4 and depth < 4:
        try:
            raw = unlz4(body[4:], struct.unpack_from("<I", body)[0])
        except Exception:
            return
        for _, o2, b2 in split_frames(raw):
            yield from expand(o2, b2, depth + 1)
    else:
        yield op, body


def frames(cap):
    """(ts, op, body) of the server->client game frames, in capture order."""
    conns = [json.loads(l) for l in open(os.path.join(cap, "connections.jsonl"), encoding="utf-8")]
    ports = {c["rport"] for c in conns if c["proto"] == "tcp" and c.get("rport") not in (None, 0, 80, 443)
             and not str(c.get("remote", "")).startswith("127.")}
    streams = {}
    with open(os.path.join(cap, "game.pcap"), "rb") as f:
        f.read(24)
        while (h := f.read(16)) and len(h) == 16:
            sec, usec, n, _ = struct.unpack("<IIII", h)
            seg = tcp_segment(f.read(n))
            if not seg or seg[1] not in ports:
                continue
            _, sport, _, dport, seq, flags, data = seg
            st = streams.setdefault((sport, dport), {"next": None, "ooo": {}, "buf": bytearray()})
            if flags & 2:
                st["next"] = (seq + 1) & 0xFFFFFFFF
                continue
            if not data:
                continue
            if st["next"] is None:
                st["next"] = seq
            if (seq - st["next"]) & 0xFFFFFFFF >= 0x80000000:
                skip = (st["next"] - seq) & 0xFFFFFFFF
                if skip >= len(data):
                    continue
                data, seq = data[skip:], st["next"]
            if seq != st["next"]:
                st["ooo"][seq] = data
                if len(st["ooo"]) > 200:  # a lost segment: start over, framing resyncs
                    st.update(next=None, ooo={}, buf=bytearray())
                continue
            st["buf"] += data
            st["next"] = (seq + len(data)) & 0xFFFFFFFF
            while st["next"] in st["ooo"]:
                d = st["ooo"].pop(st["next"])
                st["buf"] += d
                st["next"] = (st["next"] + len(d)) & 0xFFFFFFFF
            gen, used = split_frames(bytes(st["buf"])), 0
            try:
                while True:
                    _, op, body = next(gen)
                    for o2, b2 in expand(op, body):
                        yield sec + usec / 1e6, o2, b2
            except StopIteration as e:
                used = e.value or 0
            del st["buf"][:used]


def encounter_frames(raw):
    """(ts, op, body) of one fight recording of the app (BossRecorder.cs): gzip of "ABENC1\\n", a JSON header line,
    then records { u8 kind, u32 ms, u16 op, varint length, body }; markers (kind 1) come as op -1, body = note."""
    b = gzip.decompress(raw)
    if not b.startswith(b"ABENC1\n"):
        return
    end = b.index(b"\n", 7)
    t0 = datetime.datetime.fromisoformat(json.loads(b[7:end])["start"].replace("Z", "+00:00")).timestamp()
    i = end + 1
    while i + 7 <= len(b):
        kind, ms, op = b[i], struct.unpack_from("<I", b, i + 1)[0], struct.unpack_from("<H", b, i + 5)[0]
        n, i = varint(b, i + 7)
        if n is None:
            break
        yield t0 + ms / 1000, (-1 if kind == 1 else op), b[i:i + n]
        i += n


def encounters(path):
    """Raw encounter files in a folder, a ZIP export or one file: [(name, bytes)] in time order."""
    if path.endswith(".zip"):
        z = zipfile.ZipFile(path)
        return sorted((n, z.read(n)) for n in z.namelist() if n.endswith(".enc.gz"))
    if os.path.isfile(path):
        return [(os.path.basename(path), open(path, "rb").read())]
    return sorted((n, open(os.path.join(path, n), "rb").read()) for n in os.listdir(path) if n.endswith(".enc.gz"))


def sources(path):
    """(start, frames) per source: a capture folder (game.pcap) or the app's fight recordings."""
    if os.path.isdir(path) and os.path.exists(os.path.join(path, "game.pcap")):
        yield json.load(open(os.path.join(path, "session.json"), encoding="utf-8"))["started"], frames(path), set()
        return
    for name, raw in encounters(path):
        try:
            fr = list(encounter_frames(raw))
        except (OSError, EOFError, ValueError) as e:  # unfinished / damaged file
            print(f"skip {name}: {e}")
            continue
        if fr:
            # each recording is its own world: a 0x0140 in front ends the previous file's entities
            hint = name.rsplit("_", 1)[-1].split(".")[0]
            yield fr[0][0], [(fr[0][0], 0x0140, b"")] + fr, ({int(hint)} if hint.isdigit() else set())


# ---------------------------------------------------------------- Abyss Logs

def pb(b):
    m, i = collections.defaultdict(list), 0
    while i < len(b):
        k, i = varint(b, i)
        f, wt = k >> 3, k & 7
        if wt == 0:
            v, i = varint(b, i)
        elif wt == 2:
            n, i = varint(b, i); v = bytes(b[i:i + n]); i += n
        elif wt == 1:
            i += 8; continue
        elif wt == 5:
            i += 4; continue
        else:
            raise ValueError(wt)
        m[f].append(v)
    return m


def summaries():
    path = os.path.join(SEGMENTS, "summaries.json")
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []


def abyss_fights(t0, t1):
    """Abyss Logs boss fights between t0 and t1: [{npc, name, start, ent, hp: [(s, hp)]}]."""
    path = os.path.join(SEGMENTS, "summaries.json")
    if not os.path.exists(path):
        return []
    out = []
    for e in json.load(open(path, encoding="utf-8")):
        if not e.get("hasBoss") or not e.get("bossMobCode") or not e.get("zoneId"):  # zoneId: dungeons only
            continue
        start = datetime.datetime.fromisoformat(e["startTime"].replace("Z", "+00:00")).timestamp()
        if not t0 - 600 <= start <= t1:
            continue
        try:
            b = open(os.path.join(SEGMENTS, e["id"] + ".abyss"), "rb").read()
            n, i = varint(b, 8)
            i += n
            secs = {}
            while i < len(b):
                t = b[i] | b[i + 1] << 8
                n, i = varint(b, i + 2)
                secs[t] = b[i:i + n]; i += n
            m = pb(secs[3])
            ents = [pb(x) for x in m.get(4, [])]
            boss = next(x[1][0] for x in ents if 2 in x and 3 in pb(x[2][0]))
            hp = sorted((x.get(1, [0])[0] / 1000, x[3][0]) for x in map(pb, m.get(2, [])) if x.get(2, [0])[0] == boss and 3 in x)
        except Exception:
            continue
        top = max((h for _, h in hp), default=0)
        out.append({"npc": e["bossMobCode"], "name": e["label"], "zone": e["zoneId"], "start": start, "ent": boss,
                    "hp": [(s, round(100 * h / top)) for s, h in hp] if top else []})
    return out


# ---------------------------------------------------------------- fights

def fights(t0, source, extra):
    logs = abyss_fights(t0, t0 + 7 * 86400)
    npcs = {f["npc"] for f in logs} | set(extra)
    hps = collections.defaultdict(list)  # entity -> [(ts, hp)] from 0x008d (no Abyss Logs fight)
    names = {f["npc"]: f["name"] for f in logs}
    zones = {f["npc"]: f["zone"] for f in logs}
    ents, open_, done = {}, {}, []  # entity -> npc, entity -> fight being recorded
    def close(ent):
        f = open_.pop(ent, None)
        if f and f["casts"]:
            done.append(f)
    for ts, op, b in source:
        if op == 0x0140:  # map change: every entity is gone
            for e in list(open_):
                close(e)
            ents.clear()
            continue
        if op not in (0x4136, 0x0238, 0x0638, 0x4236, 0x008d):
            continue
        ent, o = varint(b, 0)
        if ent is None:
            continue
        if op == 0x008d:
            if ent in ents and len(b) == o + 11 and b[o:o + 3] == bytes([2, 1, 0]):
                hps[ent].append((ts, struct.unpack_from("<q", b, o + 3)[0]))
            continue
        if op == 0x4136:
            if o + 7 <= len(b) and (npc := struct.unpack_from("<I", b, o + 3)[0]) in npcs:
                close(ent)
                ents[ent] = npc
        elif ent not in ents:
            continue
        elif op == 0x4236:
            if ent in open_ and o + 1 < len(b):
                open_[ent]["died"] = b[o + 1] == 3
            close(ent)
            del ents[ent]
        elif op == 0x0238 and o + 6 <= len(b) and b[o] == 0:
            skill, seq = struct.unpack_from("<I", b, o + 1)[0], b[o + 5]
            f = open_.setdefault(ent, {"npc": ents[ent], "ent": ent, "casts": [], "died": False})
            f["casts"].append({"ts": ts, "skill": skill, "seq": seq, "end": None})
        elif op == 0x0638 and o + 5 <= len(b) and ent in open_:
            skill, seq = struct.unpack_from("<I", b, o)[0], b[o + 4]
            for c in reversed(open_[ent]["casts"][-8:]):
                if c["seq"] == seq and c["skill"] == skill and c["end"] is None:
                    c["end"] = ts
                    break
    for e in list(open_):
        close(e)
    for f in done:
        pull = f["casts"][0]["ts"]
        log = min((l for l in logs if l["npc"] == f["npc"] and l["ent"] == f["ent"] and abs(l["start"] - pull) < 60),
                  key=lambda l: abs(l["start"] - pull), default=None)
        f["name"] = names.get(f["npc"], str(f["npc"]))
        f["zone"] = zones.get(f["npc"])
        own = hps.get(f["ent"], [])
        top = max((h for _, h in own), default=0)
        f["maxhp"] = top
        for c in f["casts"]:
            c["t"] = c["ts"] - pull
            c["hp"] = None
            if log and log["hp"]:
                at = c["ts"] - log["start"]
                c["hp"] = next((h for s, h in reversed(log["hp"]) if s <= at), 100)
            elif top:
                c["hp"] = round(100 * next((h for s, h in reversed(own) if s <= c["ts"]), top) / top)
    return done


def compact(f):
    """A fight for the cache: [t, skill, cast seconds or None, hp % or None] per cast start."""
    r = lambda v: None if v is None else round(v, 2)
    return {"npc": f["npc"], "name": f["name"], "zone": f.get("zone"),
            "casts": [[r(c["t"]), c["skill"], r(c["end"] - c["ts"]) if c["end"] else None, c["hp"]] for c in f["casts"]]}


def summarize(fs):
    """Per skill over all fights of one boss: casts per fight, first use, gap between uses, cast time, HP % range."""
    acc = collections.defaultdict(lambda: {"n": [], "first": [], "gap": [], "cast": [], "hp": []})
    for f in fs:  # compact fights (see compact)
        per = collections.defaultdict(list)
        for t, sk, cast, hp in f["casts"]:
            l = per[sk]
            if l and t - l[-1][0] < 0.4:  # the same cast on several targets
                continue
            l.append((t, cast, hp))
        for sk, l in per.items():
            a = acc[sk]
            a["n"].append(len(l))
            a["first"].append(l[0][0])
            a["gap"] += [y[0] - x[0] for x, y in zip(l, l[1:])]
            a["cast"] += [c for _, c, _ in l if c]
            a["hp"] += [h for _, _, h in l if h is not None]
    r1 = lambda v: round(v, 1)
    out = {}
    for sk, a in sorted(acc.items(), key=lambda x: statistics.median(x[1]["first"])):
        s = {"fights": len(a["n"]), "n": r1(statistics.median(a["n"])), "first": r1(statistics.median(a["first"]))}
        if a["gap"]:
            s["gap"] = [r1(min(a["gap"])), r1(statistics.median(a["gap"])), r1(max(a["gap"]))]
        if a["cast"]:
            s["cast"] = r1(statistics.median(a["cast"]))
        if a["hp"]:
            s["hp"] = [min(a["hp"]), max(a["hp"])]
        out[str(sk)] = s
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("captures", nargs="+")
    ap.add_argument("--npc", type=int, nargs="*", default=[])
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "web", "public", "bossmods.json"))
    args = ap.parse_args()
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    known = {f["npc"] for f in cache.values()}
    codes = {e["bossMobCode"] for e in summaries() if e.get("bossMobCode")}
    new = 0
    for cap in args.captures:
        for t0, src, hint in sources(cap):
            for f in fights(t0, src, set(args.npc) | hint | known):
                # a file name only names the fight's biggest npc: a boss if Abyss Logs knows it or it has boss HP
                if f["npc"] in hint and f["npc"] not in codes | known | set(args.npc) and f.get("maxhp", 0) < BOSS_HP:
                    continue
                key = f"{f['npc']}@{round(f['casts'][0]['ts'])}"
                new += key not in cache
                cache[key] = compact(f)
    with open(CACHE, "w", encoding="utf-8") as fh:
        json.dump(cache, fh)
    print(f"{new} new fights, {len(cache)} in the cache")
    by = collections.defaultdict(list)
    for f in cache.values():
        by[f["npc"]].append(f)
    data = json.load(open(args.out, encoding="utf-8")) if os.path.exists(args.out) else {"bosses": {}}
    for npc, fs in sorted(by.items()):
        b = data["bosses"].setdefault(str(npc), {})
        b["name"] = next((f["name"] for f in fs if f["name"] != str(npc)), fs[0]["name"])
        if z := next((f["zone"] for f in fs if f.get("zone")), None):
            b["zone"] = z
        b["fights"] = len(fs)
        b["dur"] = [round(f["casts"][-1][0]) for f in fs]
        b["skills"] = summarize(fs)
        print(f"{npc} {b['name']}: {len(fs)} fights, {len(b['skills'])} skills")
    # generic skills (the same id on 3+ bosses, e.g. the low-HP animation): never a mechanic
    seen = collections.Counter(sk for b in data["bosses"].values() for sk in b["skills"])
    for b in data["bosses"].values():
        for sk, st in b["skills"].items():
            if seen[sk] >= 3:
                st["common"] = True
    # other modes of the same boss: same name, same dungeon digits and boss number in the id
    core = lambda i: i // 100000 * 100000 + i % 1000
    have = {int(k): v["name"] for k, v in data["bosses"].items()}
    data["aliases"] = {str(e["bossMobCode"]): str(k) for e in summaries() if e.get("zoneId") and e.get("bossMobCode")
                       for k, n in have.items() if e["bossMobCode"] not in have and core(e["bossMobCode"]) == core(k) and e["label"] == n}
    data["source"] = "captures + Abyss Logs (tools/boss_timeline.py)"
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("->", os.path.abspath(args.out))


if __name__ == "__main__":
    main()
