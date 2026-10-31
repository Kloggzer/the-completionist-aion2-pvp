"""
Own-position track for a capture: exact fixes from every frame that carries the own position, plus a
particle-filter estimate from spawn/despawn "interest rings" and aggro mobs while no fix arrives (walking/flying out of combat).
See tools/notes_position.md for the layouts and the measurements behind the constants.

Usage:
  python tools/own_position_track.py <capture-dir> [--csv out.csv] [--eval] [--only-2a38]
  (copy a capture that the logger is still writing to %TEMP% first)
  python tools/own_position_track.py --frames frames.jsonl ...   (reuse an analyze_capture.py --dump)

CSV columns: ts, kind (fix | hold = filter still within 25 m of the last fix | est = filter), source opcode, x, z, height (metres, aion2maps: x = X/100, z = Y/100),
sigma_m (rough 1-sigma error of the row).
"""

import argparse
import bisect
import collections
import json
import math
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze_capture as ac  # noqa: E402

MOVE_OPS = {0x1a37, 0x1b37, 0x1c37, 0x1e37, 0x1f37, 0x2037, 0x3f37}
# interest radii in metres (peak of the distance histogram spawn/despawn <-> own fix, 2 captures, ~3000 events)
RING = {0x4136: (36.0, 4.0), 0x4536: (32.0, 5.0), 0x3436: (55.0, 6.0), 0x4236: (43.0, 4.0)}


# ---------------------------------------------------------------- frames

def frames_from_capture(cap):
    conns = [json.loads(l) for l in open(os.path.join(cap, "connections.jsonl"), encoding="utf-8")]
    ports = {c["rport"] for c in conns if c["proto"] == "tcp" and c.get("rport") not in (None, 0, 80, 443)
             and not str(c.get("remote", "")).startswith("127.")}
    streams = collections.defaultdict(ac.Stream)
    for ts, pkt in ac.read_pcap(os.path.join(cap, "game.pcap")):
        seg = ac.tcp_segment(pkt)
        if seg and seg[1] in ports:
            streams[(seg[1], seg[3])].add(ts, seg[4], seg[5], seg[6])
    out = []
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
                out.append((stamps[si][1], op2, b2))
    out.sort(key=lambda f: f[0])
    return out


def frames_from_dump(path):
    out = []
    for line in open(path, encoding="utf-8"):
        d = json.loads(line)
        if d["dir"] == "S2C":
            out.append((d["ts"], d["op"], bytes.fromhex(d["hex"])))
    return out


# ---------------------------------------------------------------- parsing

def plaus(x, y, z):
    return all(map(math.isfinite, (x, y, z))) and 1000 <= abs(x) < 400000 and 1000 <= abs(y) < 400000 \
        and -20000 < z < 80000


def xyz(b, o):
    if o < 0 or o + 12 > len(b):
        return None
    p = struct.unpack_from("<fff", b, o)
    return p if plaus(*p) else None


def find_all(b, raw):
    i = b.find(raw)
    while i >= 0:
        if i == 0 or not b[i - 1] & 0x80:  # varint must start on a field boundary
            yield i
        i = b.find(raw, i + 1)


def own_fix(op, b, raw):
    """Own position (x, y, z cm) from one frame, or None. Layouts: see notes_position.md."""
    n = len(raw)
    if op in (0x2a38, 0x2b38):  # effect frames: ..., caster varint at 24-27, then x,y,z at +4 (short form) / +8
        for i in find_all(b, raw):
            if i >= 20:
                for d in (4, 8):
                    if p := xyz(b, i + d):
                        return p
    elif op in (0x0238, 0x0938):  # skill hit: caster, 00, u32 skill, u8, u8, target varint, f32 angle, x,y,z
        for i in find_all(b, raw):
            if 5 <= i <= 14 and (p := xyz(b, i + n + 4)):
                return p
    elif op == 0x0e38:  # projectile: ent varint, 02, caster varint, u32 skill, u8, target varint, x,y,z
        for i in find_all(b, raw):
            if 2 <= i <= 6:
                o = i + n + 5
                _, k = ac.varint(b, o)
                if k and (p := xyz(b, o + k)):
                    return p
    elif op in MOVE_OPS:  # own entity moved by the server (knock-back, dash, stop): ent varint, 0-4 bytes, x,y,z
        if b.startswith(raw):
            for d in range(5):
                if p := xyz(b, n + d):
                    return p
    elif op == 0x2336 and len(b) >= 18:  # teleport / map change
        return xyz(b, 6)
    return None


