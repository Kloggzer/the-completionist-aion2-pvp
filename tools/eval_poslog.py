"""
Compare the app's own-position log (PETOVERLAY_POSLOG=<csv> while replaying a capture) with own_position_track.py.

  TheCompletionist.exe --replay <capture> --speed 20     (env PETOVERLAY_POSLOG=app.csv)
  python tools/own_position_track.py <capture> --csv py.csv
  python tools/eval_poslog.py app.csv py.csv

Checks: the app's exact fixes (PositionTracker / PetFrames.OwnFix) match the script's (time, source, position);
error of what the app showed right before a 0x2a38 fix that ends a gap of >= 4 s without any fix (same measure as
own_position_track.py --eval): "hold" = the last fix, "app" = the last estimate sent after it (else the fix).
Both CSVs: ts, kind, source, x, z, height, sigma (the app writes no header and only fix / est rows).
"""

import collections
import math
import sys


def load(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        f = line.strip().split(",")
        if len(f) < 7 or f[0] == "ts":
            continue
        rows.append((float(f[0]), f[1], f[2], float(f[3]), float(f[4]), float(f[6])))
    rows.sort(key=lambda r: r[0])
    return rows


def q(L, p):
    return L[int(p * (len(L) - 1))]


def main():
    app, py = load(sys.argv[1]), load(sys.argv[2])
    af = [r for r in app if r[1] == "fix"]
    pf = [r for r in py if r[1] == "fix"]
    print(f"fixes: app {len(af)}, script {len(pf)}")
    print("  app by source:   ", dict(collections.Counter(r[2] for r in af).most_common()))
    print("  script by source:", dict(collections.Counter(r[2] for r in pf).most_common()))
    key = lambda r: (round(r[0], 2), r[2])
    ak, pk = {key(r): r for r in af}, {key(r): r for r in pf}
    both = ak.keys() & pk.keys()
    dev = max((math.hypot(ak[k][3] - pk[k][3], ak[k][4] - pk[k][4]) for k in both), default=0)
    print(f"  matched {len(both)}, only app {len(ak.keys() - pk.keys())}, only script {len(pk.keys() - ak.keys())}, "
          f"max position difference {dev:.2f} m")

    errs = collections.defaultdict(list)
    sig = []
    last_fix, last_est = None, None
    for r in app:
        if r[1] == "est":
            last_est = r
            continue
        if r[2] == "0x2a38" and last_fix and r[0] - last_fix[0] >= 4:
            g = r[0] - last_fix[0]
            bucket = "4-8s" if g < 8 else "8-15s" if g < 15 else "15-40s" if g < 40 else ">40s"
            shown = last_est if last_est and last_est[0] > last_fix[0] else last_fix
            for k, s in (("hold last fix", last_fix), ("app", shown)):
                e = math.hypot(s[3] - r[3], s[4] - r[4])
                errs[(k, "all")].append(e)
                errs[(k, bucket)].append(e)
            if shown is not last_fix:
                sig.append((math.hypot(shown[3] - r[3], shown[4] - r[4]), shown[5]))
        last_fix = r
    print("error at the end of >=4 s gaps (metres):")
    for bucket in ("all", "4-8s", "8-15s", "15-40s", ">40s"):
        for k in ("hold last fix", "app"):
            L = sorted(errs[(k, bucket)])
            if L:
                print(f"  {bucket:6s} {k:14s} n={len(L):4d}  p50={q(L, .5):6.1f}  p75={q(L, .75):6.1f}  p90={q(L, .9):6.1f}")
    if sig:
        inside = sum(e <= s for e, s in sig) / len(sig)
        print(f"estimates shown at those gap ends: {len(sig)}, error <= sigma in {inside:.0%}, "
              f"sigma p50 {q(sorted(s for _, s in sig), .5):.1f} m")
    est = [r for r in app if r[1] == "est"]
    if est and len(app) > 1:
        span = app[-1][0] - app[0][0]
        print(f"estimate rows: {len(est)} ({len(est) / span * 60:.1f}/min), sigma p50 {q(sorted(r[5] for r in est), .5):.1f} m")


if __name__ == "__main__":
    main()
