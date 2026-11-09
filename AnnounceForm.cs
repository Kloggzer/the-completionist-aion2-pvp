using System.Drawing.Imaging;

namespace PetOverlay;

// Upcoming-event announcer (world bosses, rifts, sieges ...): a small always-on-top stack of cards (OverlayStyle), each
// with a live countdown and a close button. Never activated, so the game keeps the focus. Normally click-through, except
// while the mouse is over a card: then it takes clicks – ✕ closes, anywhere else drags the stack (no edit mode needed). Edit mode
// (lock icon of the PvP list / hotkey, OverlayForm.SetWinEdit): clickable, dashed frame, dragged anywhere via
// WM_NCHITTEST -> HTCAPTION, a sample card while nothing is announced; the position is saved and restored onto a
// visible screen (Placement). Per-pixel alpha (UpdateLayeredWindow) like the other overlays.
sealed class AnnounceForm : Form
{
    sealed record Entry(string Key, string Title, string Detail, DateTime At);

    readonly List<Entry> entries = new();
    readonly System.Windows.Forms.Timer tick = new() { Interval = 1000 }, hover = new() { Interval = 60 };
    readonly List<(RectangleF box, Entry e)> closers = new();
    readonly List<RectangleF> cards = new();
    bool edit, hot; // hot: the mouse is over a card (the window takes clicks: ✕ closes, the rest drags)
    // Saved top-left corner (screen px); null = default spot (right side of the screen).
    public Point? SavedLocation { get; set; }
    public event Action<Point>? Moved;

    float S => DeviceDpi / 96f;
    int CardW => (int)(320 * S);
    int CardH => (int)(56 * S);
    int Gap => (int)(6 * S);

    public AnnounceForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        tick.Tick += (_, _) => Refresh_();
        // click-through except over a card: checked by the cursor position (a click-through window gets no mouse moves)
        hover.Tick += (_, _) =>
        {
            var p = PointToClient(Cursor.Position);
            bool over = cards.Any(c => c.Contains(p));
            if (over == hot) return;
            hot = over;
            if (IsHandleCreated) UpdateStyles();
            Render();
        };
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { tick.Dispose(); hover.Dispose(); }
        base.Dispose(disposing);
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_LAYERED;
            if (!edit && !hot) cp.ExStyle |= Native.WS_EX_TRANSPARENT;
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

    void Render()
    {
        if (!IsHandleCreated || Width < 1 || Height < 1) return;
        using var bmp = new Bitmap(Width, Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) Draw(g);
        Native.SetLayeredBitmap(Handle, bmp, Location);
    }

    void Draw(Graphics g)
    {
        OverlayStyle.Prepare(g);
        float s = S;
        // heavier weights: per-pixel alpha windows get no ClearType, thin text looks washed out over the game
        using var ft = new Font("Segoe UI", 14.5f * s, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fd = new Font("Segoe UI Semibold", 12f * s, GraphicsUnit.Pixel);
        using var fx = new Font("Segoe UI", 13f * s, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fg = new SolidBrush(OverlayStyle.Fg);
        using var muted = new SolidBrush(OverlayStyle.Muted);
        using var sf = new StringFormat { LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        using var center = new StringFormat(sf) { Alignment = StringAlignment.Center };
        closers.Clear();
        cards.Clear();
        var now = DateTime.UtcNow;
        var mouse = PointToClient(Cursor.Position);
        var list = entries.Count > 0 ? entries
            : edit ? [new Entry("", L.T("Ankündigungen", "Announcements"), L.T("ziehen zum Verschieben", "drag to move"), DateTime.MinValue)] : [];
        for (int i = 0; i < list.Count; i++)
        {
            var en = list[i];
            float y = i * (CardH + Gap);
            var card = new RectangleF(0.5f, y + 0.5f, CardW - 1, CardH - 1);
            var left = en.At - now;
            bool sample = en.At == DateTime.MinValue, soon = !sample && left.TotalSeconds <= 60;
            var acc = soon ? OverlayStyle.Red : OverlayStyle.Gold;
            OverlayStyle.Card(g, card, s, acc, Color.FromArgb(soon ? 210 : 150, acc));
            if (!sample) cards.Add(card);
            float tx = 14 * s, tw = CardW - tx - 40 * s;
            using (var tb = new SolidBrush(acc)) g.DrawString(en.Title, ft, tb, new RectangleF(tx, y + 6 * s, tw, 22 * s), sf);
            string when = sample ? en.Detail
                : (left.TotalSeconds > 0 ? $"in {(int)left.TotalMinutes}:{left.Seconds:00}" : L.T("läuft jetzt!", "starting now!")) + " · " + en.Detail;
            g.DrawString(when, fd, muted, new RectangleF(tx, y + 28 * s, tw, 20 * s), sf);
            if (sample) continue;
            var box = new RectangleF(CardW - 36 * s, y + (CardH - 28 * s) / 2, 28 * s, 28 * s);
            if (box.Contains(mouse))
                using (var hb = new SolidBrush(Color.FromArgb(40, 255, 255, 255)))
                using (var hp = PvpForm.Rounded(box, 6 * s))
                    g.FillPath(hb, hp);
            g.DrawString("✕", fx, fg, box, center);
            closers.Add((box, en));
        }
        if (edit) OverlayStyle.EditFrame(g, new RectangleF(0.5f, 0.5f, Width - 1, Height - 1), s);
    }

    protected override void WndProc(ref Message m)
    {
        const int HTCLIENT = 1;
        if (m.Msg == Native.WM_NCHITTEST && (edit || hot))
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
        if (Cards == 0)
        {
            tick.Stop(); hover.Stop();
            if (hot) { hot = false; if (IsHandleCreated) UpdateStyles(); }
            Hide();
            return;
        }
        Layout_();
        if (edit) hover.Stop(); else hover.Start();
        Render();
    }
}