def ring_event(op, b, last_pos):
    """(x, y, R, sigma) in cm/m for spawn/despawn frames, or None."""
    e, k = ac.varint(b, 0)
    if e is None:
        return None, None
    if op in (0x4136, 0x4536):
        for o in range(4, 25):
            if p := xyz(b, o):
                last_pos[e] = p
                return p, RING[op]
    elif op == 0x3436:
        if p := xyz(b, k + 6):
            return p, RING[op]
    elif op == 0x4236 and k + 1 < len(b) and b[k + 1] == 1 and e in last_pos:  # 01 = left the interest range
        return last_pos.pop(e), RING[op]
    return None, None


# ---------------------------------------------------------------- estimator between fixes

def ring_lik(d, op):
    """Likelihood of 'entity spawned/despawned at distance d (m) from the player'. Peak + uniform 'inside'
    part (respawns next to the player) + 15 % outliers (big entities with a far larger range, stale positions)."""
    peak, sig, rmax = RING_LIK[op]
    g = math.exp(-0.5 * ((d - peak) / sig) ** 2) / (sig * 2.5066)
    if rmax:
        z = (d - rmax) / 1.5
        g = 0.7 * g + (0.3 / rmax / (1 + math.exp(z)) if z < 50 else 0.0)
    return 0.15 / 400 + 0.85 * g


RING_LIK = {0x4136: (36, 4, 42), 0x4536: (32, 4, 38), 0x3436: (56, 4, 62), 0x4236: (43, 5, None)}


class Tracker:
    """Exact fix whenever a frame carries the own position; in between a small particle filter
    (random walk, 6 m/sqrt(s)) weighted by spawn/despawn rings and by mobs that are fighting the player.
    Output stays on the last fix until the filter is >= GATE m away (standing still: rings only add noise)."""
    N = 400
    DIFFUSION = 6.0   # m/sqrt(s); 3 and 10 were worse on 205450
    GATE = 25.0
    AGGRO_SIGMA = 8.0  # mob that hit the player in the last 10 s moved: p50 6-8 m from the player

    def __init__(self, sources=None, seed=1):
        self.sources = sources  # None = all fix opcodes
        self.rng = random.Random(seed)
        self.raw = None
        self.fix = None         # (t, x, y, h) metres
        self.parts = None       # [[x, y, w], ...]
        self.t = None
        self.last_pos = {}      # entity -> (x, y, z) cm, for despawns
        self.aggro = {}         # entity -> last time it hit the player

    def feed(self, t, op, b):
        """Returns a CSV row tuple or None."""
        if op == 0x3336:
            v, k = ac.varint(b, 0)
            if v:
                self.raw = b[:k]
            return None
        if self.raw and op in (0x0238, 0x0438, 0x0538) and self.raw in b[3:14] and not b.startswith(self.raw):
            e, _ = ac.varint(b, 0)  # caster hit the player
            self.aggro[e] = t
        if self.raw and (self.sources is None or op in self.sources) and (p := own_fix(op, b, self.raw)):
            self.fix = (t, p[0] / 100, p[1] / 100, p[2] / 100)
            self.parts = [[self.fix[1] + self.rng.gauss(0, 1), self.fix[2] + self.rng.gauss(0, 1), 1 / self.N]
                          for _ in range(self.N)]
            self.t = t
            return t, "fix", f"0x{op:04x}", self.fix[1], self.fix[2], self.fix[3], 1.0
        if not self.raw:
            return None
        if op in MOVE_OPS:
            e, n = ac.varint(b, 0)
            p = next((q for d in range(5) if (q := xyz(b, n + d))), None) if e is not None else None
            if p is None:
                return None
            self.last_pos[e] = p
            if self.parts and t - self.aggro.get(e, -1e9) < 10:
                x, y = p[0] / 100, p[1] / 100
                s2 = 2 * self.AGGRO_SIGMA ** 2
                return self.update(t, lambda px, py: 0.05 / 400 + math.exp(-((px - x) ** 2 + (py - y) ** 2) / s2))
            return None
        if op in RING:
            s, _ = ring_event(op, b, self.last_pos)
            if s is None or not self.parts:
                return None
            x, y = s[0] / 100, s[1] / 100
            return self.update(t, lambda px, py: ring_lik(math.hypot(px - x, py - y), op))
        return None

    def predict(self, t):
        dt = t - self.t
        if dt > 0:
            sd = self.DIFFUSION * math.sqrt(dt)
            g = self.rng.gauss
            for p in self.parts:
                p[0] += g(0, sd); p[1] += g(0, sd)
            self.t = t

    def update(self, t, lik):
        self.predict(t)
        tot = 0.0
        for p in self.parts:
            p[2] *= lik(p[0], p[1])
            tot += p[2]
        if not tot > 0:
            for p in self.parts:
                p[2] = 1.0
            tot = float(self.N)
        for p in self.parts:
            p[2] /= tot
        if 1 / sum(p[2] * p[2] for p in self.parts) < self.N / 2:  # resample
            picks = self.rng.choices(self.parts, weights=[p[2] for p in self.parts], k=self.N)
            self.parts = [[p[0] + self.rng.gauss(0, 0.5), p[1] + self.rng.gauss(0, 0.5), 1 / self.N] for p in picks]
        return self.output(t)

    def estimate(self):
        return sum(p[0] * p[2] for p in self.parts), sum(p[1] * p[2] for p in self.parts)

    def output(self, t):
        x, y = self.estimate()
        if math.hypot(x - self.fix[1], y - self.fix[2]) < self.GATE:
            return t, "hold", "", self.fix[1], self.fix[2], self.fix[3], 12.0
        return t, "est", "", x, y, self.fix[3], 15.0

    def position(self, t):
        """Current best position (x, y) in metres for display."""
        if not self.parts:
            return None
        self.predict(t)
        r = self.output(t)
        return r[3], r[4]


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture", nargs="?")
    ap.add_argument("--frames", help="frames.jsonl from analyze_capture.py --dump")
    ap.add_argument("--csv")
    ap.add_argument("--eval", action="store_true", help="print interval and error statistics")
    ap.add_argument("--only-2a38", action="store_true", help="baseline: fixes from 0x2a38 (+teleport) only")
    args = ap.parse_args()
    frames = frames_from_dump(args.frames) if args.frames else frames_from_capture(args.capture)

    tr = Tracker({0x2a38, 0x2336} if args.only_2a38 else None)
    rows = []
    for t, op, b in frames:
        if r := tr.feed(t, op, b):
            rows.append(r)

    if args.csv:
        with open(args.csv, "w", encoding="utf-8") as f:
            f.write("ts,kind,source,x,z,height,sigma_m\n")
            for t, k, s, x, y, h, sg in rows:
                f.write(f"{t:.3f},{k},{s},{x:.2f},{y:.2f},{h:.2f},{sg}\n")
        print(f"{len(rows)} rows -> {args.csv}")
    if args.eval:
        evaluate(frames, rows)


