"""
Extract pet collection progress from a capture.

Frame 0x0090 (S2C, once at login):
    u32  active pet id
    varint n, n x { u32 pet_id, u32 pet_id, u32 level }        -- unlocked pets
    varint m, m x { u32 pet_id, u32 souls }                     -- soul counter per pet
    ... species knowledge blocks (not needed here)
Frame 0x0d90 (S2C, live): varint n, n x { u32 pet_id, u32 souls_gained }
Soul counter = progress within the current level (5 / 25 / 75 to reach lv1 / lv2 / lv3).

Pet names / categories / dropping monsters: aion2maps.com/map/assets/pets.json

Usage:  python pet_status.py <capture-dir> [--pets pets.json] [--out pet_state.json]
"""

import argparse
import json
import os
import struct
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze_capture as ac  # noqa: E402

PETS_URL = "https://aion2maps.com/map/assets/pets.json"
OP_PET_LIST = 0x0090
OP_PET_SOULS = 0x0d90
# Souls needed to reach the next level; the counter resets on level-up (verified in-game: lv1 8/25, lv2 17/75).
NEXT_LEVEL_SOULS = {0: 5, 1: 25, 2: 75}


def varint(b, o):
    v = s = 0
    while True:
        x = b[o]
        o += 1
        v |= (x & 0x7F) << s
        s += 7
        if not x & 0x80:
            return v, o


def parse_pet_list(b):
    active = struct.unpack_from("<I", b, 0)[0]
    n, o = varint(b, 4)
    levels = {}
    for _ in range(n):
        pid, _, lv = struct.unpack_from("<III", b, o)
        levels[pid] = lv
        o += 12
    n, o = varint(b, o)
    souls = {}
    for _ in range(n):
        pid, cnt = struct.unpack_from("<II", b, o)
        souls[pid] = cnt
        o += 8
    return active, levels, souls


def parse_soul_update(b):
    n, o = varint(b, 0)
    out = []
    for _ in range(n):
        out.append(struct.unpack_from("<II", b, o))
        o += 8
    return out


def load_frames(capture):
    """Yields (ts, opcode, body) of server->client frames, via analyze_capture's reassembly."""
    conns = [json.loads(l) for l in open(os.path.join(capture, "connections.jsonl"), encoding="utf-8")]
    ports = {c["rport"] for c in conns if c["proto"] == "tcp" and c.get("rport") not in (None, 0, 80, 443)
             and not str(c.get("remote", "")).startswith("127.")}
    streams = {}
    for ts, pkt in ac.read_pcap(os.path.join(capture, "game.pcap")):
        seg = ac.tcp_segment(pkt)
        if seg and seg[1] in ports:
            streams.setdefault((seg[1], seg[3]), ac.Stream()).add(ts, seg[4], seg[5], seg[6])
    frames = []
    for st in streams.values():
        buf, stamps = bytearray(), []
        for ts, d in st.chunks:
            stamps.append((len(buf), ts))
            buf += d
        si = 0
        for off, op, body in ac.split_frames(bytes(buf)):
            while si + 1 < len(stamps) and stamps[si + 1][0] <= off:
                si += 1
            for op2, b2, _ in ac.expand(op, body):
                frames.append((stamps[si][1], op2, b2))
    return sorted(frames, key=lambda f: f[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--pets", help="local pets.json (default: download from aion2maps)")
    ap.add_argument("--out", help="write pet state json")
    args = ap.parse_args()

    if args.pets:
        pets_doc = json.load(open(args.pets, encoding="utf-8"))
    else:
        with urllib.request.urlopen(PETS_URL) as r:
            pets_doc = json.load(r)
    pets = {p["id"]: p for p in pets_doc["pets"]}

    levels, souls, active, updates = None, None, None, []
    for ts, op, body in load_frames(args.capture):
        if op == OP_PET_LIST:
            active, levels, souls = parse_pet_list(body)
        elif op == OP_PET_SOULS and souls is not None:
            for pid, gained in parse_soul_update(body):
                souls[pid] = souls.get(pid, 0) + gained
                updates.append((ts, pid, gained, souls[pid]))
    if levels is None:
        sys.exit("Kein Pet-Listen-Frame (0x0090) gefunden – Logger muss vor dem Login laufen.")

    state = []
    for pid, p in sorted(pets.items(), key=lambda kv: (kv[1]["c"], kv[1]["n"])):
        lv, s = levels.get(pid, 0), souls.get(pid, 0)
        state.append({"id": pid, "name": p["n"], "cat": p["c"], "level": lv, "souls": s,
                      "unlocked": lv > 0, "need": NEXT_LEVEL_SOULS.get(lv), "npc": p["npc"], "global": not p.get("ng")})

    # aion2maps flags some pets as "not in Global" (ng) – if you own one, it obviously is.
    glob = [s for s in state if s["global"] or s["unlocked"]]
    other = len([pid for pid in levels if pid not in pets])
    print(f"Aktives Pet: {pets.get(active, {}).get('n', active)}")
    print(f"Freigeschaltet gesamt: {len(levels)} (davon {other} ohne Souls, z. B. Quest/Shop)")
    print(f"Soul-Pets: {sum(s['unlocked'] for s in glob)}/{len(glob)}\n")
    for cat in pets_doc["categories"]:
        rows = [s for s in glob if s["cat"] == cat]
        print(f"{cat}: {sum(s['unlocked'] for s in rows)}/{len(rows)}")
    print("\nFast geschafft (noch nicht freigeschaltet):")
    for s in sorted((s for s in glob if not s["unlocked"]), key=lambda s: -s["souls"])[:15]:
        print(f"  {s['name']:<32} {s['souls']}/{s['need']} Souls")
    print("\nNächstes Level-up:")
    for s in sorted((s for s in glob if s["unlocked"] and s["need"]), key=lambda s: s["need"] - s["souls"])[:10]:
        print(f"  {s['name']:<32} Lv{s['level']}  {s['souls']}/{s['need']} Souls")
    if updates:
        print("\nLive-Updates im Mitschnitt:")
        for ts, pid, g, total in updates:
            print(f"  +{g} Soul  {pets.get(pid, {}).get('n', pid)}  -> {total}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"active": active, "pets": state}, f, ensure_ascii=False, indent=1)
        print(f"\nGespeichert: {args.out}")


if __name__ == "__main__":
    main()
