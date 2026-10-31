using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace PetOverlay;

// Mini radar: a small round window meant to sit right on the player's character (centre of the game screen), so the
// needed mobs around show up like a ring on the ground. It stays up while the main overlay is hidden.
// Per-pixel alpha (UpdateLayeredWindow), always on top, never activated. Locked: click-through, only disc + dots.
// Unlocked: frame, title, range / centre buttons, drag anywhere, resize at the corner grip (stays square).
// The web UI computes the content (relative to the player, metres) and sends it as 'radar2'; drawn only on new data.
sealed class RadarForm : Form
{
    public record struct Dot(float Dx, float Dz, Color Col, bool Named);

    public const int MinRange = 30, MaxRange = 300;
    /// Next range in smooth steps: 10 m up to 100 m, 25 m above (same rule as nextRange in radarContent.ts).
    public static int NextRange(int r, int d)
    {
        int step = (d > 0 ? r >= 100 : r > 100) ? 25 : 10;
        return Math.Clamp((int)Math.Round((r + step * d) / (double)step) * step, MinRange, MaxRange);
    }
    public int MinSide => (int)(150 * K);
    public int MaxSide => (int)(900 * K);
    static readonly Color Ink = Color.FromArgb(11, 18, 32), Gold = Color.FromArgb(232, 200, 114), Cyan = Color.FromArgb(95, 208, 224),
                          Star = Color.FromArgb(255, 210, 94);

    readonly Settings s;
    bool hasData;
    float? heading;
    Dot[] dots = [];
    PointF[] cubes = [];
    PointF? nearest;
    float? sigma; // own position only estimated (PositionTracker): 1-σ radius in metres
    RectangleF minusBtn, plusBtn, centerBtn, grip;

    public bool Locked { get; private set; } = true;
    /// Position, size or a setting changed from inside the window (save + tell the UI).
    public event Action? Changed;

    float K => DeviceDpi / 96f;

