using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace PetOverlay;

// PvP overlay: a compact meter-style panel listing nearby enemy players, nearest first. Header: status dot, title
// (arena / zone + count), lock; unlocked also settings and close. Two sections: enemies, then (optional) the own team (arena team / party, self marked). Rows: tinted bars
// (fill = CP relative to the strongest listed / own CP; enemies: colour = weaker / similar / stronger than you, team:
// blue), large class emblem (embedded res/classes, text badge for unknown classes), name (+ server), item level, CP,
// distance. Team list and alarm sound are switched in the settings. Footer: own character (without the team section) + website lookup status. Per-pixel alpha via UpdateLayeredWindow (like the other overlays), always on top, never
// activated. Locked: click-through except the lock icon (cursor polling, no input hook, like the main overlay's
// header). Unlocked = edit mode of all small overlay windows (OverlayForm.SetWinEdit, also the announcer and the alert
// banner): drag anywhere to move (WM_NCHITTEST -> HTCAPTION), right edge for the width, mouse wheel for the size;
// saved in settings and restored onto a visible screen (Placement).
// The web UI picks, sorts, formats and colours the rows (web/src/features/pvp) and posts them as 'pvp2'.
sealed class PvpForm : Form
{
    /// Cls = text badge (fallback), K = class number 2..9 (emblem), Me = oneself (distance column shows the marker),
    /// Dim = gone (out of range / dead), still listed for a few seconds.
    public record struct Row(string Cls, int K, Color ClsCol, string Name, string Sub, string Cp, Color CpCol, Color BarCol, string Dist, float Fill, bool Me, bool Dim = false, Color? DistCol = null, string Il = "");
    /// One line of the summary (fight odds) or the kill feed.
    public record struct Line(string Text, Color Col);
    /// Dungeon panel section (page: group dungeon): a head (boss) and its lines (Frenzy, mechanics), on a tab
    /// (Bosse / Runs / Loot; "" = always shown).
    public record struct PanelSec(string Head, Line[] Lines, string Tab = "");

    public const double MinScale = 0.6, MaxScale = 2.0;
    static readonly Color Panel = Color.FromArgb(20, 23, 31), Fg = Color.FromArgb(236, 238, 244), Muted = Color.FromArgb(150, 158, 176),
                          Icon = Color.FromArgb(176, 182, 198), Teal = Color.FromArgb(104, 200, 186), Green = Color.FromArgb(96, 214, 120),
                          Yellow = Color.FromArgb(232, 196, 92), Gold = Color.FromArgb(232, 200, 114);
    const string IconFont = "Segoe MDL2 Assets";
    const string GSettings = "\uE713", GClose = "\uE8BB", GLock = "\uE72E", GUnlock = "\uE785";

    readonly Settings s;
    Row[] rows = [];
    Row[]? team; // null = no team section
    Line? odds; // fight odds against the nearest enemy group (below the header)
    Line[] feed = []; // recent kills around (own section at the end)
    string feedHead = "";
    int footK;
    string title = "PvP", empty = "", foot = "", footCls = "", status = "", enemyHead = "", teamHead = "";
    Color footCol = Fg, statusCol = Muted;
    bool dismissed, hot;
    // Urgency (page, 'pvp2'): 0 nobody near, 1 an enemy within the alarm range, 2 one close; red header / frame, pulsing
    // at 2; a new alarm blinks for 3 s.
    int urgency;
    long lastAlarm;
    PanelSec[] panel = [];
    // dungeon panel tabs: the chosen one (kept across dungeons by name) and their click areas
    string panelTab = "";
    (RectangleF Rc, string Name)[] tabBtns = [];
    string[] Tabs => panel.Select(p => p.Tab).Where(t => t.Length > 0).Distinct().ToArray();
    string CurTab { get { var ts = Tabs; return ts.Contains(panelTab) ? panelTab : ts.FirstOrDefault() ?? ""; } }
    PanelSec[] Shown { get { var c = CurTab; return panel.Where(p => p.Tab.Length == 0 || p.Tab == c).ToArray(); } }
    float TabH => Tabs.Length > 1 ? 24 * K : 0;
    bool OnTab(PointF p) => tabBtns.Any(b => b.Rc.Contains(p));
    DateTime flashUntil = DateTime.MinValue;
    readonly System.Windows.Forms.Timer pulse = new() { Interval = 90 };
    static readonly Color Danger = Color.FromArgb(255, 72, 64);
    RectangleF lockBtn, setBtn, closeBtn, grip;
    readonly System.Windows.Forms.Timer poll = new() { Interval = 80 }, clock = new() { Interval = 1000 };

