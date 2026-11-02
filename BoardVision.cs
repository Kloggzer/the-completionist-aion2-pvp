using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace PetOverlay;

// Finds the open Daevanion board on a screenshot of the game window (pixels only: no game memory, no game traffic, no
// input). The boards are 15x15 grids with the start node at row 8 / column 8; every board has its own pattern of
// nodes and holes (the tab knows them from the board data). Only the grid is searched (node size = pitch, start
// position); the marks are then drawn on its cells. Feature: edge strength. A node tile has a frame and a glyph, the
// background between them is smooth; brightness does not work, the background glows brighter than the tiles towards
// the bottom (checked on a 3840x2160 screenshot: tiles 8-11, holes 0.2-0.7). Score for every board pattern, pitch and
// start position: "mean of the node cells - mean of holes and gaps" over their spread. Prior from a 16:9 screenshot of the
// game: pitch 6.9 % of the client height, start 16.7 % of the height left of the middle and at 54.2 % of the height;
// the search covers -25 % .. +30 % of that pitch and several pitches of offset, so other UI scales and aspect ratios
// still match.
static class BoardVision
{
    public sealed record Layout(string Slot, (int r, int c)[] Cells)
    {
        /// The game draws every board in the same frame, so the pitch is the frame over the board's width; the base pitch
        /// is that of a 13-cell board (Triniel). Checked at 3840x2160: 11 cells (Nezekan-Vaizel) 176.4 px, 13 cells
        /// (Triniel) 149.4 px, 15 cells (Ariel, Azphel, Brawler) 129.5 px.
        public double Scale => 13.0 / Math.Max(Cells.Max(x => x.c) - Cells.Min(x => x.c) + 1, Cells.Max(x => x.r) - Cells.Min(x => x.r) + 1);
    }
    public sealed record Hit(string Slot, double Pitch, double Sx, double Sy, double Score, double Contrast);

    /// Working height of the analysed image (the capture is scaled down to it).
    public const int WorkH = 540;
    /// Below this score the board window counts as closed.
    public const double MinScore = 2.2, MinContrast = 2;
    /// At the known grid less evidence is needed (locked boards are drawn darker, transitions blur for a moment).
    public const double PlaceScore = 1.4, PlaceContrast = 1.2;

