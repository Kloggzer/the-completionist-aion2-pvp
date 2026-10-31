namespace PetOverlay;

// Upcoming-event announcer (world bosses, rifts, sieges ...): a small always-on-top stack of cards, each with a
// live countdown and a close button. Never activated, so the game keeps the focus. Locked (normal): click-through.
// Edit mode (lock icon of the PvP list / hotkey, OverlayForm.SetWinEdit): clickable, dashed frame, dragged anywhere
// via WM_NCHITTEST -> HTCAPTION, a sample card while nothing is announced; the position is saved and restored onto a
// visible screen (Placement). Cards are drawn by the form itself (child controls would take the hit test).
sealed class AnnounceForm : Form
{
    sealed record Entry(string Key, string Title, string Detail, DateTime At);

    static readonly Color Bg = Color.FromArgb(24, 28, 40), Gold = Color.FromArgb(255, 210, 94), Fg = Color.FromArgb(221, 226, 236),
                          Red = Color.FromArgb(255, 120, 120), Key = Color.FromArgb(10, 12, 18);
    readonly List<Entry> entries = new();
    readonly System.Windows.Forms.Timer tick = new() { Interval = 1000 };
    readonly List<(RectangleF box, Entry e)> closers = new();
    bool edit;
    // Saved top-left corner (screen px); null = default spot (right side of the screen).
    public Point? SavedLocation { get; set; }
    public event Action<Point>? Moved;

    float S => DeviceDpi / 96f;
    int CardW => (int)(340 * S);
    int CardH => (int)(64 * S);
    int Gap => (int)(6 * S);

    public AnnounceForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = Key;
        TransparencyKey = Key; // gaps between the cards: see-through and click-through
        DoubleBuffered = true;
        tick.Tick += (_, _) => Refresh_();
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_LAYERED;
            if (!edit) cp.ExStyle |= Native.WS_EX_TRANSPARENT;
            return cp;
        }
    }

    public void Announce(string key, string title, string detail, DateTime at, Screen screen)
    {
        if (entries.Any(e => e.Key == key)) return;
        entries.Add(new Entry(key, title, detail, at));
        Place(screen);
        tick.Start();
        Refresh_();
    }

    /// Edit mode on: clickable and movable, a sample card when empty. Off: click-through, hidden when empty.
    public void SetEdit(bool on, Screen screen)
    {
        if (on == edit) return;
        edit = on;
        if (IsHandleCreated) UpdateStyles();
        if (on) { Place(screen); tick.Start(); }
        Refresh_();
    }

    void Place(Screen screen)
    {
        Layout_();
        if (!Visible)
        {
            var wa = screen.WorkingArea;
            var fallback = new Point(wa.Right - CardW - (int)(24 * S), wa.Top + wa.Height / 5);
            var p = SavedLocation ?? new Point(Placement.Unset, Placement.Unset);
            Location = Placement.Restore(p.X, p.Y, Size, fallback, Screen.AllScreens.Select(s => s.WorkingArea).ToList());
            Show();
        }
        Native.KeepOnTop(Handle);
    }

    int Cards => entries.Count + (edit && entries.Count == 0 ? 1 : 0);

    void Layout_()
    {
        var size = new Size(CardW, Math.Max(1, Cards) * (CardH + Gap) - Gap);
        if (Size != size) Size = size;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        float s = S;
        using var ft = new Font("Segoe UI Semibold", 12f);
        using var fd = new Font("Segoe UI", 10f);
        using var bg = new SolidBrush(Bg);
        using var fg = new SolidBrush(Fg);
        using var sf = new StringFormat { LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        using var center = new StringFormat(sf) { Alignment = StringAlignment.Center };
        closers.Clear();
        var now = DateTime.UtcNow;
        var list = entries.Count > 0 ? entries
            : edit ? [new Entry("", L.T("Ankündigungen", "Announcements"), L.T("ziehen zum Verschieben", "drag to move"), DateTime.MinValue)] : [];
        for (int i = 0; i < list.Count; i++)
        {
            var en = list[i];
            float y = i * (CardH + Gap);
            g.FillRectangle(bg, 0, y, CardW, CardH);
            var left = en.At - now;
            bool sample = en.At == DateTime.MinValue, soon = !sample && left.TotalSeconds <= 60;
            using (var pen = new Pen(Gold, 2)) g.DrawRectangle(pen, 1, y + 1, CardW - 3, CardH - 3);
            using (var tb = new SolidBrush(soon ? Red : Gold))
                g.DrawString(en.Title, ft, tb, new RectangleF(12 * s, y + 5 * s, 288 * s, 26 * s), sf);
            string when = sample ? en.Detail
                : (left.TotalSeconds > 0 ? $"in {(int)left.TotalMinutes}:{left.Seconds:00}" : L.T("läuft jetzt!", "starting now!")) + " · " + en.Detail;
            g.DrawString(when, fd, fg, new RectangleF(12 * s, y + 32 * s, 300 * s, 24 * s), sf);
            if (sample) continue;
            var box = new RectangleF(CardW - 36 * s, y + 5 * s, 30 * s, 28 * s);
            g.DrawString("✕", fd, fg, box, center);
            closers.Add((box, en));
        }
        if (edit)
        {
            // Edit mode: dashed frame around the whole stack as the "you can move this" handle.
            using var dash = new Pen(Color.FromArgb(240, 240, 255), 1f) { DashPattern = [4, 3] };
            g.DrawRectangle(dash, 0, 0, Width - 1, Height - 1);
        }
    }

    const int HTCLIENT = 1;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCHITTEST && edit)
        {
            var p = PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF)));
            m.Result = closers.Any(c => c.box.Contains(p)) ? HTCLIENT : Native.HTCAPTION;
            return;
        }
        base.WndProc(ref m);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left && closers.FirstOrDefault(c => c.box.Contains(e.Location)) is { e: { } en })
        {
            entries.Remove(en);
            Refresh_();
        }
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also fires after a drag-move
        SavedLocation = Location;
        Moved?.Invoke(Location);
    }

    void Refresh_()
    {
        var now = DateTime.UtcNow;
        entries.RemoveAll(e => e.At - now < TimeSpan.FromMinutes(-2)); // started a while ago: done
        if (Cards == 0) { tick.Stop(); Hide(); return; }
        Layout_();
        Invalidate();
    }
}
