using System.Drawing.Drawing2D;

namespace PetOverlay;

// Draws the Daevanion marks (BoardOverlay): a rounded frame around each node, green = buy, gold and thicker = the next
// click, red = reset; the step number in a small tag at the top left.
static class BoardMarks
{
    public static void Draw(Graphics gr, BoardVision.Hit hit, IEnumerable<(int r, int c, int kind, int no)> marks)
    {
        gr.SmoothingMode = SmoothingMode.AntiAlias;
        float p = (float)hit.Pitch, half = p * 0.42f, wpx = Math.Max(2f, p * 0.07f);
        using var font = new Font("Segoe UI", Math.Max(7f, p * 0.2f), FontStyle.Bold, GraphicsUnit.Pixel);
        foreach (var (r, c, kind, no) in marks)
        {
            float cx = (float)(hit.Sx + (c - 8) * hit.Pitch), cy = (float)(hit.Sy + (r - 8) * hit.Pitch);
            var col = kind switch { 1 => Color.FromArgb(255, 210, 94), 2 => Color.FromArgb(255, 90, 90), _ => Color.FromArgb(90, 220, 120) };
            using var pen = new Pen(col, kind == 1 ? wpx * 1.8f : wpx);
            var box = new RectangleF(cx - half, cy - half, half * 2, half * 2);
            using var path = Rounded(box, p * 0.1f);
            gr.DrawPath(pen, path);
            if (no > 0)
            {
                var txt = no.ToString();
                var sz = gr.MeasureString(txt, font);
                var tag = new RectangleF(box.Left - 1, box.Top - 1, sz.Width + 2, sz.Height);
                using var bg = new SolidBrush(col);
                gr.FillRectangle(bg, tag);
                gr.DrawString(txt, font, Brushes.Black, tag.Left + 1, tag.Top);
            }
        }
    }

    static GraphicsPath Rounded(RectangleF r, float rad)
    {
        var g = new GraphicsPath();
        float d = rad * 2;
        g.AddArc(r.Left, r.Top, d, d, 180, 90);
        g.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        g.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        g.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        g.CloseFigure();
        return g;
    }
}
