using System.Drawing;

namespace PetOverlay;

// Saved positions of the small overlay windows (PvP list, event announcer, alert banner): restored only where they are
// visible. Pure (no WinForms), checked by tools/pvpcheck.
static class Placement
{
    public const int Unset = int.MinValue;

    /// The saved rectangle moved (and if needed shrunk) fully into the working area it overlaps most, or the nearest
    /// one when it is on no screen any more (monitor unplugged, resolution changed). Unchanged when fully visible.
    public static Rectangle Clamp(Rectangle r, IReadOnlyList<Rectangle> areas)
    {
        if (areas.Count == 0) return r;
        var best = areas.OrderByDescending(a => Overlap(a, r)).ThenBy(a => Distance(a, r)).First();
        int w = Math.Min(r.Width, best.Width), h = Math.Min(r.Height, best.Height);
        return new Rectangle(Math.Clamp(r.X, best.Left, best.Right - w), Math.Clamp(r.Y, best.Top, best.Bottom - h), w, h);
    }

    /// Saved top-left corner clamped like Clamp, or `fallback` when nothing was saved yet.
    public static Point Restore(int x, int y, Size size, Point fallback, IReadOnlyList<Rectangle> areas) =>
        x == Unset || y == Unset ? Clamp(new Rectangle(fallback, size), areas).Location : Clamp(new Rectangle(x, y, size.Width, size.Height), areas).Location;

    static long Overlap(Rectangle a, Rectangle b)
    {
        var i = Rectangle.Intersect(a, b);
        return i.IsEmpty ? 0 : (long)i.Width * i.Height;
    }

    static double Distance(Rectangle a, Rectangle b)
    {
        double dx = (a.Left + a.Width / 2.0) - (b.Left + b.Width / 2.0), dy = (a.Top + a.Height / 2.0) - (b.Top + b.Height / 2.0);
        return dx * dx + dy * dy;
    }
}
