using System.Text.Json.Nodes;

namespace PetOverlay;

// In-game marks for the Daevanion tab: a transparent, click-through window over the game's client area that draws a
// frame around every node the plan buys (green, the next click gold with its number) or resets (red). It finds the
// open board itself (BoardVision on a screenshot of the game window, about every 0.7 s) and hides the marks while no
// board is visible. Runs on its own while the tab has a plan (no click needed): without a board on screen it looks
// only every few seconds, with one it follows it cheaply. Only pixels are read; the game must run windowed or
// borderless (exclusive fullscreen shows neither the overlay nor anything in a screenshot). The mark window is left
// out of screen capture; the part the app window covers is ignored by the search.
sealed class BoardOverlay : Form
{
    /// Marks per board slot: (row, col, kind 0 new / 1 next / 2 reset, step number or 0).
    public sealed record Board(string Slot, (int r, int c)[] Cells, (int r, int c, int kind, int no)[] Marks);

    readonly Action<object> post;
    readonly Func<Rectangle?> appRect;
    readonly Func<string> process;
    int idle;                  // ticks without a board
    // The grid once found stays where it is (capture pixels, base pitch, for this client size; saved, so it is known
    // right away after a restart): later ticks only ask which board is open there (cheap, every 0.4 s), so a board
    // switch shows within a tick. Only a full search sets the grid; the fit at the grid is for drawing only. A full search runs only without a grid (every FullEvery ticks) or when
    // nothing fitted at the grid for LostAfter ticks (about a minute: UI scale changed). The marks stay through up
    // to KeepMisses ticks without a fit (the switch animation), then they hide.
    BoardVision.Hit? grid;
    Size gridFor;
    int misses;
    const int FullEvery = 4, LostAfter = 150, KeepMisses = 4;
    readonly System.Windows.Forms.Timer timer = new() { Interval = 400 };
    static readonly string GridFile = Path.Combine(Settings.DataDir, "daevanion-grid.json");
    List<Board> boards = new();
    BoardVision.Hit? hit;      // in capture pixels
    int factor = 1;            // capture pixels per analysed pixel
    bool busy;
    string lastState = "";