    public bool Locked { get; private set; } = true;
    /// Position, width, size or collapse changed from inside the window (save + tell the UI).
    public event Action? Changed;
    public event Action? SettingsClicked, CloseClicked, LockClicked;

    float K => DeviceDpi / 96f * (float)Math.Clamp(s.PvpScale, MinScale, MaxScale);
    int MinW => (int)(260 * K);
    int MaxW => (int)(640 * K);

    public PvpForm(Settings settings)
    {
        s = settings;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Size = Measure();
        // First show: left edge of the game's screen, upper third (the event announcer sits on the right).
        var game = Native.WindowRect(Native.MainWindowOf(s.ProcessName));
        var wa = (game.IsEmpty ? Screen.PrimaryScreen! : Screen.FromRectangle(game)).WorkingArea;
        Location = Placement.Restore(s.PvpX, s.PvpY, Size, new Point(wa.Left + (int)(24 * DeviceDpi / 96f), wa.Top + wa.Height / 5),
            Screen.AllScreens.Select(sc => sc.WorkingArea).ToList());
        // Locked = click-through; the lock icon stays clickable: poll the cursor and drop WS_EX_TRANSPARENT over it.
        poll.Tick += (_, _) =>
        {
            var p = PointToClient(Cursor.Position);
            bool over = Visible && Locked && (lockBtn.Contains(p) || panel.Length > 0 && OnTab(p));
            if (over != hot) { hot = over; UpdateStyles(); }
        };
        clock.Tick += (_, _) => { if (Visible && rows.Length == 0) Apply(); }; // Hold runs out
        pulse.Tick += (_, _) =>
        {
            if (urgency < 2 && DateTime.UtcNow >= flashUntil) pulse.Stop();
            if (Visible) Render();
        };
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
            if (Locked && !hot) cp.ExStyle |= Native.WS_EX_TRANSPARENT;
            return cp;
        }
    }

    // ---------------------------------------------------------------- state

    public void SetData(string title, string empty, Row[] rows, Row[]? team, string enemyHead, string teamHead,
        string foot, string footCls, int footK, Color footCol, string status, Color statusCol,
        Line? odds = null, Line[]? feed = null, string feedHead = "", int urgency = 0, long alarmAt = 0, PanelSec[]? panel = null)
    {
        this.panel = panel ?? [];
        this.urgency = urgency;
        // a new alarm (page: enemy alarm fired): blink for a moment
        if (alarmAt > 0 && alarmAt != lastAlarm) { lastAlarm = alarmAt; flashUntil = DateTime.UtcNow.AddSeconds(3); }
        if (urgency >= 2 || DateTime.UtcNow < flashUntil) { if (!pulse.Enabled) pulse.Start(); }
        if (rows.Length > 0) lastRows = DateTime.UtcNow;
        this.title = title; this.empty = empty; this.rows = rows; this.team = team; this.enemyHead = enemyHead; this.teamHead = teamHead;
        this.foot = foot; this.footCls = footCls; this.footK = footK; this.footCol = footCol; this.status = status; this.statusCol = statusCol;
        this.odds = odds; this.feed = feed ?? []; this.feedHead = feedHead;
        Apply();
    }

    /// Auto mode: the window stays this long after the last enemy (or kill) before it hides, so short gaps (enemies
    /// stepping out of range, stealth, teleports) don't make it flicker.
    static readonly TimeSpan Hold = TimeSpan.FromSeconds(20);
    DateTime lastRows = DateTime.MinValue;
    bool Holding => rows.Length > 0 || feed.Length > 0 || panel.Length > 0 || DateTime.UtcNow - lastRows < Hold;

    public void SetLocked(bool locked)
    {
        if (locked == Locked) return;
        Locked = locked;
        hot = false;
        if (IsHandleCreated) UpdateStyles();
        Apply();
    }

    /// Visible while enabled, not hidden by hand, and with rows (or always: auto-hide off, or unlocked for moving);
    /// nobody around with "only with enemies": folded to the header or 10 % visible instead of hidden (PvpIdle).
    public bool Wanted => s.PvpOn && (!dismissed || !Locked) && (Holding || !s.PvpAuto || !Locked || s.PvpIdle != "hide");
    /// Nobody around (with "only with enemies", locked): the idle look.
    bool Idle => s.PvpAuto && Locked && !Holding;

    public void Apply()
    {
        if (!Holding) dismissed = false; // fight over; hidden by hand: back with the next enemies
        if (Wanted)
        {
            Render();
            if (!Visible) { Show(); Native.KeepOnTop(Handle); poll.Start(); clock.Start(); }
        }
        else if (Visible) { Hide(); poll.Stop(); clock.Stop(); }
    }

    /// Shown again after "hide until the next fight" (switch / hotkey turned it on).
    public void Undismiss() { dismissed = false; Apply(); }

    public void SetScale(double scale)
    {
        scale = Math.Clamp(Math.Round(scale, 2), MinScale, MaxScale);
        if (scale == s.PvpScale) return;
        double f = scale / s.PvpScale;
        s.PvpScale = scale;
        if (s.PvpWidth > 0) s.PvpWidth = (int)Math.Round(s.PvpWidth * f);
        Apply();
        Changed?.Invoke();
    }

    // ---------------------------------------------------------------- layout + drawing

    float Pad => 8 * K;
    bool Compact => s.PvpCompact;
    float HeadH => (Compact ? 28 : 36) * K;
    float RowH => (Compact ? 26 : 34) * K;
    float RowGap => (Compact ? 3 : 4) * K;
    float FootH => 24 * K;
    float SecH => 17 * K;
    float LineH => 18 * K;

    Size Measure()
    {
        int w = s.PvpWidth > 0 ? Math.Clamp(s.PvpWidth, MinW, MaxW) : (int)(340 * K);
        if (Idle && s.PvpIdle == "bar") return new Size(w, (int)Math.Ceiling(HeadH));
        int tn = team?.Length ?? 0;
        if (panel.Length > 0)
            return new Size(w, (int)Math.Ceiling(HeadH + TabH + Shown.Sum(p => SecH + p.Lines.Length * LineH) + Pad));
        if (Compact)
        {
            // nobody around: the header alone; else odds + enemies (+ team), nothing else
            if (rows.Length == 0 && tn == 0) return new Size(w, (int)Math.Ceiling(HeadH));
            float cs = team == null ? 0 : (tn > 0 ? SecH + tn * (RowH + RowGap) : 0);
            return new Size(w, (int)Math.Ceiling(HeadH + (odds != null ? LineH : 0) + rows.Length * (RowH + RowGap) + cs + Pad / 2));
        }
        int n = Math.Max(1, rows.Length);
        float sec = team == null ? 0 : SecH + (tn > 0 ? SecH + tn * (RowH + RowGap) : 0);
        float extra = (odds != null ? LineH : 0) + (feed.Length > 0 ? SecH + feed.Length * LineH : 0);
        return new Size(w, (int)Math.Ceiling(HeadH + sec + extra + n * (RowH + RowGap) + FootH + Pad / 2));
    }

    // ---- class emblems (embedded res/classes/*.png, PetOverlay.csproj), by class number 2..9
    static readonly string[] ClassFiles = ["", "", "gladiator", "templar", "ranger", "assassin", "spiritmaster", "sorcerer", "cleric", "chanter"];
    static readonly Dictionary<int, Image?> icons = new();

    public static Image? ClassIcon(int k)
    {
        if (k is < 2 or > 9) return null;
        if (icons.TryGetValue(k, out var img)) return img;
        try
        {
            using var st = typeof(PvpForm).Assembly.GetManifestResourceStream($"classes/{ClassFiles[k]}.png");
            if (st != null) { using var raw = Image.FromStream(st); img = new Bitmap(raw); } // copy: FromStream needs its stream
        }
        catch (ArgumentException) { img = null; }
        return icons[k] = img;
    }

    static void DrawIcon(Graphics g, Image img, RectangleF r)
    {
        var (im, pm) = (g.InterpolationMode, g.PixelOffsetMode);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(img, r);
        (g.InterpolationMode, g.PixelOffsetMode) = (im, pm);
    }

    void Render()
    {
        var size = Measure();
        if (Size != size) Size = size;
        using var bmp = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) Draw(g, size.Width, size.Height);
        double alpha = Idle && s.PvpIdle == "dim" ? 0.1 : Math.Clamp(s.PvpAlpha, 0.2, 1);
        Native.SetLayeredBitmap(Handle, bmp, Location, (byte)Math.Round(alpha * 255));
    }

    void Draw(Graphics g, float w, float h)
    {
        float k = K, pad = Pad;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit; // ClearType needs an opaque background
        // urgency: 0..1 strength of the red (pulsing when close, blinking right after an alarm)
        double ph = (Math.Sin(Environment.TickCount64 / 1000.0 * Math.PI * 3) + 1) / 2;
        bool flash = DateTime.UtcNow < flashUntil, blinkOn = flash && Environment.TickCount64 / 250 % 2 == 0;
        float heat = blinkOn ? 1f : urgency >= 2 ? 0.55f + 0.45f * (float)ph : urgency == 1 ? 0.45f : 0f;
        using (var back = new SolidBrush(heat > 0 && blinkOn ? Color.FromArgb(Locked ? 238 : 248, 70, 14, 14) : Color.FromArgb(Locked ? 238 : 248, Panel)))
        using (var edge = new Pen(heat > 0 ? Color.FromArgb((int)(120 + 135 * heat), Danger) : Locked ? Color.FromArgb(46, 255, 255, 255) : Color.FromArgb(200, Gold), (heat > 0 ? 1.5f + 2f * heat : 1f) * k))
        using (var path = Rounded(new RectangleF(0.5f, 0.5f, w - 1, h - 1), 10 * k))
        {
            g.FillPath(back, path);
            if (heat > 0)
            {
                // red header band
                var st = g.Save();
                g.SetClip(path);
                using var hb = new SolidBrush(Color.FromArgb((int)(40 + 110 * heat), Danger));
                g.FillRectangle(hb, 0, 0, w, HeadH);
                g.Restore(st);
            }
            g.DrawPath(edge, path);
        }

        using var ft = new Font("Segoe UI Semibold", (Compact ? 14f : 15.5f) * k, GraphicsUnit.Pixel);
        using var fs = new Font("Segoe UI", 11.5f * k, GraphicsUnit.Pixel);
        using var fn = new Font("Segoe UI Semibold", 14f * k, GraphicsUnit.Pixel);
        using var fv = new Font("Segoe UI", 16f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fl = new Font("Segoe UI Semibold", 14f * k, GraphicsUnit.Pixel);
        using var fdist = new Font("Segoe UI Semibold", 12f * k, GraphicsUnit.Pixel);
        using var fc = new Font("Segoe UI", 10f * k, FontStyle.Bold, GraphicsUnit.Pixel);
        using var fi = new Font(IconFont, 12.5f * k, GraphicsUnit.Pixel);
        using var left = new StringFormat(StringFormat.GenericTypographic) { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap | StringFormatFlags.MeasureTrailingSpaces };
        using var right = new StringFormat(left) { Alignment = StringAlignment.Far };
        using var center = new StringFormat(left) { Alignment = StringAlignment.Center };
        using var fg = new SolidBrush(Fg);
        using var muted = new SolidBrush(Muted);
        using var icon = new SolidBrush(Icon);

        // ---- header: dot, title, lock (+ settings, close while unlocked)
        float x = 14 * k, cy = HeadH / 2, r = 5 * k;
        using (var dot = new SolidBrush(urgency > 0 ? Color.White : rows.Length > 0 ? Green : Yellow)) g.FillEllipse(dot, x - r, cy - r, 2 * r, 2 * r);
        float bs = (Compact ? 24 : 28) * k, bx = w - pad - bs;
        if (Locked) closeBtn = setBtn = RectangleF.Empty;
        else
        {
            closeBtn = new RectangleF(bx, cy - bs / 2, bs, bs); bx -= bs;
            setBtn = new RectangleF(bx, cy - bs / 2, bs, bs); bx -= bs;
            g.DrawString(GSettings, fi, icon, setBtn, center);
            g.DrawString(GClose, fi, icon, closeBtn, center);
        }
        lockBtn = new RectangleF(bx, cy - bs / 2, bs, bs);
        using (var lb = new SolidBrush(Locked ? Icon : Gold)) g.DrawString(Locked ? GLock : GUnlock, fi, lb, lockBtn, center);
        float tx = x + 12 * k;
        g.DrawString(title, ft, fg, new RectangleF(tx, 0, Math.Max(20 * k, lockBtn.Left - 6 * k - tx), HeadH), left);
        if (Idle && s.PvpIdle == "bar") { grip = RectangleF.Empty; return; }

        // ---- rows: enemies, then the own team (section heads only with the team section)
        float y = HeadH, rx = pad, rw = w - 2 * pad;
        using var fh = new Font("Segoe UI Semibold", 10f * k, GraphicsUnit.Pixel);
        void Section(string head)
        {
            float hw = g.MeasureString(head, fh, 400, left).Width + 1;
            g.DrawString(head, fh, muted, new RectangleF(rx + 4 * k, y, hw, SecH), left);
            using var ln = new Pen(Color.FromArgb(36, 255, 255, 255), 1f);
            g.DrawLine(ln, rx + 4 * k + hw + 6 * k, y + SecH / 2, rx + rw - 4 * k, y + SecH / 2);
            y += SecH;
        }
        void TextLine(Line ln)
        {
            using var lb = new SolidBrush(ln.Col);
            g.DrawString(ln.Text, fs, lb, new RectangleF(rx + 4 * k, y, rw - 8 * k, LineH), left);
            y += LineH;
        }
        if (panel.Length > 0)
        {
            // dungeon: tabs (Bosse / Runs / Loot), then the sections of the chosen one
            var ts = Tabs;
            string cur = CurTab;
            if (ts.Length > 1)
            {
                using var ftab = new Font("Segoe UI Semibold", 11f * k, GraphicsUnit.Pixel);
                float tw = (rw - 8 * k) / ts.Length, th = 20 * k, ty = y + 2 * k;
                tabBtns = ts.Select((n, i) => (new RectangleF(rx + 4 * k + i * tw, ty, tw - 4 * k, th), n)).ToArray();
                foreach (var (rc, n) in tabBtns)
                {
                    bool on = n == cur;
                    using var tp = Rounded(rc, th / 2);
                    using (var tb = new SolidBrush(on ? Color.FromArgb(60, Gold) : Color.FromArgb(18, 255, 255, 255))) g.FillPath(tb, tp);
                    if (on) using (var te = new Pen(Color.FromArgb(200, Gold), 1f)) g.DrawPath(te, tp);
                    using var tf = new SolidBrush(on ? Gold : Muted);
                    g.DrawString(n, ftab, tf, rc, center);
                }
                y += TabH;
            }
            else tabBtns = [];
            foreach (var p in Shown) { Section(p.Head); foreach (var ln in p.Lines) TextLine(ln); }
            grip = Locked ? RectangleF.Empty : new RectangleF(w - 6 * k, HeadH, 6 * k, h - HeadH);
            return;
        }
        if (odds is { } od) TextLine(od);
        if (team != null) Section(enemyHead);
        if (rows.Length == 0 && !Compact)
        {
            g.DrawString(empty, fs, muted, new RectangleF(rx + 6 * k, y, rw - 12 * k, RowH), left);
            y += RowH + RowGap;
        }
        foreach (var row in rows) { DrawRow(row); y += RowH + RowGap; }
        if (team is { Length: > 0 })
        {
            Section(teamHead);
            foreach (var row in team) { DrawRow(row); y += RowH + RowGap; }
        }
        if (feed.Length > 0 && !Compact)
        {
            Section(feedHead);
            foreach (var ln in feed) TextLine(ln);
        }

        void DrawRow(Row row)
        {
            var bar = new RectangleF(rx, y, rw, RowH);
            using (var bp = Rounded(bar, 6 * k))
            using (var bb = new SolidBrush(Color.FromArgb(18, 255, 255, 255)))
                g.FillPath(bb, bp);
            if (row.Fill > 0)
            {
                using var fp = Rounded(bar with { Width = Math.Max(12 * k, rw * Math.Clamp(row.Fill, 0, 1)) }, 6 * k);
                using var fb = new SolidBrush(Color.FromArgb(62, row.BarCol));
                g.FillPath(fb, fp);
            }
            if (row.Me)
                using (var mp = Rounded(bar, 6 * k))
                using (var mpen = new Pen(Color.FromArgb(120, Gold), 1f * k))
                    g.DrawPath(mpen, mp);
            // class emblem (text badge for unknown classes)
            float bd = (Compact ? 22 : 28) * k, bxx = rx + 4 * k, byy = y + (RowH - bd) / 2;
            if (ClassIcon(row.K) is { } img) DrawIcon(g, img, new RectangleF(bxx, byy, bd, bd));
            else
            {
                var badge = new RectangleF(bxx + 1 * k, byy + 1 * k, bd - 2 * k, bd - 2 * k);
                using (var bpth = Rounded(badge, 5 * k))
                using (var bf = new SolidBrush(Color.FromArgb(70, row.ClsCol)))
                using (var bl = new Pen(Color.FromArgb(170, row.ClsCol), 1f * k))
                { g.FillPath(bf, bpth); g.DrawPath(bl, bpth); }
                using var cb = new SolidBrush(row.ClsCol);
                g.DrawString(row.Cls, fc, cb, new RectangleF(bxx - 4 * k, byy, bd + 8 * k, bd), center);
            }
            // right: item level, CP, distance (fixed columns, so the numbers line up)
            float distW = 40 * k, cpW = 60 * k, ilW = 42 * k, re = rx + rw - 7 * k;
            using (var db = new SolidBrush(row.Me ? Gold : row.DistCol ?? Muted)) g.DrawString(row.Dist, fdist, db, new RectangleF(re - distW, y, distW, RowH), right);
            using (var cpb = new SolidBrush(row.CpCol)) g.DrawString(row.Cp, fv, cpb, new RectangleF(re - distW - cpW, y, cpW, RowH), right);
            float ilx = re - distW - cpW - ilW;
            if (row.Il.Length > 0) g.DrawString(row.Il, fl, fg, new RectangleF(ilx, y, ilW, RowH), right);
            // name (+ server while there is room)
            float nx = bxx + bd + 8 * k, nMax = ilx - 6 * k - nx;
            float nameW = Math.Min(g.MeasureString(row.Name, fn, 2000, left).Width + 1, nMax);
            g.DrawString(row.Name, fn, fg, new RectangleF(nx, y, nameW, RowH), left);
            if (!Compact && nMax - nameW > 40 * k) g.DrawString(row.Sub, fs, muted, new RectangleF(nx + nameW + 6 * k, y + 1 * k, nMax - nameW - 6 * k, RowH), left);
            // gone (out of range / dead): greyed out by a veil of the panel colour
            if (row.Dim)
                using (var vp = Rounded(bar, 6 * k))
                using (var veil = new SolidBrush(Color.FromArgb(140, Panel)))
                    g.FillPath(veil, vp);
        }

        if (!Compact)
        {
            // ---- footer: own character, lookup status
            float fy = h - FootH - pad / 4;
            float sx = w - pad - 4 * k;
            if (status.Length > 0)
            {
                float sw = Math.Min(g.MeasureString(status, fs, 400, left).Width + 2, w / 2);
                using (var sb = new SolidBrush(statusCol)) g.DrawString(status, fs, sb, new RectangleF(sx - sw, fy, sw, FootH), right);
                sx -= sw + 6 * k;
            }
            float ox = 12 * k;
            if (ClassIcon(footK) is { } fimg)
            {
                float fd = 16 * k;
                DrawIcon(g, fimg, new RectangleF(ox - 2 * k, fy + (FootH - fd) / 2, fd, fd));
                ox += fd + 4 * k;
            }
            else if (footCls.Length > 0)
            {
                using var oc = new SolidBrush(footCol);
                g.DrawString(footCls, fc, oc, new RectangleF(ox - 2 * k, fy, 26 * k, FootH), left);
                ox += 24 * k;
            }
            using (var ob = new SolidBrush(footCol)) g.DrawString(foot, fs, ob, new RectangleF(ox, fy, Math.Max(10, sx - ox), FootH), left);
        }
        grip = Locked ? RectangleF.Empty : new RectangleF(w - 6 * k, HeadH, 6 * k, h - HeadH - FootH);
    }

    internal static GraphicsPath Rounded(RectangleF r, float rad)
    {
        var p = new GraphicsPath();
        float d = Math.Min(rad * 2, Math.Min(r.Width, r.Height));
        p.AddArc(r.Left, r.Top, d, d, 180, 90); p.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    // ---------------------------------------------------------------- mouse

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        var p = (PointF)e.Location;
        if (lockBtn.Contains(p)) { LockClicked?.Invoke(); return; }
        if (panel.Length > 0 && tabBtns.FirstOrDefault(b => b.Rc.Contains(p)) is { Name.Length: > 0 } tab) { panelTab = tab.Name; Apply(); return; }
        if (Locked) return;
        if (closeBtn.Contains(p)) CloseClicked?.Invoke();
        else if (setBtn.Contains(p)) SettingsClicked?.Invoke();
    }

    bool OnButton(PointF p) => (panel.Length > 0 && OnTab(p)) || lockBtn.Contains(p) || closeBtn.Contains(p) || setBtn.Contains(p);

    /// Unlocked hit test: buttons are client area, the right edge resizes, everything else moves the window.
    public int HitTest(PointF p) => OnButton(p) ? 1 /* HTCLIENT */ : grip.Contains(p) ? Native.HTRIGHT : Native.HTCAPTION;

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var p = (PointF)e.Location;
        Cursor = lockBtn.Contains(p) || panel.Length > 0 && OnTab(p) || !Locked && OnButton(p) ? Cursors.Hand : Cursors.Default;
    }

    // Unlocked: wheel = size. Needs "scroll inactive windows" (Windows default), since the window never takes the focus.
    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        if (!Locked && e.Delta != 0) SetScale(s.PvpScale + 0.05 * Math.Sign(e.Delta));
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        if (IsHandleCreated && Visible) Render();
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also after a drag-move
        s.PvpX = Left; s.PvpY = Top; s.PvpWidth = Width;
        Changed?.Invoke();
    }

    const int WM_SIZING = 0x0214;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCHITTEST && !Locked)
        {
            m.Result = HitTest(PointToClient(new Point((short)(m.LParam.ToInt64() & 0xFFFF), (short)((m.LParam.ToInt64() >> 16) & 0xFFFF))));
            return;
        }
        if (m.Msg == WM_SIZING)
        {
            // Only the width changes; the height follows the rows.
            var r = System.Runtime.InteropServices.Marshal.PtrToStructure<Native.RECT>(m.LParam);
            r.Right = r.Left + Math.Clamp(r.Right - r.Left, MinW, MaxW);
            r.Bottom = r.Top + Height;
            System.Runtime.InteropServices.Marshal.StructureToPtr(r, m.LParam, false);
            s.PvpWidth = r.Right - r.Left;
            m.Result = 1;
            return;
        }
        base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { poll.Dispose(); clock.Dispose(); pulse.Dispose(); }
        base.Dispose(disposing);
    }
}
