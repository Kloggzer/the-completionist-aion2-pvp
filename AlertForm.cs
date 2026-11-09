using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace PetOverlay;

// Small always-on-top banner for important events (enemy alarm, an optional local module), shown even while the overlay
// is hidden. A card in the overlays' look (OverlayStyle) with one centred line (an optional second, smaller one), per-pixel
// alpha; danger banners (enemy alarm) with a red stripe and edge that flares a few times. Never takes focus; disappears on its
// own, or when the page says the reason is gone (HideDanger: the enemy died / left). Locked (normal): click-through.
// Edit mode (lock icon of the PvP list / hotkey, OverlayForm.SetWinEdit): a sample banner stays up, dashed outline,
// dragged anywhere via WM_NCHITTEST -> HTCAPTION; the position (centre-top) is saved and restored onto a visible screen
// (Placement). Without a saved position it sits centred near the top of the game's screen.
sealed class AlertForm : Form
{
    readonly System.Windows.Forms.Timer hideTimer = new(), blink = new() { Interval = 160 };
    string title = "", sub = "";
    bool edit, danger;
    int flare; // frames left of the glow flaring up
    public Point? SavedLocation { get; set; }
    /// Where danger banners go instead of the saved spot: centred right above this rectangle (the enemy feed, while it
    /// is on), null = the saved spot. With an anchor the edit mode shows no sample banner (move the feed instead).
    public Func<Rectangle?>? Anchor { get; set; }
    public event Action<Point>? Moved;

    float S => DeviceDpi / 96f;
    float Margin => 2 * S;

    public AlertForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        hideTimer.Tick += (_, _) => { hideTimer.Stop(); blink.Stop(); if (!edit) Hide(); };
        blink.Tick += (_, _) => { if (--flare <= 0) blink.Stop(); if (Visible) Render(); };
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            // Click-through and no activation: it must never get in the way of the game (except in edit mode).
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_LAYERED;
            if (!edit) cp.ExStyle |= Native.WS_EX_TRANSPARENT;
            return cp;
        }
    }

    // heavier weights: per-pixel alpha windows get no ClearType, thin text looks washed out over the game
    Font TitleFont() => new("Segoe UI", 14f * S, FontStyle.Bold, GraphicsUnit.Pixel);
    Font SubFont() => new("Segoe UI Semibold", 11.5f * S, GraphicsUnit.Pixel);

    Size Measure()
    {
        using var bmp = new Bitmap(1, 1);
        using var g = Graphics.FromImage(bmp);
        using var ft = TitleFont();
        using var fs = SubFont();
        var a = g.MeasureString(title, ft);
        var b = sub.Length > 0 ? g.MeasureString(sub, fs) : SizeF.Empty;
        float w = Math.Max(a.Width, b.Width) + 28 * S, h = a.Height + (sub.Length > 0 ? b.Height - 2 * S : 0) + 8 * S;
        return new Size((int)Math.Ceiling(w + 2 * Margin), (int)Math.Ceiling(h + 2 * Margin));
    }

    void Place(Screen screen)
    {
        Size = Measure();
        var wa = screen.WorkingArea;
        var fallback = new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + wa.Height / 9);
        var p = SavedLocation ?? new Point(Placement.Unset, Placement.Unset);
        // A saved spot is the banner's centre-top: banners of different width stay centred on it.
        if (SavedLocation != null) p = new Point(p.X - Width / 2, p.Y);
        // enemy alarm with the feed on: right above the feed (the glow margin may overlap it)
        if (danger && !edit && Anchor?.Invoke() is { } a) p = new Point(a.Left + a.Width / 2 - Width / 2, a.Top - Height + (int)Margin);
        Location = Placement.Restore(p.X, p.Y, Size, fallback, Screen.AllScreens.Select(s => s.WorkingArea).ToList());
        if (!Visible) Show();
        Native.KeepOnTop(Handle);
        Render();
    }

    public void ShowAlert(string text, string detail, Screen screen, int seconds = 8, bool danger = false)
    {
        title = text;
        sub = detail;
        this.danger = danger;
        flare = danger ? 8 : 0;
        if (danger) blink.Start(); else blink.Stop();
        Place(screen);
        hideTimer.Stop();
        hideTimer.Interval = seconds * 1000;
        hideTimer.Start();
    }

    /// The reason of a danger banner is gone (enemy dead / out of range): hide it now.
    public void HideDanger()
    {
        if (!danger || edit || !Visible) return;
        hideTimer.Stop(); blink.Stop(); Hide();
    }

    /// Edit mode on: a sample banner stays up to be moved. Off: click-through, hidden.
    public void SetEdit(bool on, Screen screen)
    {
        if (on == edit) return;
        edit = on;
        if (IsHandleCreated) UpdateStyles();
        if (on && Anchor?.Invoke() != null) { Hide(); return; } // placed with the feed
        if (on)
        {
            if (!Visible) { title = L.T("⚠ Hinweis-Banner – ziehen", "⚠ Alert banner – drag"); sub = ""; danger = true; flare = 0; }
            hideTimer.Stop();
            Place(screen);
        }
        else Hide();
    }

    void Render()
    {
        var size = Size;
        using var bmp = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) Draw(g, size.Width, size.Height);
        Native.SetLayeredBitmap(Handle, bmp, Location);
    }

    void Draw(Graphics g, float w, float h)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        var acc = danger ? OverlayStyle.Red : OverlayStyle.Gold;
        var pill = new RectangleF(Margin, Margin, w - 2 * Margin, h - 2 * Margin);
        // danger: the edge flares a few times, then stays red
        bool hot = flare > 0 && flare % 2 == 0;
        OverlayStyle.Card(g, pill, S, acc, danger ? Color.FromArgb(hot ? 255 : 170, acc) : null, danger ? (hot ? 2.5f : 1.5f) : 1f);
        if (edit) OverlayStyle.EditFrame(g, pill, S);

        using var ft = TitleFont();
        using var fs = SubFont();
        using var center = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        using var tb = new SolidBrush(danger ? OverlayStyle.Fg : OverlayStyle.Gold);
        if (sub.Length == 0) { g.DrawString(title, ft, tb, pill, center); return; }
        float th = g.MeasureString(title, ft).Height, sh = g.MeasureString(sub, fs).Height, top = pill.Top + (pill.Height - th - sh + 2 * S) / 2;
        g.DrawString(title, ft, tb, new RectangleF(pill.Left, top, pill.Width, th), center);
        using var sb = new SolidBrush(OverlayStyle.Muted);
        g.DrawString(sub, fs, sb, new RectangleF(pill.Left, top + th - 2 * S, pill.Width, sh), center);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCHITTEST && edit) { m.Result = Native.HTCAPTION; return; }
        base.WndProc(ref m);
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also fires after a drag-move
        SavedLocation = new Point(Left + Width / 2, Top);
        Moved?.Invoke(SavedLocation.Value);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { hideTimer.Dispose(); blink.Dispose(); }
        base.Dispose(disposing);
    }
}
