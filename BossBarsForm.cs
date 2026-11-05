using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace PetOverlay;

// Boss helper timer bars (like DBM): a head line with the boss, its HP bar with the phase marks and the aggro target,
// then the next attacks as countdown bars (colour = what to do). The page computes everything ('bossBars', 4 times a
// second, web/src/features/bossmod); the bars count down locally between updates so they run smoothly; under 5 s a bar
// pulses. Hidden without a fight. Always click-through; in the edit mode of the small overlay windows
// (OverlayForm.SetWinEdit) a sample shows and it can be dragged (WM_NCHITTEST -> HTCAPTION); position in Settings.
// Per-pixel alpha (UpdateLayeredWindow) like the enemy feed; never activated.
sealed class BossBarsForm : Form
{
    public sealed record Bar(string Name, double Left, double Total, Color Col);

    static readonly Color Back = Color.FromArgb(210, 14, 16, 22), Fg = Color.FromArgb(240, 242, 248), Muted = Color.FromArgb(160, 168, 186),
                          Track = Color.FromArgb(150, 40, 44, 56), HpCol = Color.FromArgb(220, 205, 70, 60), Me = Color.FromArgb(255, 255, 120, 110);
    readonly Settings s;
    readonly System.Windows.Forms.Timer tick = new() { Interval = 50 };
    string title = "", target = "";
    bool me, edit;
    int hp = 100;
    int[] phases = [];
    Bar[] bars = [];
    DateTime at = DateTime.UtcNow; // when the bars came
    public event Action? Moved;

    float K => DeviceDpi / 96f;
    float W => 260 * K;
    float HeadH => 30 * K;
    float RowH => 20 * K;
    float Gap => 3 * K;

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
        Location = Placement.Restore(s.BossBarsX, s.BossBarsY, Size, new Point(wa.Left + wa.Width * 18 / 100, wa.Top + wa.Height * 35 / 100),
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

    /// New state from the page; no bars and no title = no fight (hidden).
    public void SetData(string title, int hp, int[] phases, string target, bool me, Bar[] bars)
    {
        (this.title, this.hp, this.phases, this.target, this.me, this.bars) = (title, Math.Clamp(hp, 0, 100), phases, target, me, bars);
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
        bool want = title.Length > 0 || edit;
        if (want)
        {
            Render();
            if (!Visible) { Show(); Native.KeepOnTop(Handle); }
            tick.Enabled = bars.Length > 0;
        }
        else
        {
            tick.Stop();
            if (Visible) Hide();
        }
    }

    Bar[] Shown() => title.Length == 0 && edit
        ? [new("Skill 1801450", 4.2, 66.6, Color.FromArgb(255, 106, 92)), new("Skill 1801460", 12.5, 66.6, Color.FromArgb(255, 159, 67)), new("Skill 1605630", 25, 33, Color.FromArgb(76, 195, 255))]
        : bars;

    Size Measure() => new((int)W, (int)Math.Ceiling(HeadH + Shown().Length * (RowH + Gap) + 4 * K));

    void Render()
    {
        var size = Measure();
        if (Size != size) Size = size;
        using var bmp = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) Draw(g, size.Width);
        Native.SetLayeredBitmap(Handle, bmp, Location);
    }

    void Draw(Graphics g, float w)
    {
        float k = K;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        using var fh = new Font("Segoe UI Semibold", 12.5f * k, GraphicsUnit.Pixel);
        using var fs = new Font("Segoe UI", 10.5f * k, GraphicsUnit.Pixel);
        using var fb = new Font("Segoe UI Semibold", 11.5f * k, GraphicsUnit.Pixel);
        using var left = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        using var right = new StringFormat(left) { Alignment = StringAlignment.Far };
        using var fg = new SolidBrush(Fg);
        using var muted = new SolidBrush(Muted);
        bool sample = title.Length == 0;
        var rows = Shown();

        // head: boss name, target, HP bar with phase marks
        var head = new RectangleF(1, 1, w - 2, HeadH - 2);
        using (var hp0 = PvpForm.Rounded(head, 6 * k))
        using (var hb = new SolidBrush(Back)) g.FillPath(hb, hp0);
        float hx = 8 * k, hw = w - 16 * k;
        g.DrawString(sample ? L.T("Boss-Helfer – ziehen", "Boss helper – drag") : title, fh, fg, new RectangleF(hx, 2 * k, hw * 0.62f, 16 * k), left);
        if (target.Length > 0)
            using (var tb = new SolidBrush(me ? Me : Muted))
                g.DrawString("→ " + (me ? L.T("DU", "YOU") : target), fs, tb, new RectangleF(hx + hw * 0.62f, 2 * k, hw * 0.38f, 16 * k), right);
        var hpR = new RectangleF(hx, 20 * k, hw, 5 * k);
        using (var tr = new SolidBrush(Track)) g.FillRectangle(tr, hpR);
        using (var hc = new SolidBrush(HpCol)) g.FillRectangle(hc, hpR.X, hpR.Y, hpR.Width * (sample ? 0.72f : hp / 100f), hpR.Height);
        using (var pm = new Pen(Color.FromArgb(230, 255, 255, 255), 1.5f * k))
            foreach (var p in sample ? new[] { 70, 30 } : phases) g.DrawLine(pm, hpR.X + hpR.Width * p / 100f, hpR.Y - 2 * k, hpR.X + hpR.Width * p / 100f, hpR.Bottom + 2 * k);

        // bars: countdown since the last update
        double gone = sample ? 0 : (DateTime.UtcNow - at).TotalSeconds;
        float y = HeadH + 2 * k;
        foreach (var b in rows)
        {
            double leftS = Math.Max(0, b.Left - gone);
            var r = new RectangleF(1, y, w - 2, RowH);
            using (var back = new SolidBrush(Back)) g.FillRectangle(back, r);
            float frac = b.Total > 0 ? (float)Math.Clamp(1 - leftS / b.Total, 0, 1) : 1;
            bool soon = leftS < 5;
            int a = soon && Environment.TickCount64 / 250 % 2 == 0 ? 255 : 190;
            using (var fill = new SolidBrush(Color.FromArgb(a, b.Col))) g.FillRectangle(fill, r.X, r.Y, r.Width * frac, r.Height);
            var tr2 = new RectangleF(r.X + 6 * k, r.Y, r.Width - 12 * k, r.Height);
            g.DrawString(b.Name, fb, fg, new RectangleF(tr2.X, tr2.Y, tr2.Width - 44 * k, tr2.Height), left);
            g.DrawString(leftS >= 10 ? $"{leftS:0}" : $"{leftS:0.0}", fb, fg, tr2, right);
            y += RowH + Gap;
        }
        if (edit)
            using (var dash = new Pen(Color.FromArgb(220, 240, 240, 255), 1f) { DashPattern = [4, 3] })
                g.DrawRectangle(dash, 0, 0, w - 1, Height - 1);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCHITTEST && edit) { m.Result = Native.HTCAPTION; return; }
        base.WndProc(ref m);
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also after a drag-move
        s.BossBarsX = Left; s.BossBarsY = Top;
        Moved?.Invoke();
    }
}
