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
    // The grid once found stays where it is (capture pixels, for this client size): later ticks only ask which board
    // is open there, so the frames never move. A full search runs only without a grid (every FullEvery ticks) or when
    // nothing fitted at the grid for LostAfter ticks (UI scale changed).
    BoardVision.Hit? grid;
    Size gridFor;
    const int FullEvery = 4, LostAfter = 40;
    readonly System.Windows.Forms.Timer timer = new() { Interval = 700 };
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
            if (gridFor != rc.Size) { grid = null; gridFor = rc.Size; }
            var fixedGrid = grid;
            idle++;
            bool full = fixedGrid == null ? idle % FullEvery == 1 : idle > LostAfter && idle % FullEvery == 1;
            var app = appRect() is { } a && a.IntersectsWith(rc) ? new Rectangle(a.X - rc.X, a.Y - rc.Y, a.Width, a.Height) : Rectangle.Empty;
            var res = await Task.Run(() =>
            {
                using var bmp = new Bitmap(rc.Width, rc.Height, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
                using (var gr = Graphics.FromImage(bmp)) gr.CopyFromScreen(rc.Location, Point.Empty, rc.Size);
                var (lum, w, h, f) = BoardVision.Luminance(bmp);
                if (BoardVision.Mean(lum) < 2) return (black: true, hit: (BoardVision.Hit?)null, f);
                var mask = new Rectangle(app.X / f, app.Y / f, app.Width / f, app.Height / f);
                BoardVision.Hit? x = null;
                if (layouts.Count > 0 && fixedGrid != null) x = BoardVision.AtPlace(lum, w, h, layouts, fixedGrid.Pitch / f, fixedGrid.Sx / f, fixedGrid.Sy / f, mask);
                if (x == null && layouts.Count > 0 && full) x = BoardVision.Find(lum, w, h, layouts, null, true, mask);
                return (black: false, hit: x == null ? null : x with { Pitch = x.Pitch * f, Sx = x.Sx * f, Sy = x.Sy * f }, f);
            });
            if (!timer.Enabled) return;
            factor = res.f;
            if (res.black) { hit = null; Hide(); State("black"); return; }
            if (res.hit == null) { hit = null; Hide(); State("search"); return; }
            idle = 0;
            // keep the grid: only the board (slot) can change at the same place
            grid ??= res.hit;
            if (Math.Abs(res.hit.Pitch - grid.Pitch) > grid.Pitch * 0.02 || Math.Abs(res.hit.Sx - grid.Sx) > grid.Pitch * 0.1 || Math.Abs(res.hit.Sy - grid.Sy) > grid.Pitch * 0.1) grid = res.hit;
            var changed = hit == null || hit.Slot != res.hit.Slot;
            hit = grid with { Slot = res.hit.Slot };
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
