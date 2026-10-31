"""
Decode an Aion 2 capture made by capture_logger.py into game frames.

Framing (per SkeeveAN/Aion-DPS-Meter, MIT): LEB128 varint length L, frame = L + varint_len - 4 bytes total,
opcode = first 2 bytes after the varint. Opcode FF FF = LZ4 bundle: u32 LE raw size + LZ4 block of more frames.

Usage:  python analyze_capture.py <capture-dir> [--dump frames.jsonl]
"""

import argparse
import collections
import datetime
import json
import os
import struct
import sys


# ---------------------------------------------------------------- pcap + TCP

def read_pcap(path):
    b = open(path, "rb").read()
    o = 24
    while o + 16 <= len(b):
        sec, usec, cap, _ = struct.unpack_from("<IIII", b, o)
        yield sec + usec / 1e6, b[o + 16:o + 16 + cap]
        o += 16 + cap


def tcp_segment(pkt):
    etype, off = struct.unpack_from("!H", pkt, 12)[0], 14
    if etype == 0x8100:
        etype, off = struct.unpack_from("!H", pkt, 16)[0], 18
    if etype == 0x0800:
        if pkt[off + 9] != 6:
            return None
        src, dst = pkt[off + 12:off + 16], pkt[off + 16:off + 20]
        total = struct.unpack_from("!H", pkt, off + 2)[0]
        t, end = off + (pkt[off] & 15) * 4, off + total
    elif etype == 0x86DD:
        if pkt[off + 6] != 6:
            return None
        src, dst = pkt[off + 8:off + 24], pkt[off + 24:off + 40]
        t, end = off + 40, off + 40 + struct.unpack_from("!H", pkt, off + 4)[0]
    else:
        return None
    sport, dport, seq = struct.unpack_from("!HHI", pkt, t)
    flags = pkt[t + 13]
    return src, sport, dst, dport, seq, flags, pkt[t + (pkt[t + 12] >> 4) * 4:end]


class Stream:
    """In-order TCP payload for one direction; buffers out-of-order segments, drops retransmits."""

    def __init__(self):
        self.next = None
        self.ooo = {}
        self.chunks = []  # (ts, bytes)

    def add(self, ts, seq, flags, data):
        if flags & 0x02:  # SYN
            self.next = (seq + 1) & 0xFFFFFFFF
            return
        if not data:
            return
        if self.next is None:
            self.next = seq  # capture started mid-stream
        rel = (seq - self.next) & 0xFFFFFFFF
        if rel >= 0x80000000:  # old data / partial retransmit
            skip = (self.next - seq) & 0xFFFFFFFF
            if skip >= len(data):
                return
            data, seq = data[skip:], self.next
        if seq != self.next:
            self.ooo[seq] = (ts, data)
            return
        self.chunks.append((ts, data))
        self.next = (seq + len(data)) & 0xFFFFFFFF
        while self.next in self.ooo:
            t2, d2 = self.ooo.pop(self.next)
            self.chunks.append((t2, d2))
            self.next = (self.next + len(d2)) & 0xFFFFFFFF


# ---------------------------------------------------------------- framing

def lz4_block(src, size):
    out = bytearray()
    i = 0
    while i < len(src):
        tok = src[i]; i += 1
        lit = tok >> 4
        if lit == 15:
            while True:
                b = src[i]; i += 1; lit += b
                if b != 255:
                    break
        out += src[i:i + lit]; i += lit
        if i >= len(src):
            break
        off = src[i] | (src[i + 1] << 8); i += 2
        ml = tok & 15
        if ml == 15:
            while True:
                b = src[i]; i += 1; ml += b
                if b != 255:
                    break
        ml += 4
        start = len(out) - off
        if off <= 0 or start < 0:
            raise ValueError("bad lz4 offset")
        for k in range(ml):
            out.append(out[start + k])
    if len(out) != size:
        raise ValueError(f"lz4 size {len(out)} != {size}")
    return bytes(out)


def varint(buf, pos):
    val = shift = 0
    for n in range(5):
        if pos + n >= len(buf):
            return None, 0
        b = buf[pos + n]
        val |= (b & 0x7F) << shift
        shift += 7
        if not b & 0x80:
            return val, n + 1
    return None, 0


