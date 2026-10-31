"""
Aion2 capture logger – passive, Npcap only (no Python deps).

Records only the traffic of the Aion 2 client process into a Wireshark-compatible .pcap,
plus timestamped markers you set in-game via global hotkeys:

    Ctrl+Alt+1  pets tab opened        Ctrl+Alt+2  pets tab closed
    Ctrl+Alt+3  soul gained            Ctrl+Alt+4  pet unlocked / level up
    Ctrl+Alt+5  login / char select    Ctrl+Alt+0  generic mark
    (or type any text into this console + Enter for a custom marker)

Usage:  python capture_logger.py [--process aion] [--out ../captures]
Stop with Ctrl+C.
"""

import argparse
import collections
import ctypes
import ctypes.wintypes as wt
import datetime
import json
import os
import re
import socket
import struct
import sys
import threading
import time
import winsound

# ---------------------------------------------------------------- Npcap (wpcap.dll)

NPCAP_DIR = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "Npcap")
if os.path.isdir(NPCAP_DIR):
    os.add_dll_directory(NPCAP_DIR)
wpcap = ctypes.CDLL("wpcap.dll")

PCAP_ERRBUF_SIZE = 256
AF_INET = 2


class sockaddr(ctypes.Structure):
    _fields_ = [("sa_family", ctypes.c_ushort), ("sa_data", ctypes.c_ubyte * 14)]


class pcap_addr(ctypes.Structure):
    pass


pcap_addr._fields_ = [
    ("next", ctypes.POINTER(pcap_addr)),
    ("addr", ctypes.POINTER(sockaddr)),
    ("netmask", ctypes.POINTER(sockaddr)),
    ("broadaddr", ctypes.POINTER(sockaddr)),
    ("dstaddr", ctypes.POINTER(sockaddr)),
]


class pcap_if(ctypes.Structure):
    pass


pcap_if._fields_ = [
    ("next", ctypes.POINTER(pcap_if)),
    ("name", ctypes.c_char_p),
    ("description", ctypes.c_char_p),
    ("addresses", ctypes.POINTER(pcap_addr)),
    ("flags", ctypes.c_uint),
]


class timeval(ctypes.Structure):
    _fields_ = [("tv_sec", ctypes.c_long), ("tv_usec", ctypes.c_long)]


class pcap_pkthdr(ctypes.Structure):
    _fields_ = [("ts", timeval), ("caplen", ctypes.c_uint), ("len", ctypes.c_uint)]


class bpf_program(ctypes.Structure):
    _fields_ = [("bf_len", ctypes.c_uint), ("bf_insns", ctypes.c_void_p)]


class pcap_stat(ctypes.Structure):
    _fields_ = [("ps_recv", ctypes.c_uint), ("ps_drop", ctypes.c_uint), ("ps_ifdrop", ctypes.c_uint)]


P = ctypes.c_void_p
wpcap.pcap_findalldevs.argtypes = [ctypes.POINTER(ctypes.POINTER(pcap_if)), ctypes.c_char_p]
wpcap.pcap_freealldevs.argtypes = [ctypes.POINTER(pcap_if)]
wpcap.pcap_create.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
wpcap.pcap_create.restype = P
for fn in ("pcap_set_snaplen", "pcap_set_promisc", "pcap_set_timeout", "pcap_set_buffer_size", "pcap_set_immediate_mode"):
    getattr(wpcap, fn).argtypes = [P, ctypes.c_int]
wpcap.pcap_activate.argtypes = [P]
wpcap.pcap_geterr.argtypes = [P]
wpcap.pcap_geterr.restype = ctypes.c_char_p
wpcap.pcap_datalink.argtypes = [P]
wpcap.pcap_compile.argtypes = [P, ctypes.POINTER(bpf_program), ctypes.c_char_p, ctypes.c_int, ctypes.c_uint]
wpcap.pcap_setfilter.argtypes = [P, ctypes.POINTER(bpf_program)]
wpcap.pcap_freecode.argtypes = [ctypes.POINTER(bpf_program)]
wpcap.pcap_next_ex.argtypes = [P, ctypes.POINTER(ctypes.POINTER(pcap_pkthdr)), ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte))]
wpcap.pcap_dump_open.argtypes = [P, ctypes.c_char_p]
wpcap.pcap_dump_open.restype = P
wpcap.pcap_dump.argtypes = [P, ctypes.POINTER(pcap_pkthdr), ctypes.c_char_p]
wpcap.pcap_dump_flush.argtypes = [P]
wpcap.pcap_dump_close.argtypes = [P]
wpcap.pcap_stats.argtypes = [P, ctypes.POINTER(pcap_stat)]
wpcap.pcap_close.argtypes = [P]

