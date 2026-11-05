using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace PetOverlay;

// Boss helper panel (like DBM's timer bars, styled like the PvP list): header with the boss, its phase and the Frenzy
// countdown, the HP bar with the phase marks, then the next attacks as tinted countdown bars (badge = what to do, colour
// of the mechanic, pulsing under 5 s), footer with the aggro target and the live Petze (who got hit how often).
// The page computes everything ('bossBars', 4 times a second, web/src/features/bossmod); bars and Frenzy count down
// locally between updates. Hidden without a fight. Always click-through; in the edit mode of the small overlay windows
// (OverlayForm.SetWinEdit) a sample shows, it can be dragged (WM_NCHITTEST -> HTCAPTION) and sized with the mouse wheel.
// Per-pixel alpha (UpdateLayeredWindow) like the PvP list; never activated.
sealed class BossBarsForm : Form
{
    /// One timer: name, seconds left / full gap, mechanic colour, badge (short "what to do", e.g. "RAUS").
    public sealed record Bar(string Name, double Left, double Total, Color Col, string Badge);

    static readonly Color Panel = Color.FromArgb(232, 20, 23, 31), Fg = Color.FromArgb(236, 238, 244), Muted = Color.FromArgb(150, 158, 176),
                          Track = Color.FromArgb(255, 38, 42, 54), HpCol = Color.FromArgb(255, 205, 70, 60), Red = Color.FromArgb(255, 255, 110, 100),
                          Gold = Color.FromArgb(232, 200, 114);
    readonly Settings s;
    readonly System.Windows.Forms.Timer tick = new() { Interval = 50 };
    string title = "", phase = "", target = "";
    bool me, edit;
    int hp = 100;
    double frenzy = -1; // seconds left, -1 = none
    int[] phases = [];
    Bar[] bars = [];
    PvpForm.Line[] foot = [];
    DateTime at = DateTime.UtcNow; // when the data came
    public event Action? Moved;

    float K => DeviceDpi / 96f * (float)s.BossBarsScale;
    float W => 270 * K;
    float HeadH => 44 * K;
    float RowH => 22 * K;
    float Gap => 3 * K;
    float FootH => foot.Length * 15 * K + (target.Length > 0 ? 15 * K : 0);

