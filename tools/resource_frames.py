"""
Print login "resource/charge" frames (Odyle energy candidate etc.) from a capture.

Usage:  python tools/resource_frames.py <capture-dir> [--all]

Reuses the pcap/TCP/framing code from analyze_capture.py. See tools/notes_odyle.md for what is
verified and what is still a guess.
"""

import argparse
import collections
import datetime
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_capture import Stream, expand, read_pcap, split_frames, tcp_segment  # noqa: E402

CURRENCY_NAMES = {930100001: "Kina (verified: +15000 quest rewards)"}


def frames(capture):
    conns = [json.loads(l) for l in open(os.path.join(capture, "connections.jsonl"), encoding="utf-8")]
    ports = {c["rport"] for c in conns if c["proto"] == "tcp" and c.get("rport") not in (None, 0, 80, 443)
             and not str(c.get("remote", "")).startswith("127.")}
    streams = collections.defaultdict(Stream)
    for ts, pkt in read_pcap(os.path.join(capture, "game.pcap")):
        seg = tcp_segment(pkt)
        if seg and seg[1] in ports:
            streams[(seg[1], seg[3])].add(ts, seg[4], seg[5], seg[6])
    out = []
    for st in streams.values():
        buf, stamps = bytearray(), []
        for ts, d in st.chunks:
            stamps.append((len(buf), ts))
            buf += d
        si = 0
        for off, op, body in split_frames(bytes(buf)):
            while si + 1 < len(stamps) and stamps[si + 1][0] <= off:
                si += 1
            for op2, b2, _ in expand(op, body):
                out.append((stamps[si][1], op2, b2))
    out.sort(key=lambda x: x[0])
    return out


def ms(v):
    if v in (0, 0xFFFFFFFFFFFFFFFF) or v > 4e12:
        return "-" if v == 0 else "never"
    return datetime.datetime.fromtimestamp(v / 1000).strftime("%Y-%m-%d %H:%M:%S")


def p_0be3(b):  # u8 n, n x {u32 id, u32 value}
    n = b[0]
    return [struct.unpack_from("<II", b, 1 + 8 * i) for i in range(n)]


def p_acff(b):  # u8 n, n x {u8 id, u32 value}, u64 ts_ms
    n = b[0]
    rows = [struct.unpack_from("<BI", b, 1 + 5 * i) for i in range(n)]
    return rows, struct.unpack_from("<Q", b, 1 + 5 * n)[0]


def p_3be3(b):  # u8 n, n x {u32 id, u8 flag, u64 start_ms, u64 end_ms}
    n = b[0]
    return [struct.unpack_from("<IBQQ", b, 1 + 21 * i) for i in range(n)]


def p_62e2(b):  # u8 ?, u8 n, n x {u8 id, u8 id2, u64 used, u64 cap(-1 = none), u64 ts_ms}, u64 ts, u32
    n = b[1]
    return [struct.unpack_from("<BBQQQ", b, 2 + 26 * i) for i in range(n)]


def p_24e3(b):  # u8 n, then {u32 id, u32 cur, u32 max, u64 ts, ...variable tail}; only first entry offsets are fixed
    rows, i = [], 1
    for _ in range(b[0]):
        rid, cur, mx, ts = struct.unpack_from("<IIIQ", b, i)
        rows.append((rid, cur, mx, ts))
        nxt = b.find(b"\x4d\x4e\x00\x00", i + 1) if rid == 0x4E4C else -1  # tail not decoded yet
        if nxt < 0:
            break
        i = nxt
    return rows


def currencies(b):
    """Item records {u32 uid, u8 0, u16, u8 0, u32 item, u64 count, u8 1, ...} for currency ids 0x377033xx."""
    res = []
    i = b.find(b"\x70\x37")
    while i >= 2:
        iid = struct.unpack_from("<I", b, i - 2)[0]
        if iid >> 16 == 0x3770 and i + 10 <= len(b) and i - 6 >= 0 and b[i - 3] == 0 and b[i - 6] == 0:
            res.append((iid, struct.unpack_from("<Q", b, i + 2)[0]))
        i = b.find(b"\x70\x37", i + 1)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("--all", action="store_true", help="also print every live currency update (0x1b56)")
    a = ap.parse_args()
    fr = frames(a.capture)
    t0 = fr[0][0] if fr else 0
    for ts, op, b in fr:
        t = f"{datetime.datetime.fromtimestamp(ts).strftime('%H:%M:%S')} +{ts - t0:7.1f}s"
        try:
            if op == 0x0BE3:
                rows = p_0be3(b)
                txt = ", ".join(f"{i}={v}" for i, v in rows)
                print(f"{t} 0x0be3 resource table: {txt}   <- 2001 = Odyle energy? (candidate)")
            elif op == 0xACFF:
                rows, when = p_acff(b)
                print(f"{t} 0xacff charge table: {', '.join(f'{i}={v}' for i, v in rows)}  ts={ms(when)}")
            elif op == 0xA5FF:
                print(f"{t} 0xa5ff value={struct.unpack_from('<Q', b, 0)[0]} ts={ms(struct.unpack_from('<Q', b, 8)[0])}")
            elif op == 0x3BE3:
                for rid, fl, s, e in p_3be3(b):
                    print(f"{t} 0x3be3 window id={rid} flag={fl} {ms(s)} -> {ms(e)}")
            elif op == 0x62E2:
                for i1, i2, used, cap, w in p_62e2(b):
                    capt = "none" if cap == 0xFFFFFFFFFFFFFFFF else cap
                    print(f"{t} 0x62e2 limit id={i1}/{i2} used={used} cap={capt} ts={ms(w)}")
            elif op == 0x24E3:
                for rid, cur, mx, w in p_24e3(b):
                    print(f"{t} 0x24e3 id={rid} cur={cur} max={mx} ts={ms(w)}")
            elif op == 0x2AE3:
                print(f"{t} 0x2ae3 " + ", ".join(f"{b[1 + 14 * i]}={struct.unpack_from('<I', b, 2 + 14 * i)[0]}"
                                                for i in range(b[0])))
            elif op == 0x1156:
                for iid, cnt in currencies(b):
                    print(f"{t} 0x1156 login currency {iid} = {cnt}  {CURRENCY_NAMES.get(iid, '')}")
            elif op == 0x1B56 and a.all:
                for iid, cnt in currencies(b):
                    print(f"{t} 0x1b56 currency update {iid} = {cnt}  {CURRENCY_NAMES.get(iid, '')}")
        except struct.error:
            print(f"{t} 0x{op:04x} parse error, raw {b.hex()}")


if __name__ == "__main__":
    main()