def gap_stats(ts, label):
    g = sorted(b - a for a, b in zip(ts, ts[1:]) if b - a < 120)
    if not g:
        return
    q = lambda p: g[int(p * (len(g) - 1))]
    long_ = sum(x for x in g if x > 5)
    print(f"  {label:34s} n={len(ts):5d}  gap p50={q(.5):5.2f}s p90={q(.9):5.1f}s p99={q(.99):5.1f}s  "
          f"time in gaps>5s: {long_:6.0f}s")


def evaluate(frames, rows):
    fixes = [r for r in rows if r[1] == "fix"]
    by_src = collections.Counter(r[2] for r in fixes)
    print("fixes by opcode:", dict(by_src.most_common()))
    gap_stats([r[0] for r in fixes if r[2] in ("0x2a38", "0x2336")], "0x2a38 only")
    gap_stats([r[0] for r in fixes], "all fix opcodes")

    # Error right before a 0x2a38 fix that ends a gap of >= 4 s without any fix (the radar's worst case):
    # tracker sees everything except that 0x2a38 frame.
    for label, srcs in (("0x2a38 fixes only", {0x2a38, 0x2336}), ("all fix opcodes", None)):
        tr = Tracker(srcs)
        errs = collections.defaultdict(list)
        for t, op, b in frames:
            if op == 0x2a38 and tr.raw and tr.fix and t - tr.fix[0] >= 4 and (p := own_fix(op, b, tr.raw)):
                x, y = p[0] / 100, p[1] / 100
                g = t - tr.fix[0]
                bucket = "4-8s" if g < 8 else "8-15s" if g < 15 else "15-40s" if g < 40 else ">40s"
                hx, hy = tr.fix[1], tr.fix[2]
                ex, ey = tr.position(t)
                for k, (px, py) in (("hold last fix", (hx, hy)), ("filter", (ex, ey))):
                    e = math.hypot(px - x, py - y)
                    errs[(k, "all")].append(e)
                    errs[(k, bucket)].append(e)
            tr.feed(t, op, b)
        print(f"error at the end of >=4 s gaps, {label} (metres):")
        for bucket in ("all", "4-8s", "8-15s", "15-40s", ">40s"):
            for k in ("hold last fix", "filter"):
                L = sorted(errs[(k, bucket)])
                if L:
                    q = lambda p: L[int(p * (len(L) - 1))]
                    print(f"  {bucket:6s} {k:14s} n={len(L):4d}  p50={q(.5):6.1f}  p75={q(.75):6.1f}  p90={q(.9):6.1f}")


if __name__ == "__main__":
    main()