# ---------------------------------------------------------------- process -> ports (iphlpapi)

iphlpapi = ctypes.WinDLL("iphlpapi")
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)

TCP_TABLE_OWNER_PID_ALL = 5
UDP_TABLE_OWNER_PID = 1
TCP_STATES = {1: "CLOSED", 2: "LISTEN", 3: "SYN_SENT", 4: "SYN_RCVD", 5: "ESTABLISHED", 6: "FIN_WAIT1",
              7: "FIN_WAIT2", 8: "CLOSE_WAIT", 9: "CLOSING", 10: "LAST_ACK", 11: "TIME_WAIT", 12: "DELETE_TCB"}


AF_INET6 = 23


def _get_table(fn, family, table_class):
    size = wt.DWORD(0)
    fn(None, ctypes.byref(size), False, family, table_class, 0)
    buf = ctypes.create_string_buffer(size.value + 4096)
    if fn(buf, ctypes.byref(size), False, family, table_class, 0) != 0:
        return b""
    return buf.raw


def _port(dw):
    return socket.ntohs(dw & 0xFFFF)


def tcp_rows():
    raw = _get_table(iphlpapi.GetExtendedTcpTable, AF_INET, TCP_TABLE_OWNER_PID_ALL)
    for i in range(struct.unpack_from("<I", raw, 0)[0] if raw else 0):
        state, laddr, lport, raddr, rport, pid = struct.unpack_from("<6I", raw, 4 + i * 24)
        yield dict(proto="tcp", state=TCP_STATES.get(state, str(state)),
                   local=socket.inet_ntoa(struct.pack("<I", laddr)), lport=_port(lport),
                   remote=socket.inet_ntoa(struct.pack("<I", raddr)), rport=_port(rport), pid=pid)
    raw = _get_table(iphlpapi.GetExtendedTcpTable, AF_INET6, TCP_TABLE_OWNER_PID_ALL)
    for i in range(struct.unpack_from("<I", raw, 0)[0] if raw else 0):
        o = 4 + i * 56
        laddr, (lport,), raddr = raw[o:o + 16], struct.unpack_from("<I", raw, o + 20), raw[o + 24:o + 40]
        rport, state, pid = struct.unpack_from("<3I", raw, o + 44)
        yield dict(proto="tcp", state=TCP_STATES.get(state, str(state)),
                   local=socket.inet_ntop(socket.AF_INET6, laddr), lport=_port(lport),
                   remote=socket.inet_ntop(socket.AF_INET6, raddr), rport=_port(rport), pid=pid)


def udp_rows():
    raw = _get_table(iphlpapi.GetExtendedUdpTable, AF_INET, UDP_TABLE_OWNER_PID)
    for i in range(struct.unpack_from("<I", raw, 0)[0] if raw else 0):
        laddr, lport, pid = struct.unpack_from("<3I", raw, 4 + i * 12)
        yield dict(proto="udp", local=socket.inet_ntoa(struct.pack("<I", laddr)), lport=_port(lport), pid=pid)
    raw = _get_table(iphlpapi.GetExtendedUdpTable, AF_INET6, UDP_TABLE_OWNER_PID)
    for i in range(struct.unpack_from("<I", raw, 0)[0] if raw else 0):
        o = 4 + i * 28
        lport, pid = struct.unpack_from("<2I", raw, o + 20)
        yield dict(proto="udp", local=socket.inet_ntop(socket.AF_INET6, raw[o:o + 16]), lport=_port(lport), pid=pid)


_name_cache: dict[int, str] = {}


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
                ("th32DefaultHeapID", ctypes.c_void_p), ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD),
                ("th32ParentProcessID", wt.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", wt.DWORD),
                ("szExeFile", ctypes.c_wchar * 260)]