    public BoardOverlay(Action<object> post, Func<Rectangle?> appRect, Func<string> process)
    {
        this.post = post;
        this.appRect = appRect;
        this.process = process;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(1, 2, 3);
        TransparencyKey = BackColor;
        DoubleBuffered = true;
        timer.Tick += (_, _) => Tick();
    }

    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_LAYERED | Native.WS_EX_TRANSPARENT;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.ExcludeFromCapture(Handle, true);
    }

    /// Message from the tab: { on, boards: [{ slot, cells: [[r, c]], marks: [[r, c, kind, no]] }] }.
    public void Update(JsonNode m)
    {
        boards = (m["boards"] as JsonArray ?? new()).Select(b => new Board(
            (string?)b?["slot"] ?? "",
            (b?["cells"] as JsonArray ?? new()).Select(x => ((int?)x?[0] ?? 0, (int?)x?[1] ?? 0)).ToArray(),
            (b?["marks"] as JsonArray ?? new()).Select(x => ((int?)x?[0] ?? 0, (int?)x?[1] ?? 0, (int?)x?[2] ?? 0, (int?)x?[3] ?? 0)).ToArray())).ToList();
        if ((bool?)m["on"] == true)
        {
            if (!timer.Enabled) { idle = 0; timer.Start(); Tick(); }
            Invalidate(); // marks may have changed
        }
        else Stop();
    }

    public void Stop()
    {
        timer.Stop();
        hit = null;
        Hide();
        State("off");
    }

    void State(string s, string? slot = null)
    {
        var key = s + slot;
        if (key == lastState) return;
        lastState = key;
        OverlayForm.DaeOps($"{DateTime.Now:HH:mm:ss.fff} board {s} {slot}");
        post(new { type = "daeOverlay", state = s, slot });
    }

    /// Capture the game's client area, find the board, move and redraw the marks.
    async void Tick()
    {
        if (busy) return;
        var g = Native.MainWindowOf(process());
        if (g == IntPtr.Zero || !Native.ClientRectOnScreen(g, out var rc) || rc.Width < 200 || rc.Height < 200) { Hide(); State("nogame"); return; }
        busy = true;
        try
        {
            var layouts = boards.Select(b => new BoardVision.Layout(b.Slot, b.Cells)).ToList();
            if (gridFor != rc.Size) { grid = LoadGrid(rc.Size); gridFor = rc.Size; }
            var fixedGrid = grid;
            idle++;
            bool full = fixedGrid == null ? idle % FullEvery == 1 : idle > LostAfter && idle % FullEvery == 1;
            var app = appRect() is { } a && a.IntersectsWith(rc) ? new Rectangle(a.X - rc.X, a.Y - rc.Y, a.Width, a.Height) : Rectangle.Empty;
            var res = await Task.Run(() =>
            {
                using var bmp = new Bitmap(rc.Width, rc.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                using (var gr = Graphics.FromImage(bmp)) gr.CopyFromScreen(rc.Location, Point.Empty, rc.Size);
                var (lum, w, h, f) = BoardVision.Luminance(bmp);
                if (BoardVision.Mean(lum) < 2) return (black: true, hit: (BoardVision.Hit?)null, f, full: false);
                var mask = new Rectangle(app.X / f, app.Y / f, app.Width / f, app.Height / f);
                BoardVision.Hit? x = null;
                bool byFull = false;
                if (layouts.Count > 0 && fixedGrid != null) x = BoardVision.AtPlace(lum, w, h, layouts, fixedGrid.Pitch / f, fixedGrid.Sx / f, fixedGrid.Sy / f, mask);
                if (x == null && layouts.Count > 0 && full) { x = BoardVision.Find(lum, w, h, layouts, null, true, mask); byFull = x != null; }
                return (black: false, hit: x == null ? null : x with { Pitch = x.Pitch * f, Sx = x.Sx * f, Sy = x.Sy * f }, f, full: byFull);
            });
            if (!timer.Enabled) return;
            factor = res.f;
            if (res.black) { hit = null; Hide(); State("black"); return; }
            if (res.hit == null)
            {
                if (hit != null && ++misses <= KeepMisses) return; // a moment without a fit: keep the marks
                hit = null; Hide(); State("search"); return;
            }
            idle = 0; misses = 0;
            // keep the grid: only the board (slot) changes at the same place; a bigger board (or a moved grid) gives the
            // more exact placement
            var board = boards.FirstOrDefault(b => b.Slot == res.hit.Slot);
            double k = board == null ? 1 : new BoardVision.Layout(board.Slot, board.Cells).Scale;
            // only a full search sets the stored grid: the small fit at the grid (for drawing) must never move it, or it
            // walks off step by step (that happened: 149 -> 176 px over a few board switches)
            if (res.full && Plausible(res.hit.Pitch / k, rc.Size)) { grid = res.hit with { Pitch = res.hit.Pitch / k }; SaveGrid(rc.Size, grid); }
            var changed = hit == null || hit.Slot != res.hit.Slot;
            hit = res.hit; // drawn where this board fits best
            if (Bounds != rc) Bounds = rc;
            if (!Visible) Show();
            Native.KeepOnTop(Handle);
            if (changed) Invalidate();
            State("found", hit.Slot);
        }
        catch (Exception ex) { State("error"); OverlayLog?.Invoke("board overlay: " + ex.Message); }
        finally { busy = false; }
    }

    public Action<string>? OverlayLog;

    /// Base pitch within 5-9 % of the client height (3840x2160: 149 px = 6.9 %).
    static bool Plausible(double pitch, Size size) => pitch > size.Height * 0.05 && pitch < size.Height * 0.09;

    /// The grid for a client size, as found last time (capture pixels; base pitch).
    static BoardVision.Hit? LoadGrid(Size size)
    {
        try
        {
            var j = JsonNode.Parse(File.ReadAllText(GridFile));
            if ((int?)j?["w"] != size.Width || (int?)j?["h"] != size.Height) return null;
            var g = new BoardVision.Hit("", (double?)j["pitch"] ?? 0, (double?)j["sx"] ?? 0, (double?)j["sy"] ?? 0, 0, 0);
            return Plausible(g.Pitch, size) ? g : null;
        }
        catch { return null; }
    }
    static void SaveGrid(Size size, BoardVision.Hit g)
    {
        try { File.WriteAllText(GridFile, new JsonObject { ["w"] = size.Width, ["h"] = size.Height, ["pitch"] = g.Pitch, ["sx"] = g.Sx, ["sy"] = g.Sy }.ToJsonString()); }
        catch { }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        if (hit != null && boards.FirstOrDefault(b => b.Slot == hit.Slot) is { } b) BoardMarks.Draw(e.Graphics, hit, b.Marks);
    }

    /// One capture of the game window and the detection result next to it in the data folder (for support).
    public string? Dump()
    {
        var g = Native.MainWindowOf(process());
        if (g == IntPtr.Zero || !Native.ClientRectOnScreen(g, out var rc)) return null;
        using var bmp = new Bitmap(rc.Width, rc.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var gr = Graphics.FromImage(bmp)) gr.CopyFromScreen(rc.Location, Point.Empty, rc.Size);
        var (lum, w, h, f) = BoardVision.Luminance(bmp);
        var x = BoardVision.Find(lum, w, h, boards.Select(b => new BoardVision.Layout(b.Slot, b.Cells)).ToList());
        var path = Path.Combine(Settings.DataDir, "daevanion-capture.png");
        bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        File.WriteAllText(Path.ChangeExtension(path, ".txt"), $"size {rc.Width}x{rc.Height} factor {f} mean {BoardVision.Mean(lum):F1}\nhit {(x == null ? "none" : $"{x.Slot} pitch {x.Pitch * f:F1} start {x.Sx * f:F0},{x.Sy * f:F0} score {x.Score:F2} contrast {x.Contrast:F1}")}\n");
        return path;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) timer.Dispose();
        base.Dispose(disposing);
    }
}