    public BossBarsForm(Settings settings)
    {
        s = settings;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Size = Measure();
        // first show: left of the middle of the game's screen
        var game = Native.WindowRect(Native.MainWindowOf(s.ProcessName));
        var wa = (game.IsEmpty ? Screen.PrimaryScreen! : Screen.FromRectangle(game)).WorkingArea;
        Location = Placement.Restore(s.BossBarsX, s.BossBarsY, Size, new Point(wa.Left + wa.Width * 16 / 100, wa.Top + wa.Height * 32 / 100),
            Screen.AllScreens.Select(sc => sc.WorkingArea).ToList());
        tick.Tick += (_, _) => { if (Visible) Render(); };
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) tick.Dispose();
        base.Dispose(disposing);
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
            if (!edit) cp.ExStyle |= Native.WS_EX_TRANSPARENT;
            return cp;
        }
    }

    /// New state from the page; an empty title = no fight (hidden).
    public void SetData(string title, string phase, int hp, int[] phases, double frenzy, string target, bool me, Bar[] bars, PvpForm.Line[] foot)
    {
        (this.title, this.phase, this.hp, this.phases, this.frenzy, this.target, this.me, this.bars, this.foot) =
            (title, phase, Math.Clamp(hp, 0, 100), phases, frenzy, target, me, bars, foot);
        at = DateTime.UtcNow;
        Apply();
    }

    public void SetEdit(bool on)
    {
        if (on == edit) return;
        edit = on;
        if (IsHandleCreated) UpdateStyles();
        Apply();
    }

    void Apply()
    {
        if (title.Length > 0 || edit)
        {
            Render();
            if (!Visible) { Show(); Native.KeepOnTop(Handle); }
            tick.Enabled = bars.Length > 0 || frenzy > 0;
        }
        else
        {
            tick.Stop();
            if (Visible) Hide();
        }
    }

    bool Sample => title.Length == 0 && edit;
    Bar[] Shown() => Sample
        ? [new(L.T("Sprung", "Leap"), 3.4, 66.6, Color.FromArgb(255, 106, 92), L.T("WEG", "DODGE")),
           new(L.T("Ketten", "Chains"), 12.5, 44, Color.FromArgb(197, 139, 255), L.T("VERTEILEN", "SPREAD")),
           new(L.T("Flächenschlag", "Slam"), 25, 33, Color.FromArgb(92, 224, 138), L.T("ZUSAMMEN", "STACK"))]
        : bars;
    PvpForm.Line[] Foot() => Sample ? [new(L.T("Petze: Testdaeva 2× · Testdaevi 1×", "Blame: Testdaeva 2× · Testdaevi 1×"), Gold)] : foot;

    Size Measure()
    {
        float foot = Sample ? 30 * K : FootH;
        return new((int)W, (int)Math.Ceiling(HeadH + Shown().Length * (RowH + Gap) + (foot > 0 ? foot + 6 * K : 0) + 8 * K));
    }

    void Render()
    {
        var size = Measure();
        if (Size != size) Size = size;
        using var bmp = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) Draw(g, size.Width, size.Height);
        Native.SetLayeredBitmap(Handle, bmp, Location);
    }

    void Draw(Graphics g, float w, float h)
    {
        float k = K;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        using var fh = new Font("Segoe UI Semibold", 13f * k, GraphicsUnit.Pixel);
        using var fs = new Font("Segoe UI", 11f * k, GraphicsUnit.Pixel);
        using var fb = new Font("Segoe UI Semibold", 12f * k, GraphicsUnit.Pixel);
        using var fbadge = new Font("Segoe UI", 8.5f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fnum = new Font("Segoe UI", 12f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var left = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        using var right = new StringFormat(left) { Alignment = StringAlignment.Far };
        using var center = new StringFormat(left) { Alignment = StringAlignment.Center };
        using var fg = new SolidBrush(Fg);
        using var muted = new SolidBrush(Muted);
        bool sample = Sample;
        double gone = sample ? 0 : (DateTime.UtcNow - at).TotalSeconds;

        // panel
        using (var p = PvpForm.Rounded(new RectangleF(0.5f, 0.5f, w - 1, h - 1), 8 * k))
        {
            using (var pb = new SolidBrush(Panel)) g.FillPath(pb, p);
            if (edit)
                using (var pe = new Pen(Color.FromArgb(220, 240, 240, 255), 1f) { DashPattern = [4, 3] }) g.DrawPath(pe, p);
        }
        float x0 = 10 * k, x1 = w - 10 * k;

        // header: boss · phase, Frenzy right
        string head = sample ? "Atiel" : title, ph = sample ? L.T("Phase 2", "Phase 2") : phase;
        double fz = sample ? 184 : frenzy >= 0 ? Math.Max(0, frenzy - gone) : -1;
        float fzW = fz >= 0 ? 74 * k : 0;
        g.DrawString(head, fh, fg, new RectangleF(x0, 4 * k, (x1 - x0 - fzW) * 0.62f, 18 * k), left);
        if (ph.Length > 0)
            using (var pbr = new SolidBrush(Gold)) g.DrawString(ph, fs, pbr, new RectangleF(x0 + (x1 - x0 - fzW) * 0.62f, 4 * k, (x1 - x0 - fzW) * 0.38f, 18 * k), right);
        if (fz >= 0)
            using (var zb = new SolidBrush(fz < 30 ? Red : Muted))
                g.DrawString($"Frenzy {(int)fz / 60}:{(int)fz % 60:00}", fs, zb, new RectangleF(x1 - fzW, 4 * k, fzW, 18 * k), right);
        // HP bar with phase marks and the percentage
        var hpR = new RectangleF(x0, 25 * k, x1 - x0 - 34 * k, 8 * k);
        using (var tr = new SolidBrush(Track)) g.FillRectangle(tr, hpR);
        int hpv = sample ? 72 : hp;
        using (var hc = new SolidBrush(HpCol)) g.FillRectangle(hc, hpR.X, hpR.Y, hpR.Width * hpv / 100f, hpR.Height);
        using (var pm = new Pen(Color.FromArgb(240, 255, 255, 255), 1.5f * k))
            foreach (var p in sample ? new[] { 70, 30 } : phases)
                g.DrawLine(pm, hpR.X + hpR.Width * p / 100f, hpR.Y - 2 * k, hpR.X + hpR.Width * p / 100f, hpR.Bottom + 2 * k);
        g.DrawString($"{hpv} %", fs, fg, new RectangleF(hpR.Right, 20 * k, x1 - hpR.Right, 18 * k), right);

        // timer bars
        float y = HeadH;
        foreach (var b in Shown())
        {
            double l = Math.Max(0, b.Left - gone);
            var r = new RectangleF(x0 - 4 * k, y, x1 - x0 + 8 * k, RowH);
            using (var rp = PvpForm.Rounded(r, 4 * k))
            {
                using (var rb = new SolidBrush(Track)) g.FillPath(rb, rp);
                float frac = b.Total > 0 ? (float)Math.Clamp(1 - l / b.Total, 0, 1) : 1;
                bool soon = l < 5;
                int a = soon ? (Environment.TickCount64 / 250 % 2 == 0 ? 235 : 150) : 120;
                g.SetClip(new RectangleF(r.X, r.Y, r.Width * frac, r.Height));
                using (var fill = new SolidBrush(Color.FromArgb(a, b.Col))) g.FillPath(fill, rp);
                g.ResetClip();
            }
            // badge = what to do
            float bx = r.X + 4 * k, bw = 0;
            if (b.Badge.Length > 0)
            {
                bw = Math.Max(30 * k, g.MeasureString(b.Badge, fbadge).Width + 8 * k);
                var br = new RectangleF(bx, y + 4 * k, bw, RowH - 8 * k);
                using var bp = PvpForm.Rounded(br, 3 * k);
                using (var bb = new SolidBrush(b.Col)) g.FillPath(bb, bp);
                using (var bt = new SolidBrush(Color.FromArgb(20, 22, 28))) g.DrawString(b.Badge, fbadge, bt, br, center);
            }
            g.DrawString(b.Name, fb, fg, new RectangleF(bx + bw + 6 * k, y, r.Right - bx - bw - 54 * k, RowH), left);
            using (var nb = new SolidBrush(l < 5 ? Color.FromArgb(255, 255, 230, 140) : Fg))
                g.DrawString(l >= 10 ? $"{l:0}" : $"{l:0.0}", fnum, nb, new RectangleF(r.Right - 46 * k, y, 40 * k, RowH), right);
            y += RowH + Gap;
        }

        // footer: target, Petze
        float fy = y + 3 * k;
        if (!sample && target.Length > 0)
        {
            using (var tb = new SolidBrush(me ? Red : Muted))
                g.DrawString((me ? L.T("Ziel: DU", "Target: YOU") : L.T("Ziel: ", "Target: ") + target), fs, tb, new RectangleF(x0, fy, x1 - x0, 15 * k), left);
            fy += 15 * k;
        }
        foreach (var line in Foot())
        {
            using (var lb = new SolidBrush(line.Col)) g.DrawString(line.Text, fs, lb, new RectangleF(x0, fy, x1 - x0, 15 * k), left);
            fy += 15 * k;
        }
        if (sample)
            g.DrawString(L.T("ziehen · Mausrad = Größe", "drag · wheel = size"), fs, muted, new RectangleF(x0, fy, x1 - x0, 15 * k), left);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCHITTEST && edit) { m.Result = Native.HTCAPTION; return; }
        base.WndProc(ref m);
    }

    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        if (!edit || e.Delta == 0) return;
        s.BossBarsScale = Math.Clamp(s.BossBarsScale + 0.05 * Math.Sign(e.Delta), 0.6, 2.0);
        Render();
        Moved?.Invoke();
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also after a drag-move
        s.BossBarsX = Left; s.BossBarsY = Top;
        Moved?.Invoke();
    }
}
