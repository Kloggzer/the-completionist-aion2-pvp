using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace PetOverlay;

// Nearby enemy feed: a bare widget that shows only the enemies around (the enemy rows of the PvP list, 'pvp2') and
// nothing else – no header, no buttons, no background when nobody is there (then hidden). Meant to sit under the own
// character. Always click-through; in the edit mode of the small overlay windows (OverlayForm.SetWinEdit) a sample
// frame shows and the widget can be dragged (WM_NCHITTEST -> HTCAPTION); the position is saved (Settings.FeedX/Y).
// Per-pixel alpha (UpdateLayeredWindow) like the PvP list; never activated.
sealed class EnemyFeedForm : Form
{
    static readonly Color Pill = OverlayStyle.Panel, Fg = OverlayStyle.Fg, Muted = OverlayStyle.Muted; // the overlays' look
    readonly Settings s;
    PvpForm.Row[] rows = [];
    int urgency;
    bool edit;
    // a new alarm: the pills flare red for a moment
    DateTime flashUntil = DateTime.MinValue;
    readonly System.Windows.Forms.Timer flashTimer = new() { Interval = 160 };
    public event Action? Moved;

    float K => DeviceDpi / 96f * (float)s.FeedScale;
    float RowH => 22 * K;
    float Gap => 3 * K;

    public EnemyFeedForm(Settings settings)
    {
        s = settings;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Size = Measure();
        // first show: below the middle of the game's screen (under the character)
        var game = Native.WindowRect(Native.MainWindowOf(s.ProcessName));
        var wa = (game.IsEmpty ? Screen.PrimaryScreen! : Screen.FromRectangle(game)).WorkingArea;
        Location = Placement.Restore(s.FeedX, s.FeedY, Size, new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + wa.Height * 62 / 100),
            Screen.AllScreens.Select(sc => sc.WorkingArea).ToList());
        flashTimer.Tick += (_, _) => { if (DateTime.UtcNow >= flashUntil) flashTimer.Stop(); if (Visible) Render(); };
    }

    /// Flare red for a moment (enemy alarm).
    public void Flash()
    {
        flashUntil = DateTime.UtcNow.AddSeconds(2.5);
        flashTimer.Start();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) flashTimer.Dispose();
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

    /// Enemy rows (gone ones left out) and the urgency of the list (0 / 1 near / 2 close).
    public void SetData(PvpForm.Row[] enemies, int urgency)
    {
        rows = enemies.Where(r => !r.Dim && !r.Me).Take(Math.Clamp(s.FeedLimit, 1, 10)).ToArray();
        this.urgency = urgency;
        Apply();
    }

    public void SetEdit(bool on)
    {
        if (on == edit) return;
        edit = on;
        if (IsHandleCreated) UpdateStyles();
        Apply();
    }

    public void Apply()
    {
        bool want = s.FeedOn && (rows.Length > 0 || edit);
        if (want)
        {
            Render();
            if (!Visible) { Show(); Native.KeepOnTop(Handle); }
        }
        else if (Visible) Hide();
    }

    Size Measure()
    {
        int n = Math.Max(1, rows.Length);
        return new Size((int)(230 * K), (int)Math.Ceiling(n * (RowH + Gap) + 2 * K));
    }

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
        using var fn = new Font("Segoe UI Semibold", 12f * k, GraphicsUnit.Pixel);
        using var fv = new Font("Segoe UI", 12f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fd = new Font("Segoe UI Semibold", 12f * k, GraphicsUnit.Pixel);
        using var fc = new Font("Segoe UI", 8f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var left = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        using var right = new StringFormat(left) { Alignment = StringAlignment.Far };
        using var center = new StringFormat(left) { Alignment = StringAlignment.Center };
        using var fg = new SolidBrush(Fg);
        using var muted = new SolidBrush(Muted);

        if (rows.Length == 0)
        {
            // edit mode without enemies: a sample frame to place it
            var r0 = new RectangleF(1, 1, w - 2, RowH);
            using var p0 = PvpForm.Rounded(r0, RowH / 2);
            using (var b0 = new SolidBrush(Pill)) g.FillPath(b0, p0);
            using (var d0 = new Pen(Color.FromArgb(220, 240, 240, 255), 1f) { DashPattern = [4, 3] }) g.DrawPath(d0, p0);
            g.DrawString(L.T("Gegner-Feed – ziehen", "Enemy feed – drag"), fn, muted, new RectangleF(10 * k, 1, w - 20 * k, RowH), center);
            return;
        }
        float y = 1;
        bool flare = DateTime.UtcNow < flashUntil && Environment.TickCount64 / 160 % 2 == 0;
        foreach (var row in rows)
        {
            var r = new RectangleF(1, y, w - 2, RowH);
            using var path = PvpForm.Rounded(r, RowH / 2);
            using (var back = new SolidBrush(flare ? Color.FromArgb(220, 120, 20, 18) : Pill)) g.FillPath(back, path);
            // left accent: alarm colour of the distance (or the CP colour)
            var acc = row.DistCol ?? row.CpCol;
            using (var ap = new Pen(Color.FromArgb(urgency >= 2 && row.DistCol != null ? 255 : 200, acc), 2f * k)) g.DrawPath(ap, path);
            float bd = 16 * k, bx = 6 * k, by = y + (RowH - bd) / 2;
            if (PvpForm.ClassIcon(row.K) is { } img) g.DrawImage(img, new RectangleF(bx, by, bd, bd));
            else using (var cb = new SolidBrush(row.ClsCol)) g.DrawString(row.Cls, fc, cb, new RectangleF(bx - 4 * k, y, bd + 8 * k, RowH), center);
            float re = w - 9 * k, distW = 42 * k, cpW = 46 * k;
            using (var db = new SolidBrush(row.DistCol ?? Fg)) g.DrawString(row.Dist, fd, db, new RectangleF(re - distW, y, distW, RowH), right);
            using (var cpb = new SolidBrush(row.CpCol)) g.DrawString(row.Cp, fv, cpb, new RectangleF(re - distW - cpW, y, cpW, RowH), right);
            float nx = bx + bd + 6 * k;
            g.DrawString(row.Name, fn, fg, new RectangleF(nx, y, Math.Max(10, re - distW - cpW - 4 * k - nx), RowH), left);
            y += RowH + Gap;
        }
        if (edit)
            using (var dash = new Pen(Color.FromArgb(220, 240, 240, 255), 1f) { DashPattern = [4, 3] })
                g.DrawRectangle(dash, 0, 0, w - 1, y - Gap);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCHITTEST && edit) { m.Result = Native.HTCAPTION; return; }
        base.WndProc(ref m);
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also after a drag-move
        s.FeedX = Left; s.FeedY = Top;
        Moved?.Invoke();
    }
}