    public RadarForm(Settings settings)
    {
        s = settings;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        s.RadarRange = Math.Clamp(s.RadarRange, MinRange, MaxRange);
        int size = s.RadarSize > 0 ? s.RadarSize : (int)(240 * K);
        Size = new Size(size, size);
        if (s.RadarX != int.MinValue && Screen.AllScreens.Any(sc => sc.WorkingArea.IntersectsWith(new Rectangle(s.RadarX, s.RadarY, size, size))))
            Location = new Point(s.RadarX, s.RadarY);
        else CenterOnCharacter(false);
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= Native.WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
            if (Locked) cp.ExStyle |= Native.WS_EX_TRANSPARENT;
            return cp;
        }
    }

    // ---------------------------------------------------------------- state

    public void SetData(bool ok, float? heading, Dot[] dots, PointF[] cubes, PointF? nearest, float? sigma = null)
    {
        hasData = ok; this.heading = heading; this.dots = dots; this.cubes = cubes; this.nearest = nearest; this.sigma = sigma;
        Apply();
    }

    public void SetLocked(bool locked)
    {
        if (locked == Locked) return;
        Locked = locked;
        if (IsHandleCreated) UpdateStyles();
        Apply();
    }

    /// Show / hide as the settings and data say, then redraw. Locked without a position: hidden (nothing to show).
    public void Apply()
    {
        bool want = s.RadarVisible && (hasData || !Locked);
        if (want)
        {
            Render();
            if (!Visible) { Show(); Native.KeepOnTop(Handle); }
        }
        else if (Visible) Hide();
    }

    /// Centre the radar on the game window (the character stands in its middle, a bit lower: RadarOffsetY).
    public void CenterOnCharacter(bool save = true)
    {
        var game = Native.WindowRect(Native.MainWindowOf(s.ProcessName));
        if (game.IsEmpty) game = Screen.PrimaryScreen!.Bounds;
        int cx = game.Left + game.Width / 2, cy = game.Top + game.Height / 2 + (int)(s.RadarOffsetY * K);
        Location = new Point(cx - Width / 2, cy - Height / 2);
        if (!save) return;
        Store();
        Apply();
    }

    /// New edge length, the centre stays in place.
    public void SetSide(int side, bool save = true)
    {
        side = Math.Clamp(side, MinSide, MaxSide);
        if (side == Width) return;
        var c = new Point(Left + Width / 2, Top + Height / 2);
        Bounds = new Rectangle(c.X - side / 2, c.Y - side / 2, side, side);
        if (save) Store();
    }

    void Store()
    {
        s.RadarX = Left; s.RadarY = Top; s.RadarSize = Width;
        Changed?.Invoke();
    }

    // ---------------------------------------------------------------- drawing

    void Render()
    {
        if (Width < 8) return;
        float k = K;
        using var bmp = new Bitmap(Width, Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit; // ClearType needs an opaque background
            float w = Width, cx = w / 2, cy = Height / 2f, r = w / 2 - 2 * k;

            if (!Locked)
            {
                // Grabbable everywhere: layered windows let clicks through fully transparent pixels.
                using var back = new SolidBrush(Color.FromArgb(120, Ink));
                using var frame = new Pen(Color.FromArgb(200, Gold), 1.5f * k);
                using var path = Rounded(new RectangleF(0.75f * k, 0.75f * k, w - 1.5f * k, Height - 1.5f * k), 8 * k);
                g.FillPath(back, path); g.DrawPath(frame, path);
            }

            // Disc + rim, each with its own opacity (RadarDisc / RadarRim): low values keep the character underneath visible.
            int discA = (int)Math.Round(255 * Math.Clamp(s.RadarDisc, 0, 1)), rimA = RimAlpha;
            if (discA > 0) { using var disc = new SolidBrush(Color.FromArgb(discA, Ink)); g.FillEllipse(disc, cx - r, cy - r, 2 * r, 2 * r); }
            if (rimA > 0) { using var rim = new Pen(Color.FromArgb(rimA, Gold), 1.4f * k); g.DrawEllipse(rim, cx - r, cy - r, 2 * r, 2 * r); }

            if (!hasData)
            {
                using var dim = new SolidBrush(Color.FromArgb(170, 221, 226, 236));
                using var f = new Font("Segoe UI", 11 * k, GraphicsUnit.Pixel);
                using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(L.T("keine Position", "no position"), f, dim, new RectangleF(0, 0, w, Height), sf);
            }
            else DrawContent(g, cx, cy, r, k);

            if (!Locked) DrawControls(g, w, k);
        }
        // Overall opacity for everything; unlocked at least 60 % so the controls stay usable.
        double alpha = Math.Clamp(s.RadarAlpha, 0.2, 1);
        if (!Locked) alpha = Math.Max(alpha, 0.6);
        Native.SetLayeredBitmap(Handle, bmp, Location, (byte)Math.Round(alpha * 255));
    }

    int RimAlpha => (int)Math.Round(255 * Math.Clamp(s.RadarRim, 0, 1));

    void DrawContent(Graphics g, float cx, float cy, float r, float k)
    {
        float scale = r / s.RadarRange;
        // Estimated position: everything relative to it is uncertain, so the content is dimmed.
        bool est = sigma is > 0;
        float dim = est ? 0.55f : 1f;
        // "N" at the top (north up, no rotation) and one dashed ring at half the range with its distance.
        using (var nf = new Font("Segoe UI Semibold", 10 * k, GraphicsUnit.Pixel))
        using (var nb = new SolidBrush(Color.FromArgb(220, Gold)))
        using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Near })
        {
            // Dark halo so it stays readable with disc opacity 0 over bright ground.
            using var halo = new SolidBrush(Color.FromArgb(150, Ink));
            // Unlocked the title strip covers the top of the disc: N just below it.
            var at = new RectangleF(cx - 10 * k, cy - r + (Locked ? 1 : 24) * k, 20 * k, 14 * k);
            g.DrawString("N", nf, halo, at with { Y = at.Y + 1 * k }, sf);
            g.DrawString("N", nf, nb, at, sf);
        }
        float hr = r / 2;
        if (RimAlpha * 4 / 5 is > 0 and var ringA)
        {
            using var ring = new Pen(Color.FromArgb(ringA, 255, 255, 255), 1f * k) { DashPattern = [3, 4] };
            g.DrawEllipse(ring, cx - hr, cy - hr, 2 * hr, 2 * hr);
        }
        using (var lf = new Font("Segoe UI", 9 * k, GraphicsUnit.Pixel))
        using (var lb = new SolidBrush(Color.FromArgb(150, 255, 255, 255)))
        {
            float a = (float)(Math.PI / 4);
            g.DrawString($"{s.RadarRange / 2.0:0.#} m", lf, lb, cx + hr * MathF.Cos(a) + 2 * k, cy - hr * MathF.Sin(a) - 12 * k);
        }

        using var clip = new GraphicsPath();
        clip.AddEllipse(cx - r, cy - r, 2 * r, 2 * r);
        var oldClip = g.Clip;
        g.SetClip(clip);

        // Thin line towards the nearest needed mob (ends at the rim when it is farther away than the range).
        if (nearest is { } n)
        {
            float d = MathF.Sqrt(n.X * n.X + n.Y * n.Y), f = d * scale > r ? r / (d * scale) : 1;
            using var pen = new Pen(Color.FromArgb((int)(150 * dim), 255, 255, 255), 1.1f * k);
            g.DrawLine(pen, cx, cy, cx + n.X * scale * f, cy + n.Y * scale * f);
        }

        float dr = Math.Max(2.2f * k, Width / 95f);
        using var outline = new Pen(Color.FromArgb(170, Ink), 1f * k);
        foreach (var dot in dots)
        {
            float x = cx + dot.Dx * scale, y = cy + dot.Dz * scale;
            using var b = new SolidBrush(Color.FromArgb((int)(235 * dim), dot.Col));
            if (dot.Named)
            {
                float q = dr * 1.25f;
                var pts = new[] { new PointF(x, y - q * 1.4f), new PointF(x + q * 1.4f, y), new PointF(x, y + q * 1.4f), new PointF(x - q * 1.4f, y) };
                g.FillPolygon(b, pts); g.DrawPolygon(outline, pts);
            }
            else { g.FillEllipse(b, x - dr, y - dr, 2 * dr, 2 * dr); g.DrawEllipse(outline, x - dr, y - dr, 2 * dr, 2 * dr); }
        }

        using (var sb = new SolidBrush(Color.FromArgb((int)(255 * dim), Star)))
        using (var so = new Pen(Color.FromArgb(200, 27, 22, 7), 1f * k))
            foreach (var c in cubes)
            {
                float x = cx + c.X * scale, y = cy + c.Y * scale, ro = 6.5f * k, ri = 2.8f * k;
                var pts = new PointF[10];
                for (int i = 0; i < 10; i++)
                {
                    double a = Math.PI / 5 * i - Math.PI / 2; float rr = i % 2 == 1 ? ri : ro;
                    pts[i] = new PointF(x + rr * (float)Math.Cos(a), y + rr * (float)Math.Sin(a));
                }
                g.FillPolygon(sb, pts); g.DrawPolygon(so, pts);
            }
        // Estimated position: dashed uncertainty ring (1 σ) around the centre instead of a sharp arrow.
        if (est)
        {
            float sr = Math.Max(6 * k, sigma!.Value * scale);
            using var sf = new SolidBrush(Color.FromArgb(28, Cyan));
            using var sp = new Pen(Color.FromArgb(150, Cyan), 1.3f * k) { DashPattern = [4, 3] };
            g.FillEllipse(sf, cx - sr, cy - sr, 2 * sr, 2 * sr); g.DrawEllipse(sp, cx - sr, cy - sr, 2 * sr, 2 * sr);
        }
        g.Clip = oldClip;

        // Player: small, the real character stands right there. Optional (RadarArrow).
        if (!s.RadarArrow) return;
        using var fill = new SolidBrush(Color.FromArgb(est ? 140 : 255, Cyan));
        using var edge = new Pen(Color.FromArgb(220, Ink), 1.3f * k);
        if (est) { float pr = 2.6f * k; g.FillEllipse(fill, cx - pr, cy - pr, 2 * pr, 2 * pr); g.DrawEllipse(edge, cx - pr, cy - pr, 2 * pr, 2 * pr); return; }
        if (heading is not float h) { float pr = 3.2f * k; g.FillEllipse(fill, cx - pr, cy - pr, 2 * pr, 2 * pr); g.DrawEllipse(edge, cx - pr, cy - pr, 2 * pr, 2 * pr); return; }
        var st = g.Save();
        g.TranslateTransform(cx, cy);
        g.RotateTransform((float)((h + Math.PI / 2) * 180 / Math.PI));
        float u = 0.62f * k;
        var arrow = new[] { new PointF(0, -9 * u), new PointF(6.5f * u, 7 * u), new PointF(0, 3.5f * u), new PointF(-6.5f * u, 7 * u) };
        g.DrawPolygon(edge, arrow); g.FillPolygon(fill, arrow);
        g.Restore(st);
    }

    void DrawControls(Graphics g, float w, float k)
    {
        using var f = new Font("Segoe UI", 10.5f * k, GraphicsUnit.Pixel);
        using var fg = new SolidBrush(Color.FromArgb(240, 221, 226, 236));
        using var strip = new SolidBrush(Color.FromArgb(215, 24, 28, 40));
        using var gold = new SolidBrush(Gold);
        using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        float pad = 4 * k, bh = 18 * k;

        using var border = new Pen(Color.FromArgb(160, Gold), 1f * k);
        void Button(RectangleF rc, string text)
        {
            using var p = Rounded(rc, 4 * k);
            g.FillPath(strip, p); g.DrawPath(border, p);
            g.DrawString(text, f, fg, rc, sf);
        }

        // Title strip: range − / + around "100 m · ziehen zum Verschieben".
        minusBtn = new RectangleF(pad, pad, bh, bh);
        plusBtn = new RectangleF(w - pad - bh, pad, bh, bh);
        var title = new RectangleF(pad * 1.5f + bh, pad, w - 3 * pad - 2 * bh, bh);
        using (var p = Rounded(title, 4 * k)) g.FillPath(strip, p);
        g.DrawString($"{s.RadarRange} m · " + L.T("ziehen zum Verschieben", "drag to move"), f, gold, title, sf);
        Button(minusBtn, "−");
        Button(plusBtn, "+");

        // Bottom: centre on character and a hint for the wheel; the grip sits in the corner.
        float gs = 14 * k, y = Height - pad - bh;
        centerBtn = new RectangleF(pad, y, Math.Min(92 * k, (w - 3 * pad - gs) / 2), bh);
        Button(centerBtn, L.T("⌖ Zentrieren", "⌖ Centre"));
        using (var hint = new SolidBrush(Color.FromArgb(200, 221, 226, 236)))
        using (var hf = new Font("Segoe UI", 9 * k, GraphicsUnit.Pixel))
            g.DrawString(L.T("Rad: Größe · Strg: Zoom", "Wheel: size · Ctrl: zoom"), hf, hint,
                new RectangleF(centerBtn.Right + pad, y, w - centerBtn.Right - 2 * pad - gs - 2 * k, bh), sf);
        grip = new RectangleF(w - pad - gs - 2 * k, Height - pad - gs - 2 * k, gs + pad + 2 * k, gs + pad + 2 * k);
        using var gp = new Pen(Color.FromArgb(220, Gold), 1.4f * k);
        for (int i = 1; i <= 3; i++)
        {
            float o = i * 4.5f * k;
            g.DrawLine(gp, w - pad - o, Height - pad, w - pad, Height - pad - o);
        }
    }

    static GraphicsPath Rounded(RectangleF r, float rad)
    {
        var p = new GraphicsPath();
        float d = Math.Min(rad * 2, Math.Min(r.Width, r.Height));
        p.AddArc(r.Left, r.Top, d, d, 180, 90); p.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    // ---------------------------------------------------------------- mouse (only while unlocked)

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left || Locked) return;
        if (minusBtn.Contains(e.Location) || plusBtn.Contains(e.Location)) Zoom(plusBtn.Contains(e.Location) ? 1 : -1);
        else if (centerBtn.Contains(e.Location)) CenterOnCharacter();
        else Native.BeginDrag(Handle, grip.Contains(e.Location) ? Native.HTBOTTOMRIGHT : Native.HTCAPTION);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        Cursor = Locked ? Cursors.Default : grip.Contains(e.Location) ? Cursors.SizeNWSE
            : minusBtn.Contains(e.Location) || plusBtn.Contains(e.Location) || centerBtn.Contains(e.Location) ? Cursors.Hand : Cursors.SizeAll;
    }

    void Zoom(int d)
    {
        int r = NextRange(s.RadarRange, d);
        if (r == s.RadarRange) return;
        s.RadarRange = r;
        Render();
        Changed?.Invoke();
    }

    // Unlocked: wheel = size (centre stays), Ctrl+wheel = range. Needs "scroll inactive windows" (Windows default),
    // since the radar never takes the focus.
    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        if (Locked || e.Delta == 0) return;
        int d = Math.Sign(e.Delta);
        if ((ModifierKeys & Keys.Control) != 0) Zoom(-d); // wheel up = zoom in = smaller range
        else SetSide((int)Math.Round(Width * (d > 0 ? 1.08 : 1 / 1.08)));
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        if (IsHandleCreated && Visible) Render();
    }

    protected override void OnResizeEnd(EventArgs e)
    {
        base.OnResizeEnd(e); // also after a drag-move
        Store();
    }

    const int WM_SIZING = 0x0214;

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_SIZING)
        {
            // Stay square, within sensible limits.
            var r = System.Runtime.InteropServices.Marshal.PtrToStructure<Native.RECT>(m.LParam);
            int side = Math.Clamp(Math.Max(r.Right - r.Left, r.Bottom - r.Top), MinSide, MaxSide);
            r.Right = r.Left + side; r.Bottom = r.Top + side;
            System.Runtime.InteropServices.Marshal.StructureToPtr(r, m.LParam, false);
            m.Result = 1;
            return;
        }
        base.WndProc(ref m);
    }
}