def split_frames(buf, pos=0, end=None):
    """Yields (offset, opcode, body) for complete frames; returns leftover position via StopIteration value."""
    end = len(buf) if end is None else end
    while pos < end:
        if buf[pos] == 0:  # padding between frames
            pos += 1
            continue
        if buf[pos] == 0x17 and buf[pos + 1:pos + 3] == b"\x03\x03":  # TLS record on a side channel
            if pos + 5 > end:
                return pos
            pos += 5 + struct.unpack_from("!H", buf, pos + 3)[0]
            continue
        L, n = varint(buf, pos)
        if L is None:
            return pos
        total = L + n - 4
        if total < n + 2 or total > 1 << 20:
            pos += 1  # resync
            continue
        if pos + total > end:
            return pos
        frame = buf[pos + n:pos + total]
        yield pos, (frame[0] << 8) | frame[1], frame[2:]
        pos += total
    return pos


def expand(opcode, body, depth=0):
    """Yields (opcode, body, bundled) with LZ4 bundles flattened."""
    if opcode == 0xFFFF and len(body) >= 4 and depth < 4:
        try:
            raw = lz4_block(body[4:], struct.unpack_from("<I", body, 0)[0])
        except Exception:
            yield opcode, body, depth > 0
            return
        gen = split_frames(raw)
        for _, op2, b2 in gen:
            yield from expand(op2, b2, depth + 1)
    else:
        yield opcode, body, depth > 0


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--dump", help="write all frames as jsonl")
    args = ap.parse_args()

    conns = [json.loads(l) for l in open(os.path.join(args.capture, "connections.jsonl"), encoding="utf-8")]
    game_ports = {c["rport"] for c in conns if c["proto"] == "tcp" and c.get("rport") not in (None, 0, 80, 443)
                  and not str(c.get("remote", "")).startswith("127.")}
    markers = []
    mp = os.path.join(args.capture, "markers.jsonl")
    if os.path.exists(mp):
        markers = [json.loads(l) for l in open(mp, encoding="utf-8") if l.strip()]
    print(f"Game server ports: {sorted(game_ports)}")

    streams = collections.defaultdict(Stream)
    for ts, pkt in read_pcap(os.path.join(args.capture, "game.pcap")):
        seg = tcp_segment(pkt)
        if not seg:
            continue
        src, sport, dst, dport, seq, flags, data = seg
        if sport in game_ports:
            streams[("S2C", sport, dport)].add(ts, seq, flags, data)
        elif dport in game_ports:
            streams[("C2S", dport, sport)].add(ts, seq, flags, data)

    frames = []
    for key, st in streams.items():
        buf = bytearray()
        stamps = []  # (offset, ts)
        for ts, d in st.chunks:
            stamps.append((len(buf), ts))
            buf += d
        gen = split_frames(bytes(buf))
        si = 0
        for off, op, body in gen:
            while si + 1 < len(stamps) and stamps[si + 1][0] <= off:
                si += 1
            for op2, b2, bundled in expand(op, body):
                frames.append({"ts": stamps[si][1], "dir": key[0], "conn": key[2], "op": op2,
                               "len": len(b2), "bundled": bundled, "hex": b2.hex()})
        print(f"{key[0]} :{key[1]} <-> :{key[2]}  {len(buf)} bytes, out-of-order left: {len(st.ooo)}")

    frames.sort(key=lambda f: f["ts"])
    print(f"\n{len(frames)} frames, {len(markers)} markers")
    hist = collections.Counter((f["dir"], f["op"]) for f in frames)
    size = collections.defaultdict(int)
    for f in frames:
        size[(f["dir"], f["op"])] += f["len"]
    print("\n dir  opcode   count   bytes")
    for (d, op), n in sorted(hist.items(), key=lambda x: -size[x[0]])[:60]:
        print(f" {d}  0x{op:04x}  {n:6d}  {size[(d, op)]:7d}")

    if args.dump:
        with open(args.dump, "w", encoding="utf-8") as f:
            for fr in frames:
                f.write(json.dumps(fr) + "\n")
        print(f"\nDumped to {args.dump}")


if __name__ == "__main__":
    main()