kernel32.CreateToolhelp32Snapshot.restype = wt.HANDLE


def process_name(pid: int) -> str:
    # Process snapshot instead of OpenProcess: never opens a handle to the game (anti-cheat friendly).
    if pid not in _name_cache:
        snap = kernel32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
        entry = PROCESSENTRY32W(dwSize=ctypes.sizeof(PROCESSENTRY32W))
        ok = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            _name_cache[entry.th32ProcessID] = entry.szExeFile
            ok = kernel32.Process32NextW(snap, ctypes.byref(entry))
        kernel32.CloseHandle(snap)
        _name_cache.setdefault(pid, "")
    return _name_cache[pid]


# ---------------------------------------------------------------- helpers

def default_local_ip() -> str:
    # UDP connect sends nothing; it only asks the routing table which local address would be used.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 53))
        return s.getsockname()[0]
    finally:
        s.close()


def list_devices():
    alldevs = ctypes.POINTER(pcap_if)()
    err = ctypes.create_string_buffer(PCAP_ERRBUF_SIZE)
    if wpcap.pcap_findalldevs(ctypes.byref(alldevs), err) != 0:
        sys.exit(f"pcap_findalldevs failed: {err.value.decode(errors='replace')}")
    devs = []
    d = alldevs
    while d:
        ips = []
        a = d.contents.addresses
        while a:
            sa = a.contents.addr
            if sa and sa.contents.sa_family == AF_INET:
                ips.append(socket.inet_ntoa(bytes(sa.contents.sa_data[2:6])))
            a = a.contents.next
        devs.append((d.contents.name, (d.contents.description or b"").decode(errors="replace"), ips))
        d = d.contents.next
    wpcap.pcap_freealldevs(alldevs)
    return devs


def parse_ports(data: bytes, linktype: int):
    """Returns (proto, sport, dport) for IPv4/IPv6 TCP/UDP, else None."""
    if linktype == 1:  # Ethernet
        if len(data) < 14:
            return None
        off, etype = 14, struct.unpack_from("!H", data, 12)[0]
        if etype == 0x8100 and len(data) >= 18:
            off, etype = 18, struct.unpack_from("!H", data, 16)[0]
    elif linktype == 0:  # Null/loopback
        off, etype = 4, 0x0800 if data[:1] == b"\x02" else 0x86DD
    else:
        return None
    if etype == 0x0800 and len(data) >= off + 20:
        proto, t = data[off + 9], off + (data[off] & 0x0F) * 4
    elif etype == 0x86DD and len(data) >= off + 40:
        proto, t = data[off + 6], off + 40  # extension headers are not followed
    else:
        return None
    if proto not in (6, 17) or len(data) < t + 4:
        return None
    sport, dport = struct.unpack_from("!HH", data, t)
    return ("tcp" if proto == 6 else "udp"), sport, dport


# ---------------------------------------------------------------- markers via global hotkeys

HOTKEY_MARKERS = {
    ord("1"): "pets_tab_open",
    ord("2"): "pets_tab_close",
    ord("3"): "soul_gained",
    ord("4"): "pet_unlock_or_levelup",
    ord("5"): "login_or_charselect",
    ord("0"): "mark",
}


class Markers:
    def __init__(self, path: str):
        self.f = open(path, "a", encoding="utf-8")
        self.lock = threading.Lock()
        self.count = 0

    def add(self, label: str, source: str):
        ts = time.time()
        with self.lock:
            self.f.write(json.dumps({"ts": ts, "label": label, "source": source}) + "\n")
            self.f.flush()
            self.count += 1
        stamp = datetime.datetime.fromtimestamp(ts).strftime("%H:%M:%S.%f")[:-3]
        print(f"\n[{stamp}] MARKER #{self.count}: {label}")


def hotkey_thread(markers: Markers):
    MOD_ALT, MOD_CONTROL, MOD_NOREPEAT = 0x1, 0x2, 0x4000
    WM_HOTKEY = 0x0312
    ok = []
    for i, vk in enumerate(HOTKEY_MARKERS, start=1):
        if user32.RegisterHotKey(None, i, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, vk):
            ok.append(vk)
        else:
            print(f"! Hotkey Ctrl+Alt+{chr(vk)} ist belegt – nicht verfügbar.")
    ids = list(HOTKEY_MARKERS)
    msg = wt.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        if msg.message == WM_HOTKEY:
            vk = ids[msg.wParam - 1]
            markers.add(HOTKEY_MARKERS[vk], f"hotkey Ctrl+Alt+{chr(vk)}")
            winsound.Beep(1200, 80)