    /// Luminance of `bmp` scaled down by an integer factor so that its height is about WorkH; returns (lum, w, h, scale).
    public static (byte[] lum, int w, int h, int f) Luminance(Bitmap bmp)
    {
        int f = Math.Max(1, bmp.Height / WorkH), w = bmp.Width / f, h = bmp.Height / f;
        var lum = new byte[w * h];
        var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            int stride = data.Stride;
            var row = new byte[stride];
            var acc = new int[w];
            for (int y = 0; y < h; y++)
            {
                Array.Clear(acc);
                for (int dy = 0; dy < f; dy++)
                {
                    Marshal.Copy(data.Scan0 + (y * f + dy) * stride, row, 0, stride);
                    for (int x = 0; x < w; x++)
                        for (int dx = 0; dx < f; dx++)
                        {
                            int o = (x * f + dx) * 4; // BGRA
                            acc[x] += (row[o] * 29 + row[o + 1] * 150 + row[o + 2] * 77) >> 8;
                        }
                }
                for (int x = 0; x < w; x++) lum[y * w + x] = (byte)(acc[x] / (f * f));
            }
        }
        finally { bmp.UnlockBits(data); }
        return (lum, w, h, f);
    }

    /// Edge strength (|dx| + |dy| of the luminance), capped so that single bright icons (the start node) do not
    /// dominate the spread.
    static byte[] Edges(byte[] lum, int w, int h)
    {
        var e = new byte[w * h];
        for (int y = 0; y < h - 1; y++)
            for (int x = 0; x < w - 1; x++)
            {
                int i = y * w + x, v = Math.Abs(lum[i + 1] - lum[i]) + Math.Abs(lum[i + w] - lum[i]);
                e[i] = (byte)Math.Min(v, EdgeCap);
            }
        return e;
    }
    const int EdgeCap = 40;

    /// Integral image (w + 1) x (h + 1).
    static long[] Integral(byte[] lum, int w, int h)
    {
        var ii = new long[(w + 1) * (h + 1)];
        for (int y = 1; y <= h; y++)
        {
            long run = 0;
            for (int x = 1; x <= w; x++) { run += lum[(y - 1) * w + x - 1]; ii[y * (w + 1) + x] = ii[(y - 1) * (w + 1) + x] + run; }
        }
        return ii;
    }

    /// Mean luminance in the box of half size `a` around (cx, cy); NaN outside the image.
    static double Box(long[] ii, int w, int h, double cx, double cy, double a)
    {
        int x0 = (int)(cx - a), x1 = (int)(cx + a), y0 = (int)(cy - a), y1 = (int)(cy + a);
        if (x0 < 0 || y0 < 0 || x1 >= w || y1 >= h || x1 <= x0 || y1 <= y0) return double.NaN;
        int W = w + 1;
        long s = ii[y1 * W + x1] - ii[y0 * W + x1] - ii[y1 * W + x0] + ii[y0 * W + x0];
        return (double)s / ((x1 - x0) * (y1 - y0));
    }

    /// Contrast score of one layout at one placement: (mean nodes - mean holes) / spread, and the raw difference.
    static (double score, double contrast) Score(long[] ii, int w, int h, HashSet<int> set, int r0, int r1, int c0, int c1, double p, double sx, double sy, Rectangle mask)
    {
        double a = p * 0.35, sn = 0, sn2 = 0, sh = 0, sh2 = 0;
        int nn = 0, nh = 0, outside = 0;
        for (int r = r0; r <= r1; r++)
            for (int c = c0; c <= c1; c++)
            {
                double x = sx + (c - 8) * p, y = sy + (r - 8) * p;
                if (mask.Contains((int)x, (int)y)) continue; // covered by the app window
                double v = Box(ii, w, h, x, y, a);
                if (double.IsNaN(v)) { outside++; continue; } // outside the image

                if (set.Contains(r * 32 + c))
                {
                    sn += v; sn2 += v * v; nn++;
                    // the gaps right of and below a node are background on every board: they pin the alignment
                    foreach (var (gx, gy) in new[] { (x + p / 2, y), (x, y + p / 2) })
                    {
                        double g = Box(ii, w, h, gx, gy, Math.Max(1, p * 0.06));
                        if (!double.IsNaN(g)) { sh += g; sh2 += g * g; nh++; }
                    }
                }
                else { sh += v; sh2 += v * v; nh++; }
            }
        // a board mostly off the image is no match (a blown-up small board would fit any corner)
        if (nn < 12 || nh < 4 || outside > (r1 - r0 + 1) * (c1 - c0 + 1) / 5) return (double.NegativeInfinity, 0);
        double mn = sn / nn, mh = sh / nh, vn = sn2 / nn - mn * mn, vh = sh2 / nh - mh * mh;
        return ((mn - mh) / Math.Sqrt((vn + vh) / 2 + 0.25), mn - mh);
    }

    /// Best board and placement on the image, in image pixels of `lum`. `near` = the last hit (scaled to this image):
    /// searched around it first; the full search only when it no longer matches and `full` is set. `mask` = the part
    /// covered by the app window (ignored).
    public static Hit? Find(byte[] lum, int w, int h, IReadOnlyList<Layout> layouts, Hit? near = null, bool full = true, Rectangle mask = default)
    {
        var ii = Integral(Edges(lum, w, h), w, h);
        var prep = layouts.Select(l =>
        {
            var set = l.Cells.Select(x => x.r * 32 + x.c).ToHashSet();
            return (l, set, r0: l.Cells.Min(x => x.r), r1: l.Cells.Max(x => x.r), c0: l.Cells.Min(x => x.c), c1: l.Cells.Max(x => x.c), k: l.Scale);
        }).ToList();
        // best placement per board (base pitch p, each board at p * its scale)
        Dictionary<string, Hit> Search(IEnumerable<(Layout l, HashSet<int> set, int r0, int r1, int c0, int c1, double k)> which, double pLo, double pHi, double pStep, double sx0, double sy0, double span, double step)
        {
            var best = new Dictionary<string, Hit>();
            var list = which.ToList();
            for (double p = pLo; p <= pHi; p *= 1 + pStep)
                for (double sx = sx0 - span; sx <= sx0 + span; sx += step)
                    for (double sy = sy0 - span; sy <= sy0 + span; sy += step)
                        foreach (var (l, set, r0, r1, c0, c1, k) in list)
                        {
                            var (s, con) = Score(ii, w, h, set, r0, r1, c0, c1, p * k, sx, sy, mask);
                            // a high score without real contrast is noise (flat areas), not a board
                            if (con >= MinContrast && (!best.TryGetValue(l.Slot, out var b) || s > b.Score)) best[l.Slot] = new Hit(l.Slot, p * k, sx, sy, s, con);
                        }
            return best;
        }
        // refine one board's candidate: around it in pitch and position, half a pixel at the end
        Hit? Refine(Hit c0)
        {
            var one = prep.Where(x => x.l.Slot == c0.Slot).ToList();
            if (one.Count == 0) return null;
            double k = one[0].k, pb = c0.Pitch / k;
            var a = Search(one, pb * 0.97, pb * 1.031, 0.01, c0.Sx, c0.Sy, Math.Max(3, c0.Pitch / 5), 1).Values.FirstOrDefault();
            if (a == null) return null;
            double ab = a.Pitch / k;
            return Search(one, ab * 0.99, ab * 1.011, 0.005, a.Sx, a.Sy, 1.5, 0.5).Values.FirstOrDefault();
        }
        bool Good(Hit? x) => x != null && x.Score >= MinScore && x.Contrast >= MinContrast;

        if (near != null)
        {
            var again = Refine(near);
            if (Good(again)) return again;
        }
        if (!full) return null;
        // coarse: the best candidate of every board; each one refined; the best real fit wins (a blown-up small board
        // may outscore the right one in the coarse pass and then fail)
        double p0 = 0.0691 * h;
        var coarse = Search(prep, p0 * 0.75, p0 * 1.3, 0.04, w / 2.0 - 0.167 * h, 0.542 * h, p0 * 2.5, Math.Max(2, p0 / 6));
        Hit? win = null;
        foreach (var c in coarse.Values.OrderByDescending(x => x.Score))
        {
            var fine = Refine(c);
            if (Good(fine) && (win == null || fine!.Score > win.Score)) win = fine;
        }
        return win;
    }

    /// Which board fits at a known placement (the grid does not move: every board has its start node at the same spot,
    /// the base pitch `p` changes only with the resolution or UI scale; each board at its Scale); null = none. The placement may be off
    /// by a hair (it was found on a small board): each board is looked for within ±2 % pitch and ±3 px of it, which the
    /// big boards (13 and 15 cells wide) need. The hit carries the refined placement.
    public static Hit? AtPlace(byte[] lum, int w, int h, IReadOnlyList<Layout> layouts, double p, double sx, double sy, Rectangle mask = default)
    {
        var ii = Integral(Edges(lum, w, h), w, h);
        Hit? best = null;
        foreach (var l in layouts)
        {
            var set = l.Cells.Select(x => x.r * 32 + x.c).ToHashSet();
            int r0 = l.Cells.Min(x => x.r), r1 = l.Cells.Max(x => x.r), c0 = l.Cells.Min(x => x.c), c1 = l.Cells.Max(x => x.c);
            double pb = p * l.Scale; // this board's pitch
            for (double q = pb * 0.98; q <= pb * 1.0201; q += pb * 0.005)
                for (double x = sx - 3; x <= sx + 3; x += 1)
                    for (double y = sy - 3; y <= sy + 3; y += 1)
                    {
                        var (sc, con) = Score(ii, w, h, set, r0, r1, c0, c1, q, x, y, mask);
                        if (best == null || sc > best.Score) best = new Hit(l.Slot, q, x, y, sc, con);
                    }
        }
        return best != null && best.Score >= PlaceScore && best.Contrast >= PlaceContrast ? best : null;
    }

    /// Score of one layout at a given placement (diagnosis).
    public static (double score, double contrast) ScoreAt(byte[] lum, int w, int h, Layout l, double p, double sx, double sy)
    {
        var set = l.Cells.Select(x => x.r * 32 + x.c).ToHashSet();
        return Score(Integral(Edges(lum, w, h), w, h), w, h, set, l.Cells.Min(x => x.r), l.Cells.Max(x => x.r), l.Cells.Min(x => x.c), l.Cells.Max(x => x.c), p, sx, sy, default);
    }

    /// Mean luminance: a black capture means exclusive fullscreen (or a minimized game).
    public static double Mean(byte[] lum) { long s = 0; foreach (var b in lum) s += b; return lum.Length == 0 ? 0 : (double)s / lum.Length; }
}
