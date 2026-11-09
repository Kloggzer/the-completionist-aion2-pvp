using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace PetOverlay;

// Boss helper centre callout (like DBM's special warning): ONE big instruction in the middle of the screen, above the
// character – "RAUS! · Sprung" with the mechanic's colour, a bar running down over the cast / until the attack and the
// seconds left; "in 3" warnings count down; "you are the target" pulses red. A newer callout replaces the shown one,
// except a danger one still running is not replaced by a plain one. The page decides everything ('bossCall',
// web/src/features/bossmod). Always click-through; in the edit mode of the small overlay windows (OverlayForm.SetWinEdit)
// a sample shows, it can be dragged (WM_NCHITTEST -> HTCAPTION) and sized with the mouse wheel; saved in Settings.
// Per-pixel alpha (UpdateLayeredWindow) like the enemy feed; never activated.
sealed class BossCallForm : Form
{
    readonly Settings s;
    readonly System.Windows.Forms.Timer tick = new() { Interval = 40 };
    string title = "", sub = "";
    Color col = Color.Gold;
    bool danger, edit;
    double seconds; // bar length; 0 = no bar
    DateTime from, until;
    public event Action? Moved;

    float K => DeviceDpi / 96f * (float)s.BossCallScale;
    float W => 360 * K;
    float H => 44 * K;

    public BossCallForm(Settings settings)
    {
        s = settings;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Size = new Size((int)W, (int)H);
        // first show: centred, a bit above the middle of the game's screen (above the character)
        var game = Native.WindowRect(Native.MainWindowOf(s.ProcessName));
        var wa = (game.IsEmpty ? Screen.PrimaryScreen! : Screen.FromRectangle(game)).WorkingArea;
        Location = Placement.Restore(s.BossCallX, s.BossCallY, Size, new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + wa.Height * 30 / 100),
            Screen.AllScreens.Select(sc => sc.WorkingArea).ToList());
        tick.Tick += (_, _) =>
        {
            if (DateTime.UtcNow > until)
            {
                tick.Stop(); // over: hidden, or the static sample in the edit mode
                if (edit) Render(); else Hide();
                return;
            }
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

    /// Show a callout for `seconds` (the bar runs down over it; it stays `hold` seconds longer without a bar).
    public void Call(string title, string sub, Color col, double seconds, bool danger, double hold = 1.2)
    {
        var now = DateTime.UtcNow;
        if (this.danger && !danger && now < until && Visible) return; // a running danger callout wins
        (this.title, this.sub, this.col, this.seconds, this.danger) = (title, sub, col, Math.Max(0, seconds), danger);
        from = now;
        until = now.AddSeconds(Math.Max(1.5, seconds + hold));
        Render();
        if (!Visible) { Show(); Native.KeepOnTop(Handle); }
        tick.Start();
    }

    public void Clear()
    {
        until = DateTime.MinValue;
        if (!edit) { tick.Stop(); Hide(); }
    }

    public void SetEdit(bool on)
    {
        if (on == edit) return;
        edit = on;
        if (IsHandleCreated) UpdateStyles();
        if (edit) { Render(); if (!Visible) { Show(); Native.KeepOnTop(Handle); } }
        else if (DateTime.UtcNow > until) Hide();
    }

    void Render()
    {
        var size = new Size((int)W, (int)H);
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
        bool sample = edit && DateTime.UtcNow > until;
        string t = sample ? L.T("RAUS! · Sprung", "OUT! · Leap") : title, st = sample ? L.T("Boss-Ansage – ziehen, Mausrad = Größe", "Boss callout – drag, wheel = size") : sub;
        var c = sample ? Color.FromArgb(255, 159, 67) : col;
        double left = sample ? 2.4 : Math.Max(0, seconds - (DateTime.UtcNow - from).TotalSeconds);
        double frac = sample ? 0.6 : seconds > 0 ? left / seconds : 0;
        // danger: the frame pulses
        bool pulse = (danger || sample) && Environment.TickCount64 / 220 % 2 == 0;

        // compact: one line – the instruction (bold), the boss / cast small behind it, the seconds right; a thin line runs down
        var r = new RectangleF(2 * k, 2 * k, w - 4 * k, h - 4 * k);
        OverlayStyle.Card(g, r, k, c, Color.FromArgb(pulse ? 255 : 170, c), pulse ? 2.5f : 1.5f);

        using var ft = new Font("Segoe UI", 18f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fs = new Font("Segoe UI Semibold", 11.5f * k, GraphicsUnit.Pixel);
        using var fn = new Font("Segoe UI", 18f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var left0 = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        using var right = new StringFormat(left0) { Alignment = StringAlignment.Far };
        float tx = r.X + 12 * k, numW = seconds > 0 || sample ? 46 * k : 0, room = r.Right - tx - numW - 12 * k, lineY = r.Y, lineH = r.Height - 4 * k;
        float tw = Math.Min(room, g.MeasureString(t, ft, int.MaxValue, left0).Width);
        using (var fg = new SolidBrush(OverlayStyle.Fg)) g.DrawString(t, ft, fg, new RectangleF(tx, lineY, tw + 1, lineH), left0);
        if (st.Length > 0 && room - tw > 40 * k)
            using (var sb = new SolidBrush(OverlayStyle.Muted)) g.DrawString(st, fs, sb, new RectangleF(tx + tw + 8 * k, lineY + 1 * k, room - tw - 8 * k, lineH), left0);
        if (numW > 0)
            using (var nb = new SolidBrush(c))
                g.DrawString(left >= 10 ? $"{left:0}" : left.ToString("0.0", System.Globalization.CultureInfo.CurrentUICulture), fn, nb, new RectangleF(r.Right - numW - 10 * k, lineY, numW, lineH), right);
        // a thin line along the bottom running down
        if (frac > 0)
        {
            var bar = new RectangleF(r.X + 10 * k, r.Bottom - 5 * k, r.Width - 20 * k, 2.5f * k);
            using (var tr = new SolidBrush(Color.FromArgb(60, 255, 255, 255))) g.FillRectangle(tr, bar);
            using (var fb = new SolidBrush(c)) g.FillRectangle(fb, bar.X, bar.Y, bar.Width * (float)Math.Clamp(frac, 0, 1), bar.Height);
        }
        if (edit) OverlayStyle.EditFrame(g, new RectangleF(0.5f, 0.5f, w - 1, h - 1), k);
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
        s.BossCallScale = Math.Clamp(s.BossCallScale + 0.05 * Math.Sign(e.Delta), 0.6, 2.0);
        Render();
        Location = Placement.Clamp(Bounds, Screen.AllScreens.Select(sc => sc.WorkingArea).ToList()).Location; // grew off screen
        s.BossCallX = Left; s.BossCallY = Top;
        Moved?.Invoke();
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also after a drag-move
        s.BossCallX = Left; s.BossCallY = Top;
        Moved?.Invoke();
    }
}