def stdin_thread(markers: Markers):
    for line in sys.stdin:
        text = line.strip()
        if text:
            markers.add(text, "console")


# ---------------------------------------------------------------- main capture loop

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--process", default="aion", help="Regex für den Prozessnamen (default: aion)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "captures"))
    ap.add_argument("--device", help="Npcap-Device-Name (default: Adapter der Default-Route)")
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--buffer-seconds", type=float, default=15.0,
                    help="So lange werden Pakete unbekannter Verbindungen vorgehalten (fängt den Verbindungsstart ab)")
    ap.add_argument("--seconds", type=float, default=0, help="Automatisch nach N Sekunden beenden (0 = nie)")
    args = ap.parse_args()

    devices = list_devices()
    if args.list_devices:
        for name, desc, ips in devices:
            print(f"{name.decode()}  {desc}  {ips}")
        return

    local_ip = default_local_ip()
    if args.device:
        dev = args.device.encode()
    else:
        match = [d for d in devices if local_ip in d[2]]
        if not match:
            sys.exit(f"Kein Npcap-Device mit IP {local_ip} gefunden. Nutze --list-devices / --device.")
        dev = match[0][0]
        print(f"Device: {match[0][1]} ({local_ip})")

    proc_re = re.compile(args.process, re.I)
    session = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    outdir = os.path.abspath(os.path.join(args.out, session))
    os.makedirs(outdir, exist_ok=True)

    err = ctypes.create_string_buffer(PCAP_ERRBUF_SIZE)
    p = wpcap.pcap_create(dev, err)
    if not p:
        sys.exit(f"pcap_create failed: {err.value.decode(errors='replace')}")
    wpcap.pcap_set_snaplen(p, 65535)
    wpcap.pcap_set_promisc(p, 0)
    wpcap.pcap_set_timeout(p, 200)
    wpcap.pcap_set_buffer_size(p, 32 * 1024 * 1024)
    wpcap.pcap_set_immediate_mode(p, 1)
    if wpcap.pcap_activate(p) < 0:
        sys.exit(f"pcap_activate failed: {wpcap.pcap_geterr(p).decode(errors='replace')}\n"
                 "Tipp: Konsole als Administrator starten, falls Npcap auf Admins beschränkt ist.")
    linktype = wpcap.pcap_datalink(p)

    # Kernel-side: only IPv4 TCP/UDP, skip loopback. Process filtering happens below by local port.
    prog = bpf_program()
    if wpcap.pcap_compile(p, ctypes.byref(prog), b"(ip or ip6) and (tcp or udp) and not net 127.0.0.0/8", 1, 0) == 0:
        wpcap.pcap_setfilter(p, ctypes.byref(prog))
        wpcap.pcap_freecode(ctypes.byref(prog))

    dumper = wpcap.pcap_dump_open(p, os.path.join(outdir, "game.pcap").encode())
    markers = Markers(os.path.join(outdir, "markers.jsonl"))
    conn_log = open(os.path.join(outdir, "connections.jsonl"), "a", encoding="utf-8")
    with open(os.path.join(outdir, "session.json"), "w", encoding="utf-8") as f:
        json.dump({"started": time.time(), "local_ip": local_ip, "device": dev.decode(),
                   "linktype": linktype, "process_regex": args.process}, f, indent=2)

    threading.Thread(target=hotkey_thread, args=(markers,), daemon=True).start()
    threading.Thread(target=stdin_thread, args=(markers,), daemon=True).start()

    print(f"Ausgabe: {outdir}")
    print("Marker: Ctrl+Alt+1 Pets-Tab auf | 2 zu | 3 Soul bekommen | 4 Unlock/Levelup | 5 Login | 0 Mark")
    print("Oder Text eintippen + Enter. Beenden mit Ctrl+C.\n")

    game_ports: set[tuple[str, int]] = set()       # (proto, local port) owned by the game
    seen_conns: set[tuple] = set()
    pending = collections.deque()                  # (ts, key, hdr, data) of not-yet-attributed flows
    hdr_p = ctypes.POINTER(pcap_pkthdr)()
    data_p = ctypes.POINTER(ctypes.c_ubyte)()
    kept = kept_bytes = 0
    game_pids: set[int] = set()
    last_poll = last_status = 0.0
    deadline = time.time() + args.seconds if args.seconds > 0 else float("inf")

    def write(hdr: pcap_pkthdr, data: bytes):
        nonlocal kept, kept_bytes
        wpcap.pcap_dump(dumper, ctypes.byref(hdr), data)
        kept += 1
        kept_bytes += len(data)

    def poll_process():
        nonlocal game_pids
        new_ports = set()
        pids = set()
        for row in list(tcp_rows()) + list(udp_rows()):
            if row["pid"] in (0, 4) or not proc_re.search(process_name(row["pid"])):
                continue
            if row["proto"] == "tcp" and row["state"] == "LISTEN":
                continue
            pids.add(row["pid"])
            new_ports.add((row["proto"], row["lport"]))
            sig = (row["proto"], row["lport"], row.get("remote"), row.get("rport"), row["pid"])
            if sig not in seen_conns:
                seen_conns.add(sig)
                row = dict(row, ts=time.time(), process=process_name(row["pid"]))
                conn_log.write(json.dumps(row) + "\n")
                conn_log.flush()
                remote = f"{row.get('remote')}:{row.get('rport')}" if row["proto"] == "tcp" else "*"
                print(f"\n+ {row['process']} [{row['pid']}] {row['proto']} :{row['lport']} -> {remote}")
        if pids != game_pids:
            if pids and not game_pids:
                print(f"\nAion-Prozess erkannt: {', '.join(process_name(x) for x in pids)}")
            game_pids = pids
        added = new_ports - game_ports
        game_ports.update(new_ports)
        if added:
            # Flush buffered packets of flows that turned out to belong to the game.
            rest = collections.deque()
            for item in pending:
                (write(item[2], item[3]) if not game_ports.isdisjoint(item[1]) else rest.append(item))
            pending.clear()
            pending.extend(rest)

    try:
        while True:
            now = time.time()
            if now > deadline:
                break
            if now - last_poll > 0.25:
                poll_process()
                while pending and now - pending[0][0] > args.buffer_seconds:
                    pending.popleft()
                last_poll = now
            if now - last_status > 2:
                st = pcap_stat()
                wpcap.pcap_stats(p, ctypes.byref(st))
                state = "verbunden" if game_pids else "warte auf Aion-Prozess..."
                print(f"\r{state} | Pakete: {kept} ({kept_bytes / 1024:.0f} KB) | Ports: {len(game_ports)} "
                      f"| Marker: {markers.count} | Drops: {st.ps_drop}   ", end="", flush=True)
                wpcap.pcap_dump_flush(dumper)
                last_status = now

            r = wpcap.pcap_next_ex(p, ctypes.byref(hdr_p), ctypes.byref(data_p))
            if r == 0:
                continue
            if r < 0:
                print(f"\npcap_next_ex: {wpcap.pcap_geterr(p).decode(errors='replace')}")
                break
            h = hdr_p.contents
            data = ctypes.string_at(data_p, h.caplen)
            info = parse_ports(data, linktype)
            if not info:
                continue
            proto, sport, dport = info
            # Either side may be the local one; game ports come from the process' socket table.
            keys = ((proto, sport), (proto, dport))
            hdr = pcap_pkthdr(timeval(h.ts.tv_sec, h.ts.tv_usec), h.caplen, h.len)
            if keys[0] in game_ports or keys[1] in game_ports:
                write(hdr, data)
            else:
                pending.append((time.time(), keys, hdr, data))
    except KeyboardInterrupt:
        pass
    finally:
        wpcap.pcap_dump_flush(dumper)
        wpcap.pcap_dump_close(dumper)
        wpcap.pcap_close(p)
        print(f"\n\nGespeichert: {outdir}\n  game.pcap, markers.jsonl, connections.jsonl")


if __name__ == "__main__":
    main()
