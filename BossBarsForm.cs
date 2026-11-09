using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace PetOverlay;

// Boss helper timer bars (like DBM's bars, nothing else): the attacks that come next as tinted countdown bars (badge =
// what to do, colour of the mechanic, pulsing under 5 s) and the HP phases coming up ("noch 3 %"), centred below the
// middle of the game's screen. The page computes everything ('bossBars', 4 times a second, web/src/features/bossmod);
// time bars count down locally between updates. Hidden without bars. Always click-through; in the edit mode of the
// small overlay windows (OverlayForm.SetWinEdit) a sample shows, it can be dragged (WM_NCHITTEST -> HTCAPTION) and
// sized with the mouse wheel. Per-pixel alpha (UpdateLayeredWindow); never activated.
sealed class BossBarsForm : Form
{
    /// One bar: name, left / full (seconds, or HP % with Unit "%"), mechanic colour, badge (short "what to do", e.g. "RAUS").
    public sealed record Bar(string Name, double Left, double Total, Color Col, string Badge, string Unit = "");

    static readonly Color Panel = OverlayStyle.Panel, Fg = OverlayStyle.Fg, Muted = OverlayStyle.Muted, Track = OverlayStyle.Track, HpCol = Color.FromArgb(255, 205, 70, 60), Red = Color.FromArgb(255, 255, 110, 100),
                          Gold = Color.FromArgb(232, 200, 114);
    readonly Settings s;
    readonly System.Windows.Forms.Timer tick = new() { Interval = 100 };
    static readonly TimeSpan Stale = TimeSpan.FromSeconds(2.5); // the page sends 4 times a second: older = it stopped
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
    float W => 300 * K;
    float RowH => 24 * K;
    float Gap => 4 * K;

    public BossBarsForm(Settings settings)
    {
        s = settings;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Size = Measure();
        // first show: centred, a bit below the middle of the game's screen (the centre callout sits above the character)
        var game = Native.WindowRect(Native.MainWindowOf(s.ProcessName));
        var wa = (game.IsEmpty ? Screen.PrimaryScreen! : Screen.FromRectangle(game)).WorkingArea;
        Location = Placement.Restore(s.BossBarsX, s.BossBarsY, Size, new Point(wa.Left + (wa.Width - Size.Width) / 2, wa.Top + wa.Height * 60 / 100),
            Screen.AllScreens.Select(sc => sc.WorkingArea).ToList());
        tick.Tick += (_, _) =>
        {
            // the page stopped sending (reload, crash) during a fight: never stay up frozen
            if (!edit && title.Length > 0 && DateTime.UtcNow - at > Stale) { title = ""; bars = []; Apply(); return; }
            if (Visible) Render();
        };
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
        if (bars.Length > 0 && title.Length > 0 || edit)
        {
            Render();
            if (!Visible) { Show(); Native.KeepOnTop(Handle); }
            tick.Enabled = title.Length > 0; // countdowns and the stale check
        }
        else
        {
            tick.Stop();
            if (Visible) Hide();
        }
    }

    bool Sample => bars.Length == 0 && edit;
    Bar[] Shown() => Sample
        ? [new(L.T("Sprung", "Leap"), 3.4, 66.6, Color.FromArgb(255, 106, 92), L.T("WEG", "DODGE")),
           new(L.T("Ketten", "Chains"), 12.5, 44, Color.FromArgb(197, 139, 255), L.T("VERTEILEN", "SPREAD")),
           new(L.T("Phase 2", "Phase 2"), 4, 15, Color.FromArgb(232, 200, 114), "", "%")]
        : bars;

    Size Measure()
    {
        return new((int)W, (int)Math.Ceiling(Math.Max(1, Shown().Length) * (RowH + Gap) + (Sample ? 18 * K : 0) + 2 * K));
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
        using var fs = new Font("Segoe UI Semibold", 11f * k, GraphicsUnit.Pixel);
        using var fb = new Font("Segoe UI", 12.5f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fbadge = new Font("Segoe UI", 9.5f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fnum = new Font("Segoe UI", 15f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var left = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        using var right = new StringFormat(left) { Alignment = StringAlignment.Far };
        using var center = new StringFormat(left) { Alignment = StringAlignment.Center };
        using var fg = new SolidBrush(Fg);
        using var muted = new SolidBrush(Muted);
        bool sample = Sample;
        double gone = sample ? 0 : (DateTime.UtcNow - at).TotalSeconds;

        // edit mode: a dashed frame to grab
        if (edit) OverlayStyle.EditFrame(g, new RectangleF(0.5f, 0.5f, w - 1, h - 1), k);
        float x0 = 4 * k, x1 = w - 4 * k;

        // timer bars
        float y = 1 * k;
        foreach (var b in Shown())
        {
            bool pct = b.Unit == "%";
            double l = pct ? b.Left : Math.Max(0, b.Left - gone); // HP bars do not count down by time
            var r = new RectangleF(x0, y, x1 - x0, RowH);
            using (var rp = PvpForm.Rounded(r, 4 * k))
            {
                using (var rb = new SolidBrush(Color.FromArgb(215, Track))) g.FillPath(rb, rp);
                float frac = b.Total > 0 ? (float)Math.Clamp(1 - l / b.Total, 0, 1) : 1;
                bool soon = pct ? l < 2 : l < 5;
                int a = soon ? (Environment.TickCount64 / 250 % 2 == 0 ? 235 : 160) : 165;
                g.SetClip(new RectangleF(r.X, r.Y, r.Width * frac, r.Height));
                using (var fill = new SolidBrush(Color.FromArgb(a, b.Col))) g.FillPath(fill, rp);
                g.ResetClip();
                // under 5 s also a frame in the mechanic's colour (not only the pulse)
                if (soon) using (var fr = new Pen(b.Col, 2f * k)) g.DrawPath(fr, rp);
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
            string num = pct ? $"{l:0} %" : l >= 10 ? $"{l:0}" : l.ToString("0.0", System.Globalization.CultureInfo.CurrentUICulture);
            using (var nb = new SolidBrush((pct ? l < 2 : l < 5) ? Color.FromArgb(255, 255, 230, 140) : Fg))
                g.DrawString(num, fnum, nb, new RectangleF(r.Right - 56 * k, y, 50 * k, RowH), right);
            y += RowH + Gap;
        }

        if (sample)
            g.DrawString(L.T("ziehen · Mausrad = Größe", "drag · wheel = size"), fs, muted, new RectangleF(x0, y, x1 - x0, 15 * k), left);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCHITTEST && edit) { m.Result = Native.HTCAPTION; return; }
        base.WndProc(ref m);
    }

    // Edit mode: wheel = size. Needs "scroll inactive windows" (Windows default), since the window never takes the focus.
    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        if (!edit || e.Delta == 0) return;
        s.BossBarsScale = Math.Clamp(s.BossBarsScale + 0.05 * Math.Sign(e.Delta), 0.6, 2.0);
        Render();
        Location = Placement.Clamp(Bounds, Screen.AllScreens.Select(sc => sc.WorkingArea).ToList()).Location; // grew off screen
        s.BossBarsX = Left; s.BossBarsY = Top;
        Moved?.Invoke();
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also after a drag-move
        s.BossBarsX = Left; s.BossBarsY = Top;
        Moved?.Invoke();
    }
}
