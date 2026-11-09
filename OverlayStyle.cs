using System.Drawing.Drawing2D;

namespace PetOverlay;

// One look for the small overlay windows (event banner, alert banner, boss callout, boss bars, enemy feed; the PvP list
// is the model): a dark translucent card with a hairline edge and rounded corners, an optional accent stripe on the left
// (gold, red or the mechanic's colour), light title text with a muted second line, a red pulsing edge for danger, and
// the same dashed frame in the edit mode. The radar keeps its own look (a ring on the ground, not a card).
static class OverlayStyle
{
    public static readonly Color Panel = Color.FromArgb(232, 20, 23, 31), Edge = Color.FromArgb(46, 255, 255, 255),
        Fg = Color.FromArgb(236, 238, 244), Muted = Color.FromArgb(150, 158, 176), Track = Color.FromArgb(255, 38, 42, 54),
        Gold = Color.FromArgb(232, 200, 114), Red = Color.FromArgb(255, 96, 86);
    /// Corner radius in px at 100 % (times the window's scale).
    public const float Radius = 10;

    /// The card: panel fill, hairline edge (or `edge` in its colour and width), accent stripe on the left.
    public static void Card(Graphics g, RectangleF r, float k, Color? accent = null, Color? edge = null, float edgeWidth = 1f)
    {
        using var path = PvpForm.Rounded(r, Radius * k);
        using (var fill = new SolidBrush(Panel)) g.FillPath(fill, path);
        if (accent is { } a)
        {
            g.SetClip(path);
            using (var stripe = new SolidBrush(a)) g.FillRectangle(stripe, r.X, r.Y, 4 * k, r.Height);
            g.ResetClip();
        }
        using var pen = new Pen(edge ?? Edge, edgeWidth * k);
        g.DrawPath(pen, path);
    }

    /// Dashed frame of the edit mode ("you can move this").
    public static void EditFrame(Graphics g, RectangleF r, float k)
    {
        using var path = PvpForm.Rounded(r, Radius * k);
        using var dash = new Pen(Color.FromArgb(220, 240, 240, 255), 1f) { DashPattern = [4, 3] };
        g.DrawPath(dash, path);
    }

    /// Text quality and smoothing every overlay draws with.
    public static void Prepare(Graphics g)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
    }
}
